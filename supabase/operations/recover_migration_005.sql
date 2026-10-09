-- IDEMPOTENT RECOVERY FOR MIGRATION 005 (operations script, not an automatic migration).
-- Run check_migration_005.sql and release_preflight.sql FIRST as postgres.
-- Back up, pause bidding and all auction schedulers, then run this WHOLE file.
-- Original migration 005 is unchanged. This restores its intended definitions/ACLs.
-- Preserves rows, bid history, deadlines, winners, queue positions and publication membership.
-- Only data changes: normalize inactive legacy timings; insert missing profiles.
-- No cron jobs, extensions, new columns, DROP TABLE, DROP COLUMN, or DELETE.
-- Existing incompatible constraints/indexes/triggers/custom policies abort for review.
-- On any error the transaction rolls back; do not continue individual fragments.
-- Re-run the read-only checks after success. APPLIED objects can be left alone.
-- Apply with auction traffic paused. Existing deadlines and completed results are preserved.
-- An invalid historical monetary/result record causes this migration to fail for manual review.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = pg_catalog, public;
lock table public.lots, public.bids, public.auction_rooms, public.lot_images,
  public.profiles, public.watchlist in share row exclusive mode;
do $baseline$
declare e jsonb; col jsonb; actual text; relation regclass;
begin
  for e in select value from jsonb_array_elements($expected$[
{"category":"constraint","item":"public.lots.lots_release_timings_check","expected":{"definition":"CHECK (((preview_duration_seconds = 30) AND (first_bid_duration_seconds = 30) AND (bid_extension_seconds = 5) AND (requeue_delay_days = 7)))","validated":true,"type":"c"}},
{"category":"constraint","item":"public.lots.lots_finite_money_check","expected":{"definition":"CHECK ((((starting_bid >= (0)::numeric) AND (starting_bid <= 999999999999.99)) AND (starting_bid = round(starting_bid, 2)) AND ((current_bid >= (0)::numeric) AND (current_bid <= 999999999999.99)) AND (current_bid = round(current_bid, 2)) AND ((minimum_increment >= 0.01) AND (minimum_increment <= 999999999999.99)) AND (minimum_increment = round(minimum_increment, 2)) AND ((winning_bid IS NULL) OR (((winning_bid >= 0.01) AND (winning_bid <= 999999999999.99)) AND (winning_bid = round(winning_bid, 2)))) AND ((estimate_low IS NULL) OR (((estimate_low >= (0)::numeric) AND (estimate_low <= 999999999999.99)) AND (estimate_low = round(estimate_low, 2)))) AND ((estimate_high IS NULL) OR (((estimate_high >= (0)::numeric) AND (estimate_high <= 999999999999.99)) AND (estimate_high = round(estimate_high, 2))))))","validated":true,"type":"c"}},
{"category":"constraint","item":"public.bids.bids_finite_money_check","expected":{"definition":"CHECK ((((amount >= 0.01) AND (amount <= 999999999999.99)) AND (amount = round(amount, 2))))","validated":true,"type":"c"}},
{"category":"constraint","item":"public.lots.lots_release_result_check","expected":{"definition":"CHECK ((((status <> 'ACTIVE_BIDDING'::text) OR ((bid_count > 0) AND (highest_bidder_id IS NOT NULL))) AND ((status <> 'SOLD'::text) OR ((winning_bid IS NOT NULL) AND (highest_bidder_id IS NOT NULL) AND (sold_at IS NOT NULL))) AND ((status <> 'FIRST_BID_WINDOW'::text) OR ((bid_count = 0) AND (highest_bidder_id IS NULL)))))","validated":true,"type":"c"}},
{"category":"baseline_columns","item":"public.lots","expected":[{"name":"bid_count","type":"integer","not_null":true},{"name":"bid_extension_seconds","type":"integer","not_null":true},{"name":"bidding_starts_at","type":"timestamp with time zone","not_null":false},{"name":"condition_report","type":"text","not_null":false},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"current_bid","type":"numeric","not_null":true},{"name":"description","type":"text","not_null":false},{"name":"ends_at","type":"timestamp with time zone","not_null":false},{"name":"estimate_high","type":"numeric","not_null":false},{"name":"estimate_low","type":"numeric","not_null":false},{"name":"first_bid_duration_seconds","type":"integer","not_null":true},{"name":"highest_bidder_id","type":"uuid","not_null":false},{"name":"id","type":"uuid","not_null":true},{"name":"is_premium","type":"boolean","not_null":true},{"name":"minimum_increment","type":"numeric","not_null":true},{"name":"next_eligible_at","type":"timestamp with time zone","not_null":true},{"name":"preview_duration_seconds","type":"integer","not_null":true},{"name":"preview_starts_at","type":"timestamp with time zone","not_null":false},{"name":"queue_position","type":"integer","not_null":true},{"name":"requeue_delay_days","type":"integer","not_null":true},{"name":"room_id","type":"uuid","not_null":true},{"name":"seller_id","type":"uuid","not_null":true},{"name":"shipping_info","type":"text","not_null":false},{"name":"sold_at","type":"timestamp with time zone","not_null":false},{"name":"starting_bid","type":"numeric","not_null":true},{"name":"starts_at","type":"timestamp with time zone","not_null":false},{"name":"status","type":"text","not_null":true},{"name":"title","type":"text","not_null":true},{"name":"unsold_at","type":"timestamp with time zone","not_null":false},{"name":"updated_at","type":"timestamp with time zone","not_null":true},{"name":"winning_bid","type":"numeric","not_null":false}]},
{"category":"baseline_columns","item":"public.bids","expected":[{"name":"amount","type":"numeric","not_null":true},{"name":"bidder_id","type":"uuid","not_null":true},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"id","type":"uuid","not_null":true},{"name":"lot_id","type":"uuid","not_null":true}]},
{"category":"baseline_columns","item":"public.auction_rooms","expected":[{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"description","type":"text","not_null":false},{"name":"display_order","type":"integer","not_null":true},{"name":"id","type":"uuid","not_null":true},{"name":"image_url","type":"text","not_null":false},{"name":"is_active","type":"boolean","not_null":true},{"name":"name","type":"text","not_null":true},{"name":"slug","type":"text","not_null":true}]},
{"category":"baseline_columns","item":"public.lot_images","expected":[{"name":"alt_text","type":"text","not_null":false},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"id","type":"uuid","not_null":true},{"name":"image_url","type":"text","not_null":true},{"name":"lot_id","type":"uuid","not_null":true},{"name":"sort_order","type":"integer","not_null":true}]},
{"category":"baseline_columns","item":"public.profiles","expected":[{"name":"avatar_url","type":"text","not_null":false},{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"display_name","type":"text","not_null":false},{"name":"id","type":"uuid","not_null":true}]},
{"category":"baseline_columns","item":"public.watchlist","expected":[{"name":"created_at","type":"timestamp with time zone","not_null":true},{"name":"id","type":"uuid","not_null":true},{"name":"lot_id","type":"uuid","not_null":true},{"name":"user_id","type":"uuid","not_null":true}]},
{"category":"trigger","item":"auth.users.on_auction_user_created","expected":{"definition":"CREATE TRIGGER on_auction_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_auction_user()","enabled":"O"}},
{"category":"trigger","item":"public.bids.prevent_direct_bid_insert","expected":{"definition":"CREATE TRIGGER prevent_direct_bid_insert BEFORE INSERT ON public.bids FOR EACH ROW EXECUTE FUNCTION prevent_direct_bid_insert()","enabled":"O"}},
{"category":"trigger","item":"public.lots.prevent_direct_lot_bid_state_update","expected":{"definition":"CREATE TRIGGER prevent_direct_lot_bid_state_update BEFORE UPDATE ON public.lots FOR EACH ROW EXECUTE FUNCTION prevent_direct_lot_bid_state_update()","enabled":"O"}},
{"category":"trigger","item":"public.lots.set_lot_updated_at","expected":{"definition":"CREATE TRIGGER set_lot_updated_at BEFORE UPDATE ON public.lots FOR EACH ROW EXECUTE FUNCTION set_lot_updated_at()","enabled":"O"}},
{"category":"index","item":"public.lots_highest_bidder_id_idx","expected":{"definition":"CREATE INDEX lots_highest_bidder_id_idx ON public.lots USING btree (highest_bidder_id)","valid":true,"ready":true}},
{"category":"index","item":"public.watchlist_lot_id_idx","expected":{"definition":"CREATE INDEX watchlist_lot_id_idx ON public.watchlist USING btree (lot_id)","valid":true,"ready":true}}
]$expected$::jsonb) loop
    if e->>'category' = 'baseline_columns' then
      relation := to_regclass(e->>'item');
      if relation is null then raise exception 'Missing baseline table %. Apply missing migrations 001-004 first.', e->>'item'; end if;
      for col in select value from jsonb_array_elements(e->'expected') loop
        if not exists(select 1 from pg_attribute where attrelid = relation and attname = col->>'name'
          and not attisdropped and format_type(atttypid,atttypmod) = col->>'type'
          and attnotnull = (col->>'not_null')::boolean) then
          raise exception 'Missing or incompatible baseline column %.%. Recovery does not add/change columns.', e->>'item',col->>'name';
        end if;
      end loop;
    elsif e->>'category' = 'constraint' then
      select pg_get_constraintdef(oid) into actual from pg_constraint
        where conrelid = to_regclass(split_part(e->>'item','.',1) || '.' || split_part(e->>'item','.',2))
        and conname = split_part(e->>'item','.',3);
      if found and replace(actual,' NOT VALID','') <> e->'expected'->>'definition' then
        raise exception 'Existing constraint % has a different definition. Inspect it; nothing will be dropped.', e->>'item';
      end if;
    elsif e->>'category' = 'index' then
      if to_regclass(e->>'item') is not null and not exists(select 1 from pg_index
        where indexrelid = to_regclass(e->>'item') and indisvalid and indisready
        and pg_get_indexdef(indexrelid) = e->'expected'->>'definition') then
        raise exception 'Existing index % is incompatible or invalid. Inspect it; nothing will be dropped.', e->>'item';
      end if;
    elsif e->>'category' = 'trigger' then
      select pg_get_triggerdef(oid) into actual from pg_trigger
        where tgrelid = to_regclass(split_part(e->>'item','.',1) || '.' || split_part(e->>'item','.',2))
        and tgname = split_part(e->>'item','.',3) and not tgisinternal;
      if found and actual <> e->'expected'->>'definition' then
        raise exception 'Existing trigger % has a different definition. Inspect it; nothing will be dropped.', e->>'item';
      elsif not found and e->>'item' <> 'auth.users.on_auction_user_created' then
        raise exception 'Missing baseline trigger %. Restore the baseline trigger before recovery.', e->>'item';
      end if;
    end if;
  end loop;
  if exists(select 1 from pg_policies p where p.schemaname = 'public' and p.tablename in ('lots','bids','auction_rooms','lot_images','profiles','watchlist')
    and (p.tablename || '.' || p.policyname) not in ('auction_rooms.Anyone can read active auction rooms','bids.Users can read their own bids','lot_images.Anyone can read images for visible lots','lot_images.Sellers can add draft images','lot_images.Sellers can edit draft images','lot_images.Sellers can remove draft images','lots.Anyone can read non-draft lots','lots.Sellers can create their own lots','lots.Sellers can update draft or waiting lots','profiles.Users can create their own profile','profiles.Users can read their own profile','profiles.Users can update their own profile','watchlist.Users can add their own watchlist items','watchlist.Users can read their own watchlist','watchlist.Users can remove their own watchlist items','bids.Anyone can read bids for visible lots','bids.Logged-in users can insert bids')) then
    raise exception 'Unexpected auction RLS policy detected. Review check_migration_005.sql; recovery will not remove custom policies.';
  end if;
  if exists(select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'public' and c.relname in ('lots','bids','auction_rooms','lot_images','profiles','watchlist')
      and (c.relname || '.' || t.tgname) not in ('lots.set_lot_updated_at','lots.prevent_direct_lot_bid_state_update','bids.prevent_direct_bid_insert')) then
    raise exception 'Unexpected auction trigger detected. Inspect it; recovery will not remove custom triggers or invoke them during data changes.';
  end if;
  if exists(select 1 from pg_proc where oid in (to_regprocedure('public.set_lot_updated_at()'),to_regprocedure('public.prevent_direct_bid_insert()'),to_regprocedure('public.advance_lot(uuid)'),to_regprocedure('public.start_next_lot_preview(uuid)'),to_regprocedure('public.prevent_direct_lot_bid_state_update()'),to_regprocedure('public.handle_new_auction_user()'),to_regprocedure('public.start_next_lot_preview_at(uuid,timestamptz)'),to_regprocedure('public.advance_room_lifecycle(uuid)'),to_regprocedure('public.place_bid(uuid,numeric)'),to_regprocedure('public.publish_lot(uuid)'),to_regprocedure('public.advance_all_auction_rooms()'),to_regprocedure('public.auction_server_time()'))
    and pg_get_userbyid(proowner) <> current_user) then
    raise exception 'Auction function owner differs from current role. Run as its trusted database owner and inspect function ownership.';
  end if;
  if to_regprocedure('public.set_lot_updated_at()') is null
    or to_regprocedure('public.prevent_direct_bid_insert()') is null
    or to_regprocedure('public.advance_lot(uuid)') is null
    or to_regprocedure('public.start_next_lot_preview(uuid)') is null then
    raise exception 'A baseline auction function is missing. Restore that part of migrations 001-004 before recovery.';
  end if;
  if not exists(select 1 from pg_policies where schemaname = 'public' and tablename = 'auction_rooms'
    and policyname = 'Anyone can read active auction rooms' and roles = array['anon','authenticated']::name[]
    and cmd = 'SELECT' and qual = '(is_active = true)' and with_check is null and permissive = 'PERMISSIVE') then
    raise exception 'Baseline room policy is missing or changed. Inspect it; migration 005 does not replace this policy.';
  end if;
