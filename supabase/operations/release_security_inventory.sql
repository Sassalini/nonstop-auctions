-- READ ONLY. Run as postgres/database owner against the intended hosted project.
-- One result grid. Does not invoke any bidding/lifecycle function or change data.
-- Companion to check_migration_005.sql: inventories live policies, effective RPC
-- access, identity-column exposure, storage configuration and UNSOLD eligibility.
-- Review definitions; this deliberately does not label arbitrary policies safe.
with functions(signature) as (
  values ('public.place_bid(uuid,numeric)'), ('public.publish_lot(uuid)'),
    ('public.start_next_lot_preview_at(uuid,timestamptz)'), ('public.start_next_lot_preview(uuid)'),
    ('public.advance_lot(uuid)'), ('public.advance_room_lifecycle(uuid)'),
    ('public.advance_all_auction_rooms()'), ('public.auction_server_time()')
), inventory as (
  select 'policy'::text as category, format('%s.%s / %s', schemaname, tablename, policyname) as item,
    jsonb_build_object('permissive', permissive, 'roles', roles, 'command', cmd,
      'using', qual, 'with_check', with_check) as details
  from pg_catalog.pg_policies where schemaname in ('public', 'storage')
  union all
  select 'table_rls', format('%s.%s', n.nspname, c.relname),
    jsonb_build_object('enabled', c.relrowsecurity, 'forced', c.relforcerowsecurity,
      'anon_select', pg_catalog.has_table_privilege('anon', c.oid, 'SELECT'),
      'anon_insert', pg_catalog.has_table_privilege('anon', c.oid, 'INSERT'),
      'anon_update', pg_catalog.has_table_privilege('anon', c.oid, 'UPDATE'),
      'anon_delete', pg_catalog.has_table_privilege('anon', c.oid, 'DELETE'),
      'authenticated_select', pg_catalog.has_table_privilege('authenticated', c.oid, 'SELECT'),
      'authenticated_insert', pg_catalog.has_table_privilege('authenticated', c.oid, 'INSERT'),
      'authenticated_update', pg_catalog.has_table_privilege('authenticated', c.oid, 'UPDATE'),
      'authenticated_delete', pg_catalog.has_table_privilege('authenticated', c.oid, 'DELETE'))
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where n.nspname in ('public', 'storage') and c.relkind in ('r', 'p')
  union all
  select 'column_access', format('public.%s.%s', c.relname, a.attname),
    jsonb_build_object('anon_select', pg_catalog.has_column_privilege('anon', c.oid, a.attnum, 'SELECT'),
      'anon_insert', pg_catalog.has_column_privilege('anon', c.oid, a.attnum, 'INSERT'),
      'anon_update', pg_catalog.has_column_privilege('anon', c.oid, a.attnum, 'UPDATE'),
      'authenticated_select', pg_catalog.has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT'),
      'authenticated_insert', pg_catalog.has_column_privilege('authenticated', c.oid, a.attnum, 'INSERT'),
      'authenticated_update', pg_catalog.has_column_privilege('authenticated', c.oid, a.attnum, 'UPDATE'))
  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  join pg_catalog.pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
  where n.nspname = 'public' and c.relname in ('lots', 'bids', 'lot_images', 'profiles', 'watchlist', 'auction_rooms')
  union all
  select 'function_access', f.signature,
    jsonb_build_object('exists', p.oid is not null, 'owner', pg_catalog.pg_get_userbyid(p.proowner),
      'security_definer', p.prosecdef, 'settings', p.proconfig,
      'anon_execute', pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated_execute', pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'service_role_execute', pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE'))
  from functions f left join pg_catalog.pg_proc p on p.oid = pg_catalog.to_regprocedure(f.signature)
  union all
  select 'storage_bucket', id,
    jsonb_build_object('public', public, 'file_size_limit', file_size_limit,
      'allowed_mime_types', allowed_mime_types)
  from storage.buckets
  union all
  select 'unsold_summary', 'All UNSOLD lots',
    jsonb_build_object('observed_at', now(), 'count', count(*),
      'eligible_now', count(*) filter (where next_eligible_at <= now()),
      'not_yet_eligible', count(*) filter (where next_eligible_at > now()),
      'missing_unsold_at', count(*) filter (where unsold_at is null),
      'missing_eligibility', count(*) filter (where next_eligible_at is null),
      'incorrect_seven_day_gap', count(*) filter (where unsold_at is not null
        and next_eligible_at is distinct from unsold_at + interval '7 days'),
      'with_bids', count(*) filter (where bid_count <> 0),
      'first_eligible_at', min(next_eligible_at), 'last_eligible_at', max(next_eligible_at))
  from public.lots where status = 'UNSOLD'
  union all
  select 'unsold_lot', l.id::text,
    jsonb_build_object('room', r.slug, 'room_active', r.is_active, 'bid_count', l.bid_count,
      'unsold_at', l.unsold_at, 'next_eligible_at', l.next_eligible_at,
      'eligible_now', l.next_eligible_at <= now(), 'queue_position', l.queue_position,
      'current_lots_in_room', (select count(*) from public.lots x where x.room_id = l.room_id
        and x.status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING')))
  from public.lots l join public.auction_rooms r on r.id = l.room_id where l.status = 'UNSOLD'
  union all
  select 'scheduler', 'Cron catalogue availability',
    jsonb_build_object('cron_job_table_exists', pg_catalog.to_regclass('cron.job') is not null,
      'cron_run_history_exists', pg_catalog.to_regclass('cron.job_run_details') is not null,
      'note', 'Existence is not proof of an active/successful job. Inspect the optional SELECTs below separately.')
)
select category, item, details from inventory order by category, item;

-- If Cron catalogue tables exist, these additional READ ONLY queries show job state:
-- select jobid, jobname, schedule, active, username, command
-- from cron.job where jobname = 'nonstop-auction-lifecycle';
-- select jobid, status, return_message, start_time, end_time
-- from cron.job_run_details
-- where jobid in (select jobid from cron.job where jobname = 'nonstop-auction-lifecycle')
-- order by start_time desc limit 20;
