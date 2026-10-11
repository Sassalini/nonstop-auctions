// Generates reviewed operation SQL by READING the seed manifest; never executes
// seed.sql, connects to Supabase, or changes any database.
import { readFile, writeFile } from 'node:fs/promises';

const seed = await readFile('supabase/seed.sql', 'utf8');
const roomsSource = await readFile('supabase/migrations/003_room_queues_and_catalogue.sql', 'utf8');
const rooms = new Map([...roomsSource.matchAll(/\('(10000000[^']+)', '([^']+)', '[^']+', '[^']+', '([^']+)', (\d+), true\)/g)]
  .map(match => [match[2], { id: match[1], image: match[3], order: Number(match[4]) }]));
const manifest = [...seed.matchAll(/\('([^']+-room)', (\d), '((?:''|[^'])*)', (\d+), (\d+), (\d+)\)/g)].map(match => {
  const room = rooms.get(match[1]);
  if (!room) throw new Error(`Missing seed room ${match[1]}`);
  const suffix = String(room.order * 100 + Number(match[2])).padStart(12, '0');
  return { lot_id: `20000000-0000-0000-0000-${suffix}`, room_id: room.id, room_slug: match[1], title: match[3].replaceAll("''", "'"),
    estimate_low: Number(match[4]), estimate_high: Number(match[5]), starting_bid: Number(match[6]),
    image_id: `30000000-0000-0000-0000-${suffix}`, image_url: room.image };
});
if (manifest.length !== 60 || new Set(manifest.map(lot => lot.lot_id)).size !== 60) throw new Error('Seed manifest changed; review the generator.');
const manifestSQL = JSON.stringify(manifest).replaceAll("'", "''");
const notificationsRead = `
  if to_regclass('public.notifications') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''id'',id,''lot_id'',lot_id,''user_id'',user_id,''kind'',kind)),''[]''::jsonb) from public.notifications'
      into notification_rows;
  end if;`;

const analysis = `with seed_manifest as (
  -- Exact original IDs/room IDs/titles/prices/images from the repository seed.
  -- UUID prefixes or seller IDs alone are NOT evidence sufficient for deletion.
  select * from jsonb_to_recordset('${manifestSQL}'::jsonb) as m(
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
)`;

const report = `-- READ-ONLY OWNER REPORT. Run in Supabase SQL Editor as the database owner.
-- Contains private ownership/dependency evidence; do not publish the result.
-- Generated by scripts/build-test-lot-cleanup.mjs; no seed is executed.
-- Supports installations both with and without the optional notifications table.
begin read only;
set local statement_timeout = '30s';
do $$
declare notification_rows jsonb := '[]'; report_rows jsonb; scheduler_rows jsonb := '[]';
begin${notificationsRead}
  ${analysis}, report as (
    select 'room_counts'::text as section, r.id::text as record_id,
      jsonb_build_object('name',r.name,'slug',r.slug,'lots',count(l.id),
        'unsold_returned',count(l.id) filter(where l.status='UNSOLD'),
        'eligible_for_reviewed_cleanup',count(l.id) filter(where l.eligible_for_reviewed_cleanup)) as details
      from public.auction_rooms r left join lot_inventory l on l.room_id=r.id group by r.id
    union all select 'status_counts', status, jsonb_build_object('lots',count(*)) from lot_inventory group by status
    union all select 'summary','all',jsonb_build_object('lots',count(*),'unsold_returned',count(*) filter(where status='UNSOLD'),
      'eligible_for_reviewed_cleanup',count(*) filter(where eligible_for_reviewed_cleanup),
      'manual_review',count(*) filter(where not eligible_for_reviewed_cleanup),
      'non_seed_or_unverified_seller_lots',count(*) filter(where not verified_seed_seller),
      'notifications_table_present',to_regclass('public.notifications') is not null) from lot_inventory
    union all select 'lot',id::text,to_jsonb(l) from lot_inventory l
    union all select 'bid_dependency',id::text,to_jsonb(b) from public.bids b
    union all select 'watchlist_dependency',id::text,to_jsonb(w) from public.watchlist w
    union all select 'notification_dependency',id::text,to_jsonb(n) from notifications n
    union all select 'image_dependency',id::text,to_jsonb(i) from public.lot_images i
    union all select 'foreign_key',c.oid::text,jsonb_build_object('table',c.conrelid::regclass::text,'references',c.confrelid::regclass::text,'definition',pg_get_constraintdef(c.oid))
      from pg_constraint c where c.contype='f' and c.confrelid in ('public.lots'::regclass,'public.bids'::regclass,'public.watchlist'::regclass,'public.lot_images'::regclass,coalesce(to_regclass('public.notifications'),'public.lots'::regclass))
    union all select 'trigger',t.oid::text,jsonb_build_object('table',t.tgrelid::regclass::text,'definition',pg_get_triggerdef(t.oid))
      from pg_trigger t where not t.tgisinternal and t.tgrelid in ('public.lots'::regclass,'public.bids'::regclass,'public.watchlist'::regclass,'public.lot_images'::regclass,coalesce(to_regclass('public.notifications'),'public.lots'::regclass))
    union all select 'delete_rule',r.oid::text,jsonb_build_object('table',r.ev_class::regclass::text,'definition',pg_get_ruledef(r.oid))
      from pg_rewrite r where r.ev_type='4' and r.ev_class in ('public.lots'::regclass,'public.bids'::regclass,'public.watchlist'::regclass,'public.lot_images'::regclass,coalesce(to_regclass('public.notifications'),'public.lots'::regclass))
    union all select 'lifecycle_function',f.signature,jsonb_build_object('exists',p.oid is not null,'security_definer',p.prosecdef,'settings',p.proconfig,'body_md5',md5(p.prosrc))
      from (values('public.advance_room_lifecycle(uuid)'),('public.advance_all_auction_rooms()'),('public.place_bid(uuid,numeric)'),('public.start_next_lot_preview_at(uuid,timestamptz)')) as f(signature)
      left join pg_proc p on p.oid=to_regprocedure(f.signature)
  ) select coalesce(jsonb_agg(to_jsonb(report) order by section,record_id),'[]') into report_rows from report;
  if to_regclass('cron.job') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''section'',''auction_scheduler'',''record_id'',jobid::text,''details'',jsonb_build_object(''jobname'',jobname,''schedule'',schedule,''active'',active))),''[]'') from cron.job where jobname=''nonstop-auction-lifecycle'' or command like ''%advance_all_auction_rooms%'' or command like ''%advance_room_lifecycle%'''
      into scheduler_rows;
  end if;
  if scheduler_rows='[]'::jsonb then
    scheduler_rows := jsonb_build_array(jsonb_build_object('section','auction_scheduler','record_id','not_found','details',jsonb_build_object('cron_table_present',to_regclass('cron.job') is not null,'message','No matching Cron job found; verify any external auction scheduler manually.')));
  end if;
  perform set_config('app.test_lot_inventory', (report_rows || scheduler_rows)::text, true);
end;
$$;
select * from jsonb_to_recordset(current_setting('app.test_lot_inventory')::jsonb) as r(section text,record_id text,details jsonb)
order by section,record_id;
commit;
`;
await writeFile('supabase/operations/test_lot_inventory.sql', report);

const cleanup = `-- ONE-TIME MANUAL CLEANUP. Do not run before reviewing test_lot_inventory.sql.
-- Default dry_run=true never deletes anything. This is NOT a migration.
-- Fill the explicit UUID allowlist and exact count; edited/real/bid/winner lots
-- are refused even if their IDs are entered. No seed, truncate or auth deletion.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
create temporary table cleanup_control(dry_run boolean not null,expected_count integer not null,confirmation text not null) on commit drop;
insert into cleanup_control values (true,0,'');
-- For application only: false, exact reviewed count, 'DELETE REVIEWED TEST LOTS ONLY'.
create temporary table cleanup_approved_lots(lot_id uuid primary key) on commit drop;
-- Add ONLY reviewed, eligible UUIDs, for example:
-- insert into cleanup_approved_lots values ('20000000-0000-0000-0000-000000000701');
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
  end if;${notificationsRead}
  ${analysis}
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
select * from cleanup_preview order by lot_id;
select * from cleanup_result;
-- COMMIT is safe in the default dry run: no persistent row is changed.
-- In confirmed mode all approved lot/dependency deletes commit together.
commit;
`;
await writeFile('supabase/operations/cleanup_reviewed_test_lots.sql', cleanup);
console.log('Prepared read-only inventory and guarded manual cleanup SQL for the 60 exact seed identities. No database connection or seed execution.');