end;
$baseline$;
do $timings$
begin
  if exists(select 1 from public.lots where status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING') and ends_at is null) then
    raise exception 'A current lot is missing its deadline. Inspect release_preflight.sql before recovery.';
  end if;
  if exists(select 1 from public.lots where status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING')
    group by room_id having count(*) > 1) then
    raise exception 'A room has duplicate current lots. Inspect release_preflight.sql before recovery.';
  end if;
  if exists(select 1 from public.lots where status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING')
    and (preview_duration_seconds <> 30 or first_bid_duration_seconds <> 30
      or bid_extension_seconds <> 5 or requeue_delay_days <> 7)) then
    raise exception 'A running lot has legacy timings. Do not change its live deadline; resolve that lot before recovery.';
  end if;
end;
$timings$;


alter function public.set_lot_updated_at() set search_path = '';
alter function public.prevent_direct_bid_insert() set search_path = '';
alter function public.advance_lot(uuid) set search_path = '';
alter function public.start_next_lot_preview(uuid) set search_path = '';

create or replace function public.prevent_direct_lot_bid_state_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('anon', 'authenticated') and (
    current_setting('app.place_bid', true) = 'true'
    or current_setting('app.auction_lifecycle', true) = 'true'
  ) then return new; end if;

  if new.current_bid is distinct from old.current_bid
    or new.bid_count is distinct from old.bid_count
    or new.highest_bidder_id is distinct from old.highest_bidder_id
    or new.winning_bid is distinct from old.winning_bid
    or new.sold_at is distinct from old.sold_at
    or new.unsold_at is distinct from old.unsold_at
    or new.ends_at is distinct from old.ends_at
    or new.starts_at is distinct from old.starts_at
    or new.preview_starts_at is distinct from old.preview_starts_at
    or new.bidding_starts_at is distinct from old.bidding_starts_at
    or new.next_eligible_at is distinct from old.next_eligible_at
    or new.queue_position is distinct from old.queue_position
    or new.status is distinct from old.status
    or new.preview_duration_seconds is distinct from old.preview_duration_seconds
    or new.first_bid_duration_seconds is distinct from old.first_bid_duration_seconds
    or new.bid_extension_seconds is distinct from old.bid_extension_seconds
    or new.requeue_delay_days is distinct from old.requeue_delay_days
    or new.is_premium is distinct from old.is_premium
    or new.seller_id is distinct from old.seller_id
    or (old.status <> 'DRAFT' and new.room_id is distinct from old.room_id)
  then raise exception 'Lot state must be changed through a secure server function.'; end if;
  return new;
end;
$$;

select set_config('app.auction_lifecycle', 'true', true);
update public.lots set preview_duration_seconds = 30, first_bid_duration_seconds = 30,
  bid_extension_seconds = 5, requeue_delay_days = 7
where preview_duration_seconds <> 30 or first_bid_duration_seconds <> 30
  or bid_extension_seconds <> 5 or requeue_delay_days <> 7;
select set_config('app.auction_lifecycle', 'false', true);

do $constraint$
begin
  if not exists(select 1 from pg_constraint where conrelid = 'public.lots'::regclass and conname = 'lots_release_timings_check') then
    alter table public.lots add constraint lots_release_timings_check check (
  preview_duration_seconds = 30 and first_bid_duration_seconds = 30
  and bid_extension_seconds = 5 and requeue_delay_days = 7
);
  end if;
  if exists(select 1 from pg_constraint where conrelid = 'public.lots'::regclass
    and conname = 'lots_release_timings_check' and not convalidated) then
    alter table public.lots validate constraint lots_release_timings_check;
  end if;
end;
$constraint$;
do $constraint$
begin
  if not exists(select 1 from pg_constraint where conrelid = 'public.lots'::regclass and conname = 'lots_finite_money_check') then
    alter table public.lots add constraint lots_finite_money_check check (
  starting_bid between 0 and 999999999999.99 and starting_bid = round(starting_bid, 2)
  and current_bid between 0 and 999999999999.99 and current_bid = round(current_bid, 2)
  and minimum_increment between 0.01 and 999999999999.99 and minimum_increment = round(minimum_increment, 2)
  and (winning_bid is null or (winning_bid between 0.01 and 999999999999.99 and winning_bid = round(winning_bid, 2)))
  and (estimate_low is null or (estimate_low between 0 and 999999999999.99 and estimate_low = round(estimate_low, 2)))
  and (estimate_high is null or (estimate_high between 0 and 999999999999.99 and estimate_high = round(estimate_high, 2)))
);
  end if;
  if exists(select 1 from pg_constraint where conrelid = 'public.lots'::regclass
    and conname = 'lots_finite_money_check' and not convalidated) then
    alter table public.lots validate constraint lots_finite_money_check;
  end if;
end;
$constraint$;
do $constraint$
begin
  if not exists(select 1 from pg_constraint where conrelid = 'public.bids'::regclass and conname = 'bids_finite_money_check') then
    alter table public.bids add constraint bids_finite_money_check check (
  amount between 0.01 and 999999999999.99 and amount = round(amount, 2)
);
  end if;
  if exists(select 1 from pg_constraint where conrelid = 'public.bids'::regclass
    and conname = 'bids_finite_money_check' and not convalidated) then
    alter table public.bids validate constraint bids_finite_money_check;
  end if;
end;
$constraint$;
do $constraint$
begin
  if not exists(select 1 from pg_constraint where conrelid = 'public.lots'::regclass and conname = 'lots_release_result_check') then
    alter table public.lots add constraint lots_release_result_check check (
  (status <> 'ACTIVE_BIDDING' or (bid_count > 0 and highest_bidder_id is not null))
  and (status <> 'SOLD' or (winning_bid is not null and highest_bidder_id is not null and sold_at is not null))
  and (status <> 'FIRST_BID_WINDOW' or (bid_count = 0 and highest_bidder_id is null))
);
  end if;
  if exists(select 1 from pg_constraint where conrelid = 'public.lots'::regclass
    and conname = 'lots_release_result_check' and not convalidated) then
    alter table public.lots validate constraint lots_release_result_check;
  end if;
end;
$constraint$;

alter table public.lots enable row level security;
alter table public.bids enable row level security;
alter table public.auction_rooms enable row level security;
alter table public.lot_images enable row level security;
alter table public.profiles enable row level security;
alter table public.watchlist enable row level security;
-- Grant only catalogue columns. Bids, queue order, timings, and results are RPC-only.
revoke all on public.lots, public.bids, public.auction_rooms, public.lot_images,
  public.profiles, public.watchlist from anon, authenticated;
grant select on public.lots, public.auction_rooms, public.lot_images to anon, authenticated;
grant select on public.bids to authenticated;
grant select, insert on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant select, insert, delete on public.watchlist to authenticated;
grant insert (room_id, seller_id, title, description, condition_report, shipping_info,
  estimate_low, estimate_high, starting_bid, minimum_increment) on public.lots to authenticated;
grant update (room_id, title, description, condition_report, shipping_info,
  estimate_low, estimate_high, starting_bid, minimum_increment) on public.lots to authenticated;
grant insert (lot_id, image_url, alt_text, sort_order) on public.lot_images to authenticated;
grant update (image_url, alt_text, sort_order), delete on public.lot_images to authenticated;


drop policy if exists "Anyone can read bids for visible lots" on public.bids;
drop policy if exists "Logged-in users can insert bids" on public.bids;
drop policy if exists "Users can read their own bids" on public.bids;
create policy "Users can read their own bids" on public.bids as PERMISSIVE for SELECT
to authenticated
using ((bidder_id = ( SELECT auth.uid() AS uid)));

drop policy if exists "Anyone can read images for visible lots" on public.lot_images;
create policy "Anyone can read images for visible lots" on public.lot_images as PERMISSIVE for SELECT
to anon, authenticated
using ((EXISTS ( SELECT 1
   FROM lots l
  WHERE (l.id = lot_images.lot_id))));

drop policy if exists "Sellers can add draft images" on public.lot_images;
create policy "Sellers can add draft images" on public.lot_images as PERMISSIVE for INSERT
to authenticated
with check ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = lot_images.lot_id) AND (l.seller_id = ( SELECT auth.uid() AS uid)) AND (l.status = 'DRAFT'::text)))));

