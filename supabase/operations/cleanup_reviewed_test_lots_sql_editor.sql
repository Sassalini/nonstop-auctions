-- SQL EDITOR VERSION — ONE-TIME MANUAL CLEANUP. Do not run before reviewing test_lot_inventory.sql.
-- Default dry_run=true never deletes anything. This is NOT a migration.
-- Fill the explicit UUID allowlist and exact count; edited/real/bid/winner lots
-- are refused even if their IDs are entered. No seed, truncate or auth deletion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
-- ========== EDIT ONLY THIS INPUT BLOCK ==========
-- Copy eligible_id_json from test_lot_review_list.sql AFTER reviewing its rows.
-- Use exactly the same reviewed IDs for the dry run, application and verification.
create temporary table cleanup_editor_input(
  dry_run boolean not null,
  expected_count integer not null,
  confirmation text not null,
  reviewed_lot_ids jsonb not null check(jsonb_typeof(reviewed_lot_ids)='array')
) on commit drop;
insert into cleanup_editor_input values (
  true,                 -- dry_run: KEEP true for your first run
  0,                    -- expected_count: change to the number reviewed (60 ONLY if all 60 qualify)
  '',                   -- confirmation: application requires 'DELETE REVIEWED TEST LOTS ONLY'
  $reviewed_ids$
[]
  $reviewed_ids$::jsonb  -- replace [] with the reviewed UUID JSON array, not a SQL query
);
-- ========== END EDITABLE INPUT BLOCK ==========
-- Do not change the validation, locking or deletion body below.
create temporary table cleanup_control(dry_run boolean not null,expected_count integer not null,confirmation text not null) on commit drop;
insert into cleanup_control select dry_run,expected_count,confirmation from cleanup_editor_input;
create temporary table cleanup_approved_lots(lot_id uuid primary key) on commit drop;
insert into cleanup_approved_lots(lot_id)
  select id.value::uuid from cleanup_editor_input input
  cross join lateral jsonb_array_elements_text(input.reviewed_lot_ids) as id(value);
create temporary table cleanup_preview(lot_id uuid,eligible boolean,approved boolean,details jsonb) on commit drop;
create temporary table cleanup_result(dry_run boolean,deleted_lots integer) on commit drop;

