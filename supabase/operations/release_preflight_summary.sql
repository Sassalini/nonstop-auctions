-- READ ONLY: run the entire script in Supabase SQL Editor as postgres/database owner.
-- Requires migrations 001-004; use before or after migration 005.
-- One SELECT, one result grid: check_name, status, details.
-- PASS = check satisfied; WARN = review needed; FAIL = release requirement failed.
-- Counts use the statement's database snapshot. Sample IDs are limited to 10.
-- RLS policy definitions are an inventory for manual review, not a security audit.
with
lot_status_counts as (
  select status, count(*) as lot_count from public.lots group by status
),
invalid_money as (
  select id from public.lots where
    (starting_bid between 0 and 999999999999.99 and starting_bid = round(starting_bid, 2)) is not true
    or (current_bid between 0 and 999999999999.99 and current_bid = round(current_bid, 2)) is not true
    or (minimum_increment between 0.01 and 999999999999.99 and minimum_increment = round(minimum_increment, 2)) is not true
    or (winning_bid is not null and (winning_bid between 0.01 and 999999999999.99 and winning_bid = round(winning_bid, 2)) is not true)
    or (estimate_low is not null and (estimate_low between 0 and 999999999999.99 and estimate_low = round(estimate_low, 2)) is not true)
    or (estimate_high is not null and (estimate_high between 0 and 999999999999.99 and estimate_high = round(estimate_high, 2)) is not true)
),
invalid_bids as (
  select id from public.bids where
    (amount between 0.01 and 999999999999.99 and amount = round(amount, 2)) is not true
),
duplicate_current_lots as (
  select room_id, count(*) as lot_count from public.lots
  where status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
  group by room_id having count(*) > 1
),
missing_deadlines as (
  select id from public.lots
  where status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING') and ends_at is null
),
invalid_results as (
  select id from public.lots where
    (status = 'ACTIVE_BIDDING' and (bid_count > 0 and highest_bidder_id is not null) is not true)
    or (status = 'SOLD' and (winning_bid is null or highest_bidder_id is null or sold_at is null))
    or (status = 'FIRST_BID_WINDOW' and (bid_count = 0 and highest_bidder_id is null) is not true)
),
timing_groups as (
  select preview_duration_seconds, first_bid_duration_seconds, bid_extension_seconds,
    requeue_delay_days, count(*) as lot_count from public.lots group by 1, 2, 3, 4
),
expected_defaults(column_name, expected_value) as (
  values ('preview_duration_seconds', '30'), ('first_bid_duration_seconds', '30'),
    ('bid_extension_seconds', '5'), ('requeue_delay_days', '7')
),
timing_defaults as (
  select e.*, pg_catalog.pg_get_expr(d.adbin, d.adrelid) as actual_default
  from expected_defaults e
  left join pg_catalog.pg_attribute a on a.attrelid = 'public.lots'::regclass
    and a.attname = e.column_name and not a.attisdropped
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
),
expected_functions(signature) as (
  values ('public.place_bid(uuid,numeric)'), ('public.advance_room_lifecycle(uuid)'),
    ('public.start_next_lot_preview_at(uuid,timestamptz)'), ('public.start_next_lot_preview(uuid)'),
    ('public.advance_lot(uuid)'), ('public.advance_all_auction_rooms()'),
    ('public.publish_lot(uuid)'), ('public.set_lot_updated_at()'),
    ('public.prevent_direct_lot_bid_state_update()'), ('public.prevent_direct_bid_insert()'),
    ('public.handle_new_auction_user()'), ('public.auction_server_time()')
),
function_settings as (
  select e.signature, p.oid, p.proconfig,
    coalesce(p.proconfig @> array['search_path=""']::text[], false) as empty_search_path
  from expected_functions e
  left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(e.signature)
),
expected_tables(table_name) as (
  values ('auction_rooms'), ('lots'), ('bids'), ('lot_images'), ('profiles'), ('watchlist')
),
public_tables as (
  select c.relname::text as table_name, c.relrowsecurity as rls_enabled
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p')
),
rls_inventory as (
  select coalesce(t.table_name, e.table_name) as table_name,
    t.table_name is not null as table_exists, t.rls_enabled,
    (select count(*) from pg_catalog.pg_policies p
      where p.schemaname = 'public' and p.tablename = coalesce(t.table_name, e.table_name)) as policy_count
  from public_tables t full join expected_tables e on e.table_name = t.table_name
),
checks as (
  select 10 as sort_order, 'Lot counts by status'::text as check_name,
    case when exists (select 1 from lot_status_counts where status is null or status not in
      ('DRAFT', 'WAITING', 'PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING', 'UNSOLD', 'SOLD', 'CANCELLED')) then 'FAIL'
      when not exists (select 1 from lot_status_counts) then 'WARN' else 'PASS' end::text as status,
    coalesce((select string_agg(coalesce(status, '<NULL>') || '=' || lot_count, '; ' order by status)
      from lot_status_counts), 'No lots found; data checks have no lot records to inspect.')::text as details
  union all
  select 20, 'Invalid monetary values',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('%s invalid lots. Money must be finite, within the release range, and rounded to pennies. Sample lot IDs: %s',
      count(*), coalesce((select string_agg(id::text, ', ' order by id) from
        (select id from invalid_money order by id limit 10) s), 'none'))
  from invalid_money
  union all
  select 30, 'Invalid bid amounts',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('%s invalid bids. Amount must be 0.01 through 999999999999.99 with at most two decimal places. Sample bid IDs: %s',
      count(*), coalesce((select string_agg(id::text, ', ' order by id) from
        (select id from invalid_bids order by id limit 10) s), 'none'))
  from invalid_bids
  union all
  select 40, 'Duplicate current lots per room',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('%s rooms have multiple PREVIEW/FIRST_BID_WINDOW/ACTIVE_BIDDING lots. Sample room counts: %s',
      count(*), coalesce((select string_agg(room_id::text || '=' || lot_count, '; ' order by room_id) from
        (select * from duplicate_current_lots order by room_id limit 10) s), 'none'))
  from duplicate_current_lots
  union all
  select 50, 'Missing deadlines',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('%s current lots have NULL ends_at. Sample lot IDs: %s', count(*),
      coalesce((select string_agg(id::text, ', ' order by id) from
        (select id from missing_deadlines order by id limit 10) s), 'none'))
  from missing_deadlines
  union all
  select 60, 'Lot result consistency',
    case when count(*) = 0 then 'PASS' else 'FAIL' end,
    format('%s lots violate ACTIVE_BIDDING, SOLD, or FIRST_BID_WINDOW result requirements. Sample lot IDs: %s', count(*),
      coalesce((select string_agg(id::text, ', ' order by id) from
        (select id from invalid_results order by id limit 10) s), 'none'))
  from invalid_results
  union all
  select 70, 'Auction timing values: 30 / 30 / 5 / 7',
    case when exists (select 1 from timing_groups where preview_duration_seconds is distinct from 30
      or first_bid_duration_seconds is distinct from 30 or bid_extension_seconds is distinct from 5
      or requeue_delay_days is distinct from 7) then 'FAIL'
      when not exists (select 1 from timing_groups) then 'WARN' else 'PASS' end,
    'Expected preview=30s; first bid=30s; extension=5s; requeue=7 days. Stored groups: ' ||
      coalesce((select string_agg(format('%s / %s / %s / %s: %s lots',
        coalesce(preview_duration_seconds::text, '<NULL>'), coalesce(first_bid_duration_seconds::text, '<NULL>'),
        coalesce(bid_extension_seconds::text, '<NULL>'), coalesce(requeue_delay_days::text, '<NULL>'), lot_count),
        '; ' order by preview_duration_seconds, first_bid_duration_seconds, bid_extension_seconds, requeue_delay_days)
        from timing_groups), 'no lots')
  union all
  select 80, 'Auction timing column defaults: 30 / 30 / 5 / 7',
    case when bool_and(actual_default is not distinct from expected_value) then 'PASS' else 'FAIL' end,
    string_agg(format('%s: default=%s, expected=%s', column_name,
      coalesce(actual_default, '<missing>'), expected_value), '; ' order by column_name)
  from timing_defaults
  union all
  select 90, 'Function search_path settings',
    case when bool_and(oid is not null and empty_search_path) then 'PASS' else 'FAIL' end,
    'Expected explicit empty search_path for every release function. ' ||
      string_agg(format('%s: %s', signature,
        case when oid is null then 'MISSING FUNCTION'
          else coalesce(proconfig::text, '<no function settings>') end), '; ' order by signature)
  from function_settings
  union all
  select 100, 'Public-schema RLS coverage',
    case when bool_and(table_exists and coalesce(rls_enabled, false) and policy_count > 0)
      then 'PASS' else 'FAIL' end,
    'Presence/enablement check only; review policy expressions below. ' ||
      string_agg(format('public.%s: exists=%s, RLS=%s, policies=%s', table_name,
        table_exists, coalesce(rls_enabled::text, '<missing>'), policy_count), '; ' order by table_name)
  from rls_inventory
  union all
  select 110, 'Public-schema RLS policies',
    case when count(*) = 0 then 'FAIL' else 'WARN' end,
    'Manual review required for roles, commands, USING and WITH CHECK expressions. Policies: ' ||
      coalesce(string_agg(format('public.%s / %s: permissive=%s; roles=%s; command=%s; USING=%s; WITH CHECK=%s',
        tablename, policyname, permissive, roles::text, cmd, coalesce(qual, '<none>'), coalesce(with_check, '<none>')),
        E'\n' order by tablename, policyname), 'none')
  from pg_catalog.pg_policies where schemaname = 'public'
  union all
  select 120, 'public.lots realtime publication membership',
    case when exists (select 1 from pg_catalog.pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lots')
      then 'PASS' else 'FAIL' end,
    case when not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime')
      then 'Publication supabase_realtime is missing.'
      when exists (select 1 from pg_catalog.pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lots')
      then 'public.lots belongs to supabase_realtime.'
      else 'public.lots is not a member of supabase_realtime.' end
)
select check_name, status, details from checks order by sort_order;