drop policy if exists "Sellers can edit draft images" on public.lot_images;
create policy "Sellers can edit draft images" on public.lot_images as PERMISSIVE for UPDATE
to authenticated
using ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = lot_images.lot_id) AND (l.seller_id = ( SELECT auth.uid() AS uid)) AND (l.status = 'DRAFT'::text)))))
with check ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = lot_images.lot_id) AND (l.seller_id = ( SELECT auth.uid() AS uid)) AND (l.status = 'DRAFT'::text)))));

drop policy if exists "Sellers can remove draft images" on public.lot_images;
create policy "Sellers can remove draft images" on public.lot_images as PERMISSIVE for DELETE
to authenticated
using ((EXISTS ( SELECT 1
   FROM lots l
  WHERE ((l.id = lot_images.lot_id) AND (l.seller_id = ( SELECT auth.uid() AS uid)) AND (l.status = 'DRAFT'::text)))));

drop policy if exists "Anyone can read non-draft lots" on public.lots;
create policy "Anyone can read non-draft lots" on public.lots as PERMISSIVE for SELECT
to anon, authenticated
using (((seller_id = ( SELECT auth.uid() AS uid)) OR ((status <> 'DRAFT'::text) AND (EXISTS ( SELECT 1
   FROM auction_rooms r
  WHERE ((r.id = lots.room_id) AND r.is_active))))));