-- EXCLUSIVE blocks SELECT FOR UPDATE as well as writes, while ordinary reads
-- remain available. Room-first lock order matches the bidding/lifecycle RPCs.
-- Existing scheduler calls finish before locks are acquired; further calls wait
-- until commit/rollback. The Cron job and all lifecycle functions remain intact.
lock table public.auction_rooms in exclusive mode;
lock table public.lots,public.bids,public.watchlist,public.lot_images in exclusive mode;
do $$
declare notification_rows jsonb := '[]'; control record; approved_count integer; deleted_count integer := 0;
begin
  if to_regclass('public.notifications') is not null then
    execute 'lock table public.notifications in exclusive mode';
  end if;
  -- Keep the seed identity stable while eligibility is validated. Other account
  -- rows are neither locked nor changed by this procedure.
  perform 1 from auth.users where id='00000000-0000-0000-0000-000000000101' for share;
  perform 1 from public.profiles where id='00000000-0000-0000-0000-000000000101' for share;
  -- Fail closed for unreviewed cascade paths or DELETE triggers on dependents.
  if exists(select 1 from pg_constraint c where c.contype='f'
    and c.confrelid in ('public.lots'::regclass,'public.bids'::regclass,'public.watchlist'::regclass,'public.lot_images'::regclass,coalesce(to_regclass('public.notifications'),'public.lots'::regclass))
    and not (c.confrelid='public.lots'::regclass and c.conrelid in ('public.bids'::regclass,'public.watchlist'::regclass,'public.lot_images'::regclass,coalesce(to_regclass('public.notifications'),'public.bids'::regclass))
      and c.confdeltype='c'
      and c.conkey=array[(select attnum from pg_attribute where attrelid=c.conrelid and attname='lot_id')]::smallint[]
      and c.confkey=array[(select attnum from pg_attribute where attrelid=c.confrelid and attname='id')]::smallint[])) then
    raise exception 'Unreviewed foreign-key dependency: inspect the owner report. Nothing deleted.';
  end if;
  if exists(select 1 from pg_trigger t where not t.tgisinternal and (t.tgtype::integer & 8) <> 0
    and t.tgrelid in ('public.lots'::regclass,'public.bids'::regclass,'public.watchlist'::regclass,'public.lot_images'::regclass,coalesce(to_regclass('public.notifications'),'public.lots'::regclass))) then
    raise exception 'Unreviewed DELETE trigger: inspect the owner report. Nothing deleted.';
  end if;
  if exists(select 1 from pg_rewrite r where r.ev_type='4'
    and r.ev_class in ('public.lots'::regclass,'public.bids'::regclass,'public.watchlist'::regclass,'public.lot_images'::regclass,coalesce(to_regclass('public.notifications'),'public.lots'::regclass))) then
    raise exception 'Unreviewed DELETE rule: inspect the database before cleanup. Nothing deleted.';
  end if;
  if to_regclass('public.notifications') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''lot_id'',lot_id,''user_id'',user_id,''kind'',kind)),''[]''::jsonb) from public.notifications'
      into notification_rows;
  end if;
  with seed_manifest as (
  -- Exact original IDs/room IDs/titles/prices/images from the repository seed.
  -- UUID prefixes or seller IDs alone are NOT evidence sufficient for deletion.
  select * from jsonb_to_recordset('[{"lot_id":"20000000-0000-0000-0000-000000000101","room_id":"10000000-0000-0000-0000-000000000001","room_slug":"jewellery-room","title":"Pear Shaped Diamond Pendant Necklace","estimate_low":13000,"estimate_high":16000,"starting_bid":12500,"image_id":"30000000-0000-0000-0000-000000000101","image_url":"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000102","room_id":"10000000-0000-0000-0000-000000000001","room_slug":"jewellery-room","title":"Art Deco Diamond Ring","estimate_low":4000,"estimate_high":6000,"starting_bid":3600,"image_id":"30000000-0000-0000-0000-000000000102","image_url":"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000103","room_id":"10000000-0000-0000-0000-000000000001","room_slug":"jewellery-room","title":"Sapphire and Diamond Earrings","estimate_low":3000,"estimate_high":5000,"starting_bid":2500,"image_id":"30000000-0000-0000-0000-000000000103","image_url":"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000104","room_id":"10000000-0000-0000-0000-000000000001","room_slug":"jewellery-room","title":"Emerald Cut Diamond Ring","estimate_low":5000,"estimate_high":7000,"starting_bid":4750,"image_id":"30000000-0000-0000-0000-000000000104","image_url":"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000105","room_id":"10000000-0000-0000-0000-000000000001","room_slug":"jewellery-room","title":"Diamond Tennis Bracelet","estimate_low":2000,"estimate_high":3500,"starting_bid":1900,"image_id":"30000000-0000-0000-0000-000000000105","image_url":"https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000201","room_id":"10000000-0000-0000-0000-000000000002","room_slug":"watch-room","title":"Vintage Chronograph Wristwatch","estimate_low":7000,"estimate_high":9000,"starting_bid":6500,"image_id":"30000000-0000-0000-0000-000000000201","image_url":"https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000202","room_id":"10000000-0000-0000-0000-000000000002","room_slug":"watch-room","title":"Art Deco Gold Dress Watch","estimate_low":2400,"estimate_high":3600,"starting_bid":2100,"image_id":"30000000-0000-0000-0000-000000000202","image_url":"https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000203","room_id":"10000000-0000-0000-0000-000000000002","room_slug":"watch-room","title":"Stainless Steel Diver''s Wristwatch","estimate_low":3200,"estimate_high":4800,"starting_bid":2800,"image_id":"30000000-0000-0000-0000-000000000203","image_url":"https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000204","room_id":"10000000-0000-0000-0000-000000000002","room_slug":"watch-room","title":"Victorian Silver Pocket Watch","estimate_low":900,"estimate_high":1400,"starting_bid":750,"image_id":"30000000-0000-0000-0000-000000000204","image_url":"https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000205","room_id":"10000000-0000-0000-0000-000000000002","room_slug":"watch-room","title":"Watchmaker''s Tool Cabinet","estimate_low":600,"estimate_high":900,"starting_bid":450,"image_id":"30000000-0000-0000-0000-000000000205","image_url":"https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000301","room_id":"10000000-0000-0000-0000-000000000003","room_slug":"art-room","title":"Abstract Oil on Canvas","estimate_low":18000,"estimate_high":26000,"starting_bid":16000,"image_id":"30000000-0000-0000-0000-000000000301","image_url":"https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000302","room_id":"10000000-0000-0000-0000-000000000003","room_slug":"art-room","title":"Signed British Landscape","estimate_low":1800,"estimate_high":2600,"starting_bid":1500,"image_id":"30000000-0000-0000-0000-000000000302","image_url":"https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000303","room_id":"10000000-0000-0000-0000-000000000003","room_slug":"art-room","title":"Limited Edition Screen Print","estimate_low":900,"estimate_high":1400,"starting_bid":750,"image_id":"30000000-0000-0000-0000-000000000303","image_url":"https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000304","room_id":"10000000-0000-0000-0000-000000000003","room_slug":"art-room","title":"Modernist Bronze Sculpture","estimate_low":3200,"estimate_high":5000,"starting_bid":2800,"image_id":"30000000-0000-0000-0000-000000000304","image_url":"https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000305","room_id":"10000000-0000-0000-0000-000000000003","room_slug":"art-room","title":"Mid-Century Mixed Media Collage","estimate_low":1200,"estimate_high":1800,"starting_bid":950,"image_id":"30000000-0000-0000-0000-000000000305","image_url":"https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000401","room_id":"10000000-0000-0000-0000-000000000004","room_slug":"collectibles-room","title":"British Silver Coin Collection","estimate_low":1200,"estimate_high":1800,"starting_bid":1000,"image_id":"30000000-0000-0000-0000-000000000401","image_url":"https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000402","room_id":"10000000-0000-0000-0000-000000000004","room_slug":"collectibles-room","title":"Vintage Model Car Archive","estimate_low":700,"estimate_high":1100,"starting_bid":550,"image_id":"30000000-0000-0000-0000-000000000402","image_url":"https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000403","room_id":"10000000-0000-0000-0000-000000000004","room_slug":"collectibles-room","title":"Signed Sporting Memorabilia","estimate_low":900,"estimate_high":1400,"starting_bid":750,"image_id":"30000000-0000-0000-0000-000000000403","image_url":"https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000404","room_id":"10000000-0000-0000-0000-000000000004","room_slug":"collectibles-room","title":"Victorian Postcard Album","estimate_low":450,"estimate_high":700,"starting_bid":350,"image_id":"30000000-0000-0000-0000-000000000404","image_url":"https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000405","room_id":"10000000-0000-0000-0000-000000000004","room_slug":"collectibles-room","title":"Staunton Boxwood Chess Set","estimate_low":600,"estimate_high":900,"starting_bid":475,"image_id":"30000000-0000-0000-0000-000000000405","image_url":"https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000501","room_id":"10000000-0000-0000-0000-000000000005","room_slug":"design-room","title":"Mid-Century Lounge Chair","estimate_low":2500,"estimate_high":4200,"starting_bid":2200,"image_id":"30000000-0000-0000-0000-000000000501","image_url":"https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000502","room_id":"10000000-0000-0000-0000-000000000005","room_slug":"design-room","title":"Studio Ceramic Table Lamp","estimate_low":700,"estimate_high":1100,"starting_bid":550,"image_id":"30000000-0000-0000-0000-000000000502","image_url":"https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000503","room_id":"10000000-0000-0000-0000-000000000005","room_slug":"design-room","title":"Danish Teak Sideboard","estimate_low":1800,"estimate_high":2800,"starting_bid":1500,"image_id":"30000000-0000-0000-0000-000000000503","image_url":"https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000504","room_id":"10000000-0000-0000-0000-000000000005","room_slug":"design-room","title":"Italian Glass Coffee Table","estimate_low":1200,"estimate_high":1900,"starting_bid":950,"image_id":"30000000-0000-0000-0000-000000000504","image_url":"https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000505","room_id":"10000000-0000-0000-0000-000000000005","room_slug":"design-room","title":"Architect''s Swivel Desk Chair","estimate_low":900,"estimate_high":1400,"starting_bid":700,"image_id":"30000000-0000-0000-0000-000000000505","image_url":"https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000601","room_id":"10000000-0000-0000-0000-000000000006","room_slug":"wine-room","title":"Twelve-Bottle Bordeaux Case","estimate_low":1800,"estimate_high":2400,"starting_bid":1600,"image_id":"30000000-0000-0000-0000-000000000601","image_url":"https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000602","room_id":"10000000-0000-0000-0000-000000000006","room_slug":"wine-room","title":"Burgundy Grand Cru Magnum","estimate_low":1200,"estimate_high":1700,"starting_bid":1000,"image_id":"30000000-0000-0000-0000-000000000602","image_url":"https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000603","room_id":"10000000-0000-0000-0000-000000000006","room_slug":"wine-room","title":"Vintage Champagne Collection","estimate_low":900,"estimate_high":1300,"starting_bid":750,"image_id":"30000000-0000-0000-0000-000000000603","image_url":"https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000604","room_id":"10000000-0000-0000-0000-000000000006","room_slug":"wine-room","title":"Six-Bottle Vintage Port Lot","estimate_low":650,"estimate_high":950,"starting_bid":500,"image_id":"30000000-0000-0000-0000-000000000604","image_url":"https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000605","room_id":"10000000-0000-0000-0000-000000000006","room_slug":"wine-room","title":"Single-Estate Tuscan Wine Case","estimate_low":800,"estimate_high":1200,"starting_bid":650,"image_id":"30000000-0000-0000-0000-000000000605","image_url":"https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000701","room_id":"10000000-0000-0000-0000-000000000007","room_slug":"general-room","title":"Vintage Leather Travel Case","estimate_low":350,"estimate_high":550,"starting_bid":275,"image_id":"30000000-0000-0000-0000-000000000701","image_url":"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000702","room_id":"10000000-0000-0000-0000-000000000007","room_slug":"general-room","title":"Decorative Brass Table Lamp","estimate_low":180,"estimate_high":280,"starting_bid":140,"image_id":"30000000-0000-0000-0000-000000000702","image_url":"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000703","room_id":"10000000-0000-0000-0000-000000000007","room_slug":"general-room","title":"Framed Countryside Print","estimate_low":120,"estimate_high":200,"starting_bid":90,"image_id":"30000000-0000-0000-0000-000000000703","image_url":"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000704","room_id":"10000000-0000-0000-0000-000000000007","room_slug":"general-room","title":"Handmade Ceramic Vase","estimate_low":150,"estimate_high":240,"starting_bid":110,"image_id":"30000000-0000-0000-0000-000000000704","image_url":"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000705","room_id":"10000000-0000-0000-0000-000000000007","room_slug":"general-room","title":"Oak Storage Chest","estimate_low":400,"estimate_high":650,"starting_bid":325,"image_id":"30000000-0000-0000-0000-000000000705","image_url":"https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000801","room_id":"10000000-0000-0000-0000-000000000008","room_slug":"antiques-room","title":"Victorian Mahogany Writing Desk","estimate_low":1400,"estimate_high":2200,"starting_bid":1200,"image_id":"30000000-0000-0000-0000-000000000801","image_url":"https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000802","room_id":"10000000-0000-0000-0000-000000000008","room_slug":"antiques-room","title":"Edwardian Mantel Clock","estimate_low":500,"estimate_high":800,"starting_bid":400,"image_id":"30000000-0000-0000-0000-000000000802","image_url":"https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000803","room_id":"10000000-0000-0000-0000-000000000008","room_slug":"antiques-room","title":"Georgian Silver Candlesticks","estimate_low":1100,"estimate_high":1700,"starting_bid":900,"image_id":"30000000-0000-0000-0000-000000000803","image_url":"https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000804","room_id":"10000000-0000-0000-0000-000000000008","room_slug":"antiques-room","title":"Antique Porcelain Tea Set","estimate_low":450,"estimate_high":700,"starting_bid":350,"image_id":"30000000-0000-0000-0000-000000000804","image_url":"https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000805","room_id":"10000000-0000-0000-0000-000000000008","room_slug":"antiques-room","title":"Regency Occasional Table","estimate_low":800,"estimate_high":1200,"starting_bid":650,"image_id":"30000000-0000-0000-0000-000000000805","image_url":"https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000901","room_id":"10000000-0000-0000-0000-000000000009","room_slug":"library-room","title":"First-Edition Historical Novel","estimate_low":800,"estimate_high":1200,"starting_bid":650,"image_id":"30000000-0000-0000-0000-000000000901","image_url":"https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000902","room_id":"10000000-0000-0000-0000-000000000009","room_slug":"library-room","title":"Leather-Bound Encyclopedia Set","estimate_low":600,"estimate_high":900,"starting_bid":475,"image_id":"30000000-0000-0000-0000-000000000902","image_url":"https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000903","room_id":"10000000-0000-0000-0000-000000000009","room_slug":"library-room","title":"Victorian Writing Slope","estimate_low":450,"estimate_high":700,"starting_bid":350,"image_id":"30000000-0000-0000-0000-000000000903","image_url":"https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000904","room_id":"10000000-0000-0000-0000-000000000009","room_slug":"library-room","title":"Antique Terrestrial Globe","estimate_low":900,"estimate_high":1400,"starting_bid":750,"image_id":"30000000-0000-0000-0000-000000000904","image_url":"https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000000905","room_id":"10000000-0000-0000-0000-000000000009","room_slug":"library-room","title":"Walnut Bookcase","estimate_low":1200,"estimate_high":1800,"starting_bid":1000,"image_id":"30000000-0000-0000-0000-000000000905","image_url":"https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001001","room_id":"10000000-0000-0000-0000-000000000010","room_slug":"dining-room","title":"Silver-Plated Cutlery Service","estimate_low":700,"estimate_high":1100,"starting_bid":550,"image_id":"30000000-0000-0000-0000-000000001001","image_url":"https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001002","room_id":"10000000-0000-0000-0000-000000000010","room_slug":"dining-room","title":"Crystal Decanter Set","estimate_low":350,"estimate_high":550,"starting_bid":275,"image_id":"30000000-0000-0000-0000-000000001002","image_url":"https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001003","room_id":"10000000-0000-0000-0000-000000000010","room_slug":"dining-room","title":"Set of Mahogany Dining Chairs","estimate_low":1200,"estimate_high":1900,"starting_bid":1000,"image_id":"30000000-0000-0000-0000-000000001003","image_url":"https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001004","room_id":"10000000-0000-0000-0000-000000000010","room_slug":"dining-room","title":"Porcelain Dinner Service","estimate_low":500,"estimate_high":800,"starting_bid":400,"image_id":"30000000-0000-0000-0000-000000001004","image_url":"https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001005","room_id":"10000000-0000-0000-0000-000000000010","room_slug":"dining-room","title":"Antique Serving Trolley","estimate_low":650,"estimate_high":950,"starting_bid":500,"image_id":"30000000-0000-0000-0000-000000001005","image_url":"https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001101","room_id":"10000000-0000-0000-0000-000000000011","room_slug":"music-room","title":"Vintage Acoustic Guitar","estimate_low":900,"estimate_high":1400,"starting_bid":750,"image_id":"30000000-0000-0000-0000-000000001101","image_url":"https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001102","room_id":"10000000-0000-0000-0000-000000000011","room_slug":"music-room","title":"Upright Piano Stool","estimate_low":250,"estimate_high":400,"starting_bid":190,"image_id":"30000000-0000-0000-0000-000000001102","image_url":"https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001103","room_id":"10000000-0000-0000-0000-000000000011","room_slug":"music-room","title":"Brass Gramophone","estimate_low":600,"estimate_high":900,"starting_bid":475,"image_id":"30000000-0000-0000-0000-000000001103","image_url":"https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001104","room_id":"10000000-0000-0000-0000-000000000011","room_slug":"music-room","title":"Curated Vinyl Record Collection","estimate_low":500,"estimate_high":800,"starting_bid":400,"image_id":"30000000-0000-0000-0000-000000001104","image_url":"https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001105","room_id":"10000000-0000-0000-0000-000000000011","room_slug":"music-room","title":"Antique Violin and Case","estimate_low":1200,"estimate_high":1800,"starting_bid":1000,"image_id":"30000000-0000-0000-0000-000000001105","image_url":"https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001201","room_id":"10000000-0000-0000-0000-000000000012","room_slug":"technology-room","title":"Vintage Apple Computer","estimate_low":1800,"estimate_high":2800,"starting_bid":1500,"image_id":"30000000-0000-0000-0000-000000001201","image_url":"https://images.unsplash.com/photo-1518770660439-4636190af6d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001202","room_id":"10000000-0000-0000-0000-000000000012","room_slug":"technology-room","title":"Retro Games Console Bundle","estimate_low":600,"estimate_high":900,"starting_bid":475,"image_id":"30000000-0000-0000-0000-000000001202","image_url":"https://images.unsplash.com/photo-1518770660439-4636190af6d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001203","room_id":"10000000-0000-0000-0000-000000000012","room_slug":"technology-room","title":"Mechanical Keyboard Collection","estimate_low":350,"estimate_high":550,"starting_bid":275,"image_id":"30000000-0000-0000-0000-000000001203","image_url":"https://images.unsplash.com/photo-1518770660439-4636190af6d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001204","room_id":"10000000-0000-0000-0000-000000000012","room_slug":"technology-room","title":"Classic 35mm Film Camera","estimate_low":700,"estimate_high":1100,"starting_bid":550,"image_id":"30000000-0000-0000-0000-000000001204","image_url":"https://images.unsplash.com/photo-1518770660439-4636190af6d?auto=format&fit=crop&w=1400&q=85"},{"lot_id":"20000000-0000-0000-0000-000000001205","room_id":"10000000-0000-0000-0000-000000000012","room_slug":"technology-room","title":"Restored Valve Radio","estimate_low":450,"estimate_high":700,"starting_bid":350,"image_id":"30000000-0000-0000-0000-000000001205","image_url":"https://images.unsplash.com/photo-1518770660439-4636190af6d?auto=format&fit=crop&w=1400&q=85"}]'::jsonb) as m(
    lot_id uuid, room_id uuid, room_slug text, title text, estimate_low numeric,
    estimate_high numeric, starting_bid numeric, image_id uuid, image_url text)
), seed_account as (
  select p.id from auth.users u join public.profiles p on p.id = u.id
  where u.id = '00000000-0000-0000-0000-000000000101'
    and u.email = 'auction-seed@nonstop.local'
    and u.raw_user_meta_data ->> 'display_name' = 'Auction Seed Seller'
    and p.display_name = 'Auction Seed Seller'
), notifications as (
  select * from jsonb_to_recordset(notification_rows) as n(id uuid, lot_id uuid, user_id uuid, kind text)
), evidence as (
  select l.*, r.name as room_name, r.slug as room_slug,
    u.email as seller_email, a.id is not null as verified_seed_seller,
    (m.lot_id is not null and l.room_id = m.room_id and r.slug = m.room_slug
      and l.title = m.title and l.starting_bid = m.starting_bid
      and l.estimate_low = m.estimate_low and l.estimate_high = m.estimate_high
      and l.description = format('%s is a carefully catalogued example selected to test this room''s complete auction sequence.',m.title)
      and l.condition_report = 'Good auction condition with age-related wear noted in the catalogue photographs.'
      and l.shipping_info = 'Insured UK delivery or collection by appointment. International quotes are available on request.'
    ) as exact_seed_catalogue,
    (select count(*) from public.bids b where b.lot_id=l.id) as bid_records,
    (select count(*) from public.watchlist w where w.lot_id=l.id) as watchlist_records,
    (select count(*) from notifications n where n.lot_id=l.id) as notification_records,
    (select count(*) from public.lot_images i where i.lot_id=l.id) as image_records,
    (select count(*) from public.watchlist w where w.lot_id=l.id and not exists(select 1 from seed_account s where s.id=w.user_id))
      + (select count(*) from notifications n where n.lot_id=l.id and not exists(select 1 from seed_account s where s.id=n.user_id)) as non_seed_account_dependencies,
    (select count(*) from public.lot_images i where i.lot_id=l.id and (
      m.lot_id is null or i.id is distinct from m.image_id or i.alt_text is distinct from m.title
      or i.sort_order <> 0 or (i.image_url is distinct from m.image_url and i.image_url is distinct from r.image_url)
    )) as unrecognised_images
  from public.lots l join public.auction_rooms r on r.id=l.room_id
  left join auth.users u on u.id=l.seller_id
  left join seed_manifest m on m.lot_id=l.id
  left join seed_account a on a.id=l.seller_id
), assessed as (
  select e.*, concat_ws('; ',
    case when exact_seed_catalogue is not true then 'Unknown or edited catalogue identity' end,
    case when not verified_seed_seller then 'Seller is a real or unverified account' end,
    case when bid_records <> 0 or bid_count <> 0 then 'Bidding history or bid activity must be preserved' end,
    case when highest_bidder_id is not null or winning_bid is not null or sold_at is not null or status = 'SOLD' then 'Winner or completed sale must be preserved' end,
    case when status not in ('WAITING','PREVIEW','FIRST_BID_WINDOW','UNSOLD') then 'Status requires manual review' end,
    case when current_bid not in (0,starting_bid) then 'Unexplained bid amount' end,
    case when non_seed_account_dependencies > 0 then 'Watchlist or notification activity from non-seed accounts' end,
    case when unrecognised_images > 0 then 'Unrecognised image records' end
  ) as review_reason from evidence e
), lot_inventory as (
  select a.*, review_reason = '' as eligible_for_reviewed_cleanup from assessed a
)
  insert into cleanup_preview select id,eligible_for_reviewed_cleanup,
    exists(select 1 from cleanup_approved_lots a where a.lot_id=l.id),to_jsonb(l) from lot_inventory l;
  select * into strict control from cleanup_control;
  select count(*) into approved_count from cleanup_approved_lots;
  if not control.dry_run then
    if control.confirmation <> 'DELETE REVIEWED TEST LOTS ONLY' or approved_count = 0 or approved_count <> control.expected_count then
      raise exception 'Explicit confirmation, nonempty reviewed IDs and matching expected count required. Nothing deleted.';
    end if;
    if exists(select 1 from cleanup_approved_lots a left join cleanup_preview p on p.lot_id=a.lot_id where p.lot_id is null or not p.eligible) then
      raise exception 'An approved lot is missing, has changed, or requires manual review. Nothing deleted.';
    end if;
    -- Dependencies are removed explicitly; bids/winners are NEVER authorized.
    -- Every approved lot has zero bid rows and no winner/result under these locks.
    delete from public.watchlist where lot_id in(select lot_id from cleanup_approved_lots);
    if to_regclass('public.notifications') is not null then
      execute 'delete from public.notifications where lot_id in(select lot_id from pg_temp.cleanup_approved_lots)';
    end if;
    delete from public.lot_images where lot_id in(select lot_id from cleanup_approved_lots);
    delete from public.lots where id in(select lot_id from cleanup_approved_lots);
    get diagnostics deleted_count = row_count;
    if deleted_count <> control.expected_count then raise exception 'Deleted count mismatch; all changes rolled back.'; end if;
  end if;
  insert into cleanup_result values(control.dry_run,deleted_count);
end;
$$;
-- One result grid exposes the summary AND each reviewed ID in SQL Editor.
with reviewed as (
  select a.lot_id,p.eligible,p.details
  from cleanup_approved_lots a left join cleanup_preview p on p.lot_id=a.lot_id
), result as (
  select 0 as sort_order,'summary'::text as row_type,null::uuid as lot_id,
    jsonb_build_object(
      'dry_run',r.dry_run,'deleted_lots',r.deleted_lots,
      'expected_count',c.expected_count,
      'reviewed_count',(select count(*) from reviewed),
      'reviewed_eligible',(select count(*) from reviewed where eligible is true),
      'missing_reviewed_ids',(select count(*) from reviewed where details is null),
      'ineligible_reviewed_ids',(select count(*) from reviewed where eligible is false),
      'total_eligible_in_inventory',(select count(*) from cleanup_preview where eligible),
      'confirmation_matches',c.confirmation='DELETE REVIEWED TEST LOTS ONLY',
      'ids_and_count_valid',c.expected_count>0
        and c.expected_count=(select count(*) from reviewed)
        and not exists(select 1 from reviewed where eligible is not true)
    ) as details from cleanup_result r cross join cleanup_control c
  union all
  select 1,'reviewed_lot',lot_id,jsonb_build_object(
    'eligible',eligible,'missing',details is null,
    'room',details->>'room_name','title',details->>'title',
    'status',details->>'status','review_reason',details->>'review_reason',
    'bid_records',details->'bid_records','highest_bidder_id',details->'highest_bidder_id',
    'winning_bid',details->'winning_bid','watchlist_records',details->'watchlist_records',
    'notification_records',details->'notification_records','image_records',details->'image_records'
  ) from reviewed
)
select row_type,lot_id,details from result order by sort_order,lot_id;
-- COMMIT is safe in the default dry run: no persistent row is changed.
-- In confirmed mode all approved lot/dependency deletes commit together.
commit;