drop policy if exists "Sellers can create their own lots" on public.lots;
create policy "Sellers can create their own lots" on public.lots as PERMISSIVE for INSERT
to authenticated
with check (((seller_id = ( SELECT auth.uid() AS uid)) AND (status = 'DRAFT'::text) AND (current_bid = (0)::numeric) AND (bid_count = 0) AND (highest_bidder_id IS NULL) AND (winning_bid IS NULL) AND (sold_at IS NULL) AND (unsold_at IS NULL) AND (ends_at IS NULL) AND (queue_position = 0) AND (preview_starts_at IS NULL) AND (bidding_starts_at IS NULL) AND (NOT is_premium) AND (EXISTS ( SELECT 1
   FROM auction_rooms r
  WHERE ((r.id = lots.room_id) AND r.is_active)))));

drop policy if exists "Sellers can update draft or waiting lots" on public.lots;
create policy "Sellers can update draft or waiting lots" on public.lots as PERMISSIVE for UPDATE
to authenticated
using (((seller_id = ( SELECT auth.uid() AS uid)) AND (status = 'DRAFT'::text)))
with check (((seller_id = ( SELECT auth.uid() AS uid)) AND (status = 'DRAFT'::text)));

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile" on public.profiles as PERMISSIVE for INSERT
to authenticated
with check ((id = ( SELECT auth.uid() AS uid)));

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile" on public.profiles as PERMISSIVE for SELECT
to authenticated
using ((id = ( SELECT auth.uid() AS uid)));

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile" on public.profiles as PERMISSIVE for UPDATE
to authenticated
using ((id = ( SELECT auth.uid() AS uid)))
with check ((id = ( SELECT auth.uid() AS uid)));

drop policy if exists "Users can add their own watchlist items" on public.watchlist;
create policy "Users can add their own watchlist items" on public.watchlist as PERMISSIVE for INSERT
to authenticated
with check ((user_id = ( SELECT auth.uid() AS uid)));

drop policy if exists "Users can read their own watchlist" on public.watchlist;
create policy "Users can read their own watchlist" on public.watchlist as PERMISSIVE for SELECT
to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));

drop policy if exists "Users can remove their own watchlist items" on public.watchlist;
create policy "Users can remove their own watchlist items" on public.watchlist as PERMISSIVE for DELETE
to authenticated
using ((user_id = ( SELECT auth.uid() AS uid)));

create or replace function public.handle_new_auction_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', 'Bidder'), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;
do $trigger$
begin
  if not exists(select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auction_user_created' and not tgisinternal) then
    create trigger on_auction_user_created after insert on auth.users
    for each row execute function public.handle_new_auction_user();
  end if;
end;
$trigger$;
do $enable_triggers$
begin
  if exists(select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auction_user_created' and tgenabled <> 'O') then
    alter table auth.users enable trigger on_auction_user_created;
  end if;
  if exists(select 1 from pg_trigger where tgrelid = 'public.lots'::regclass and tgname = 'set_lot_updated_at' and tgenabled <> 'O') then
    alter table public.lots enable trigger set_lot_updated_at;
  end if;
  if exists(select 1 from pg_trigger where tgrelid = 'public.lots'::regclass and tgname = 'prevent_direct_lot_bid_state_update' and tgenabled <> 'O') then
    alter table public.lots enable trigger prevent_direct_lot_bid_state_update;
  end if;
  if exists(select 1 from pg_trigger where tgrelid = 'public.bids'::regclass and tgname = 'prevent_direct_bid_insert' and tgenabled <> 'O') then
    alter table public.bids enable trigger prevent_direct_bid_insert;
  end if;
end;
$enable_triggers$;
insert into public.profiles (id, display_name)
select id, left(coalesce(raw_user_meta_data ->> 'display_name', 'Bidder'), 80) from auth.users
on conflict (id) do nothing;

create or replace function public.start_next_lot_preview_at(p_room_id uuid, p_transition_at timestamptz)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare selected_lot public.lots%rowtype; result public.lots%rowtype;
  previous_flag text := current_setting('app.auction_lifecycle', true);
begin
  perform 1 from public.auction_rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into result from public.lots where room_id = p_room_id
    and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING') limit 1;
  if found then return result; end if;
  select * into selected_lot from public.lots where room_id = p_room_id
    and status in ('WAITING', 'UNSOLD') and next_eligible_at <= p_transition_at
    order by queue_position, created_at, id limit 1 for update;
  if not found then return null; end if;
  perform set_config('app.auction_lifecycle', 'true', true);
  update public.lots set status = 'PREVIEW', current_bid = starting_bid, bid_count = 0,
    highest_bidder_id = null, preview_starts_at = p_transition_at, bidding_starts_at = null,
    ends_at = p_transition_at + interval '30 seconds', sold_at = null, unsold_at = null,
    winning_bid = null where id = selected_lot.id returning * into result;
  perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
  return result;
end;
$$;

create or replace function public.advance_room_lifecycle(p_room_id uuid)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare active_lot public.lots%rowtype; completed_lot public.lots%rowtype;
  next_lot public.lots%rowtype; observed_at timestamptz; transition_at timestamptz;
  previous_flag text := current_setting('app.auction_lifecycle', true);
  transitions integer := 0; next_position integer;
begin
  -- Every bidding/lifecycle function takes the room lock before the lot lock.
  perform 1 from public.auction_rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  observed_at := clock_timestamp();
  loop
    select * into active_lot from public.lots where room_id = p_room_id
      and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING') limit 1 for update;
    if not found then return public.start_next_lot_preview_at(p_room_id, observed_at); end if;
    -- Commit bounded recovery progress rather than rolling an entire recovery back.
    if transitions >= 1000 then return active_lot; end if;
    transitions := transitions + 1;
    if active_lot.ends_at is null then raise exception 'Current lot is missing its database deadline.'; end if;
    if active_lot.ends_at > observed_at then return active_lot; end if;
    transition_at := active_lot.ends_at;
    perform set_config('app.auction_lifecycle', 'true', true);
    if active_lot.status = 'PREVIEW' then
      update public.lots set status = 'FIRST_BID_WINDOW', bidding_starts_at = transition_at,
        ends_at = transition_at + interval '30 seconds' where id = active_lot.id;
      perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
      continue;
    end if;
    if active_lot.status = 'FIRST_BID_WINDOW' then
      select coalesce(max(queue_position), 0) + 1 into next_position from public.lots where room_id = p_room_id;
      update public.lots set status = 'UNSOLD', ends_at = transition_at, unsold_at = transition_at,
        next_eligible_at = transition_at + interval '7 days', queue_position = next_position,
        highest_bidder_id = null, winning_bid = null where id = active_lot.id returning * into completed_lot;
    else
      update public.lots set status = 'SOLD', ends_at = transition_at, sold_at = transition_at,
        winning_bid = current_bid where id = active_lot.id returning * into completed_lot;
    end if;
    perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
    next_lot := public.start_next_lot_preview_at(p_room_id, transition_at);
    if next_lot.id is null then
      -- A lot may have become eligible between an overdue deadline and this call.
      next_lot := public.start_next_lot_preview_at(p_room_id, observed_at);
      if next_lot.id is null then return completed_lot; end if;
    end if;
  end loop;
end;
$$;

create or replace function public.place_bid(lot_id uuid, bid_amount numeric)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare bidder uuid := auth.uid(); room uuid; existing_lot public.lots%rowtype;
  result public.lots%rowtype; accepted_at timestamptz; required_bid numeric;
  previous_flag text := current_setting('app.place_bid', true);
begin
  if bidder is null then raise exception 'Authentication required to place a bid.'; end if;
  if not exists (select 1 from auth.users where id = bidder and email_confirmed_at is not null) then
    raise exception 'Confirm your email before placing a bid.';
  end if;
  if $2 is null or not ($2 between 0.01 and 999999999999.99) or $2 <> round($2, 2) then
    raise exception 'Bid amount must be a finite positive amount with at most two decimal places.';
  end if;
  select room_id into room from public.lots where id = $1;
  if not found then raise exception 'Lot not found.'; end if;
  perform 1 from public.auction_rooms where id = room and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into existing_lot from public.lots where id = $1 for update;
  accepted_at := clock_timestamp();
  if not found or existing_lot.room_id <> room or existing_lot.status not in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING') then
    raise exception 'Lot is not open for bidding.';
  end if;
  if existing_lot.seller_id = bidder then raise exception 'You cannot bid on your own lot.'; end if;
  if existing_lot.ends_at is null or accepted_at >= existing_lot.ends_at then
    raise exception 'Lot bidding has ended.';
  end if;
  required_bid := case when existing_lot.status = 'FIRST_BID_WINDOW'
    then greatest(existing_lot.starting_bid, 0.01)
    else existing_lot.current_bid + existing_lot.minimum_increment end;
  if $2 < required_bid then raise exception 'Bid must be at least %.', required_bid; end if;
  perform set_config('app.place_bid', 'true', true);
  insert into public.bids (lot_id, bidder_id, amount) values ($1, bidder, $2);
  update public.lots set current_bid = $2, bid_count = existing_lot.bid_count + 1,
    highest_bidder_id = bidder, status = 'ACTIVE_BIDDING',
    bidding_starts_at = coalesce(existing_lot.bidding_starts_at, accepted_at),
    ends_at = accepted_at + interval '5 seconds', sold_at = null, unsold_at = null,
    winning_bid = null where id = existing_lot.id returning * into result;
  perform set_config('app.place_bid', coalesce(previous_flag, ''), true);
  return result;
end;
$$;

create or replace function public.publish_lot(p_lot_id uuid)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare result public.lots%rowtype; room uuid; previous_flag text := current_setting('app.auction_lifecycle', true);
begin
  select room_id into room from public.lots where id = p_lot_id and seller_id = auth.uid();
  if not found then raise exception 'Lot not found.'; end if;
  perform 1 from public.auction_rooms where id = room and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into result from public.lots where id = p_lot_id and seller_id = auth.uid() for update;
  if not found or result.room_id <> room or result.status <> 'DRAFT' then raise exception 'Only your own draft can be published.'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'Confirm your email before publishing.';
  end if;
  perform set_config('app.auction_lifecycle', 'true', true);
  update public.lots set status = 'WAITING', next_eligible_at = clock_timestamp(),
    queue_position = (select coalesce(max(queue_position), 0) + 1 from public.lots where room_id = room)
    where id = p_lot_id returning * into result;
  perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
  return result;
end;
$$;

create or replace function public.advance_all_auction_rooms()
returns integer language plpgsql security definer set search_path = '' as $$
declare room uuid; advanced integer := 0;
begin
  for room in select id from public.auction_rooms where is_active order by id loop
    perform public.advance_room_lifecycle(room);
    advanced := advanced + 1;
  end loop;
  return advanced;
end;
$$;

create or replace function public.auction_server_time()
returns timestamptz language sql volatile set search_path = '' as $$
  select clock_timestamp();
$$;

create index if not exists lots_highest_bidder_id_idx on public.lots (highest_bidder_id);
create index if not exists watchlist_lot_id_idx on public.watchlist (lot_id);

revoke execute on function public.handle_new_auction_user(), public.set_lot_updated_at(),
  public.prevent_direct_lot_bid_state_update(), public.prevent_direct_bid_insert(),
  public.start_next_lot_preview_at(uuid, timestamptz), public.start_next_lot_preview(uuid),
  public.advance_lot(uuid), public.advance_all_auction_rooms(), public.publish_lot(uuid),
  public.place_bid(uuid, numeric), public.advance_room_lifecycle(uuid) from public, anon, authenticated;
grant execute on function public.place_bid(uuid, numeric), public.publish_lot(uuid) to authenticated;
grant execute on function public.advance_room_lifecycle(uuid) to anon, authenticated;
grant execute on function public.advance_all_auction_rooms() to service_role;
revoke execute on function public.auction_server_time() from public;
grant execute on function public.auction_server_time() to anon, authenticated;
commit;
