// Generate recovery SQL from the unchanged migration, and catalogue expectations
// from a local PostgreSQL reference. Never connects to Supabase.
import { readFile, writeFile } from 'node:fs/promises';
import { releaseDatabase } from '../tests/helpers/release-database.mjs';

const source = await readFile(new URL('../supabase/migrations/005_release_security_and_lifecycle.sql', import.meta.url), 'utf8');
const db = await releaseDatabase();
const quote = value => `'${value.replaceAll("'", "''")}'`;
const tables = ['lots', 'bids', 'auction_rooms', 'lot_images', 'profiles', 'watchlist'];
const tableList = tables.map(quote).join(',');
const signatures = [...source.matchAll(/(?:alter|create or replace) function public\.(\w+)\(([^)]*)\)/gi)].map(match => {
  const args = match[2].trim().split(',').filter(Boolean).map(arg => arg.trim().replace(/^\w+\s+(?=uuid|numeric|timestamptz)/, ''));
  return `public.${match[1]}(${args.join(',')})`;
});
const constraints = [...source.matchAll(/alter table public\.(\w+) add constraint (\w+) check \([\s\S]*?\n\);/g)];
const indexes = [...source.matchAll(/create index if not exists (\w+) on public\.(\w+) \(([^)]+)\);/g)];
const checks = [];
const add = (category, item, expected) => checks.push({ category, item, expected });

for (const match of constraints) {
  const { rows } = await db.query(`select pg_get_constraintdef(oid) as definition, convalidated as validated,
    contype as type from pg_constraint where conrelid = $1::regclass and conname = $2`, [`public.${match[1]}`, match[2]]);
  add('constraint', `public.${match[1]}.${match[2]}`, rows[0]);
}
for (const signature of signatures) {
  const { rows } = await db.query(`select md5(btrim(replace(p.prosrc, chr(13), ''))) as body_md5,
    l.lanname as language, p.prosecdef as security_definer, p.provolatile as volatility,
    p.proconfig as settings, p.proargnames as argument_names, p.proretset as returns_set,
    n.nspname || '.' || t.typname as return_type, pg_get_userbyid(p.proowner) as owner
    from pg_proc p join pg_language l on l.oid = p.prolang
    join pg_type t on t.oid = p.prorettype join pg_namespace n on n.oid = t.typnamespace
    where p.oid = $1::regprocedure`, [signature]);
  add('function', signature, rows[0]);
  const { rows: aclRows } = await db.query(`select
    has_function_privilege('anon', $1, 'EXECUTE') as anon,
    has_function_privilege('authenticated', $1, 'EXECUTE') as authenticated,
    has_function_privilege('anon', $1, 'EXECUTE WITH GRANT OPTION') as anon_grant_option,
    has_function_privilege('authenticated', $1, 'EXECUTE WITH GRANT OPTION') as authenticated_grant_option,
    exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
      where p.oid = $1::regprocedure and a.grantee = 0 and a.privilege_type = 'EXECUTE') as public`, [signature]);
  if (signature === 'public.advance_all_auction_rooms()') {
    aclRows[0].service_role = true;
    aclRows[0].service_role_grant_option = false;
  }
  add('function_acl', signature, aclRows[0]);
}
const { rows: policies } = await db.query(`select tablename, policyname, roles, cmd, permissive,
  qual, with_check from pg_policies where schemaname = 'public' and tablename in (${tableList}) order by tablename, policyname`);
for (const { tablename, policyname, ...expected } of policies) add('policy', `public.${tablename}.${policyname}`, expected);
for (const name of ['Anyone can read bids for visible lots', 'Logged-in users can insert bids']) {
  add('removed_policy', `public.bids.${name}`, { absent: true });
}
for (const table of tables) {
  const { rows } = await db.query(`select attname as name, format_type(atttypid, atttypmod) as type, attnotnull as not_null
    from pg_attribute where attrelid = $1::regclass and attnum > 0 and not attisdropped order by attname`, [`public.${table}`]);
  add('baseline_columns', `public.${table}`, rows);
  add('rls', `public.${table}`, { enabled: true });
  for (const role of ['anon', 'authenticated']) {
    const { rows: tableGrants } = await db.query(`select privilege, has_table_privilege($1, $2, privilege) as allowed,
      has_table_privilege($1, $2, privilege || ' WITH GRANT OPTION') as grant_option
      from unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege order by privilege`, [role, `public.${table}`]);
    add('table_acl', `public.${table}:${role}`, tableGrants);
    const { rows: columnGrants } = await db.query(`select a.attname as column, privilege,
      has_column_privilege($1, a.attrelid, a.attnum, privilege) as allowed,
      has_column_privilege($1, a.attrelid, a.attnum, privilege || ' WITH GRANT OPTION') as grant_option
      from pg_attribute a cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
      where a.attrelid = $2::regclass and a.attnum > 0 and not a.attisdropped order by a.attname, privilege`, [role, `public.${table}`]);
    add('column_acl', `public.${table}:${role}`, columnGrants);
  }
}
const { rows: triggers } = await db.query(`select n.nspname || '.' || c.relname || '.' || t.tgname as item,
  pg_get_triggerdef(t.oid) as definition, t.tgenabled as enabled
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and ((n.nspname = 'public' and c.relname in ('lots','bids'))
    or (n.nspname = 'auth' and t.tgname = 'on_auction_user_created')) order by item`);
for (const { item, ...expected } of triggers) add('trigger', item, expected);
for (const match of indexes) {
  const { rows } = await db.query(`select pg_get_indexdef(i.indexrelid) as definition, i.indisvalid as valid,
    i.indisready as ready from pg_index i where i.indexrelid = $1::regclass`, [`public.${match[1]}`]);
  add('index', `public.${match[1]}`, rows[0]);
}
await db.close();

const manifest = `[\n${checks.map(check => JSON.stringify(check)).join(',\n')}\n]`;
const audit = `-- READ ONLY: run in Supabase SQL Editor as postgres. One result grid.
-- Generated from migration 005 and a local PostgreSQL catalogue reference.
-- APPLIED = matches; MISSING = absent; DIFFERENT = inspect before recovery.
-- Formatting-only changes can produce DIFFERENT for bodies/expressions.
-- No columns or Realtime publication changes were introduced in migration 005.
with expected as (
  select * from jsonb_to_recordset($manifest$${manifest}$manifest$::jsonb)
    as e(category text, item text, expected jsonb)
), actual as (
  select e.*, case e.category
    when 'constraint' then (select jsonb_build_object('definition', pg_get_constraintdef(c.oid),
      'validated', c.convalidated, 'type', c.contype) from pg_constraint c
      where c.conrelid = to_regclass(split_part(e.item,'.',1) || '.' || split_part(e.item,'.',2))
      and c.conname = split_part(e.item,'.',3))
    when 'function' then (select jsonb_build_object('body_md5', md5(btrim(replace(p.prosrc,chr(13),''))),
      'language', l.lanname, 'security_definer', p.prosecdef, 'volatility', p.provolatile,
      'settings', p.proconfig, 'argument_names', p.proargnames, 'returns_set', p.proretset,
      'return_type', n.nspname || '.' || t.typname, 'owner', pg_get_userbyid(p.proowner))
      from pg_proc p join pg_language l on l.oid = p.prolang join pg_type t on t.oid = p.prorettype
      join pg_namespace n on n.oid = t.typnamespace where p.oid = to_regprocedure(e.item))
    when 'function_acl' then (select jsonb_build_object(
      'anon', has_function_privilege('anon', p.oid, 'EXECUTE'),
      'authenticated', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
      'anon_grant_option', has_function_privilege('anon', p.oid, 'EXECUTE WITH GRANT OPTION'),
      'authenticated_grant_option', has_function_privilege('authenticated', p.oid, 'EXECUTE WITH GRANT OPTION'),
      'public', exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
        where a.grantee = 0 and a.privilege_type = 'EXECUTE'))
      || case when e.expected ? 'service_role' then jsonb_build_object(
        'service_role',has_function_privilege('service_role',p.oid,'EXECUTE'),
        'service_role_grant_option',has_function_privilege('service_role',p.oid,'EXECUTE WITH GRANT OPTION')) else '{}'::jsonb end
      from pg_proc p where p.oid = to_regprocedure(e.item))
    when 'policy' then (select jsonb_build_object('roles', roles, 'cmd', cmd,
      'permissive', permissive, 'qual', qual, 'with_check', with_check) from pg_policies
      where schemaname = split_part(e.item,'.',1) and tablename = split_part(e.item,'.',2)
        and policyname = split_part(e.item,'.',3))
    when 'removed_policy' then jsonb_build_object('absent', not exists(select 1 from pg_policies
      where schemaname = split_part(e.item,'.',1) and tablename = split_part(e.item,'.',2)
        and policyname = split_part(e.item,'.',3)))
    when 'baseline_columns' then (select jsonb_agg(jsonb_build_object('name', a.attname,
      'type', format_type(a.atttypid,a.atttypmod), 'not_null',a.attnotnull) order by a.attname)
      from pg_attribute a where a.attrelid = to_regclass(e.item) and a.attnum > 0 and not a.attisdropped
      and a.attname in (select j->>'name' from jsonb_array_elements(e.expected) j))
    when 'rls' then (select jsonb_build_object('enabled', relrowsecurity) from pg_class where oid = to_regclass(e.item))
    when 'table_acl' then (select jsonb_agg(jsonb_build_object('privilege', privilege,
      'allowed', has_table_privilege(split_part(e.item,':',2),c.oid,privilege),
      'grant_option',has_table_privilege(split_part(e.item,':',2),c.oid,privilege || ' WITH GRANT OPTION')) order by privilege)
      from pg_class c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) privilege
      where c.oid = to_regclass(split_part(e.item,':',1)))
    when 'column_acl' then (select jsonb_agg(jsonb_build_object('column',a.attname,'privilege',privilege,
      'allowed',has_column_privilege(split_part(e.item,':',2),a.attrelid,a.attnum,privilege),
      'grant_option',has_column_privilege(split_part(e.item,':',2),a.attrelid,a.attnum,privilege || ' WITH GRANT OPTION')) order by a.attname,privilege)
      from pg_attribute a cross join unnest(array['SELECT','INSERT','UPDATE','REFERENCES']) privilege
      where a.attrelid = to_regclass(split_part(e.item,':',1)) and a.attnum > 0 and not a.attisdropped
      and a.attname in (select j->>'column' from jsonb_array_elements(e.expected) j))
    when 'trigger' then (select jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
      from pg_trigger t where t.tgrelid = to_regclass(split_part(e.item,'.',1) || '.' || split_part(e.item,'.',2))
      and t.tgname = split_part(e.item,'.',3) and not t.tgisinternal)
    when 'index' then (select jsonb_build_object('definition',pg_get_indexdef(i.indexrelid),
      'valid',i.indisvalid,'ready',i.indisready) from pg_index i where i.indexrelid = to_regclass(e.item))
  end as actual from expected e
), report as (
  select category, item, case when actual is null then 'MISSING'
    when actual = expected then 'APPLIED' else 'DIFFERENT' end as status, expected, actual from actual
  union all select 'policy', p.schemaname || '.' || p.tablename || '.' || p.policyname,
    'UNEXPECTED', null::jsonb, to_jsonb(p) from pg_policies p
    where p.schemaname = 'public' and p.tablename in (${tableList})
    and not exists(select 1 from expected e where e.category in ('policy','removed_policy')
      and e.item = p.schemaname || '.' || p.tablename || '.' || p.policyname)
  union all select 'trigger', n.nspname || '.' || c.relname || '.' || t.tgname,
    'UNEXPECTED', null::jsonb, jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled)
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'public' and c.relname in (${tableList})
      and not exists(select 1 from expected e where e.category = 'trigger'
        and e.item = n.nspname || '.' || c.relname || '.' || t.tgname)
  union all select 'columns_added','migration 005','INFO','0'::jsonb,
    to_jsonb('Migration 005 adds no columns; baseline column checks refer to migrations 001-004.'::text)
  union all select 'data','missing user profiles',
    case when count(*) = 0 then 'APPLIED' else 'MISSING' end, '0'::jsonb, to_jsonb(count(*))
    from auth.users u left join public.profiles p on p.id = u.id where p.id is null
  union all select 'data','lots with legacy timings',
    case when count(*) = 0 then 'APPLIED' else 'DIFFERENT' end, '0'::jsonb, to_jsonb(count(*))
    from public.lots where preview_duration_seconds <> 30 or first_bid_duration_seconds <> 30
      or bid_extension_seconds <> 5 or requeue_delay_days <> 7
  union all select 'realtime','supabase_realtime/public.lots',
    case when exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'lots') then 'BASELINE_PRESENT' else 'BASELINE_MISSING' end,
    null::jsonb, to_jsonb('Publication membership belongs to migration 004, not 005; recovery does not change it.'::text)
)
select * from report order by category, item;
-- Run release_preflight.sql separately for data validation and timing groups.
-- This catalogue check does not execute auction functions or validate cron/Auth services.
`;
await writeFile(new URL('../supabase/operations/check_migration_005.sql', import.meta.url), audit);

// Assert the baseline before making any changes. Preserve unexpected/custom objects.
const baseline = checks.filter(e => ['baseline_columns', 'trigger', 'index', 'constraint'].includes(e.category));
const guards = `
set local lock_timeout = '5s';
set local statement_timeout = '120s';
set local search_path = pg_catalog, public;
lock table public.lots, public.bids, public.auction_rooms, public.lot_images,
  public.profiles, public.watchlist in share row exclusive mode;
do $baseline$
declare e jsonb; col jsonb; actual text; relation regclass;
begin
  for e in select value from jsonb_array_elements($expected$[\n${baseline.map(entry => JSON.stringify(entry)).join(',\n')}\n]$expected$::jsonb) loop
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
  if exists(select 1 from pg_policies p where p.schemaname = 'public' and p.tablename in (${tableList})
    and (p.tablename || '.' || p.policyname) not in (${policies.map(p => quote(`${p.tablename}.${p.policyname}`)).concat([
      quote('bids.Anyone can read bids for visible lots'), quote('bids.Logged-in users can insert bids'),
    ]).join(',')})) then
    raise exception 'Unexpected auction RLS policy detected. Review check_migration_005.sql; recovery will not remove custom policies.';
  end if;
  if exists(select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where not t.tgisinternal and n.nspname = 'public' and c.relname in (${tableList})
      and (c.relname || '.' || t.tgname) not in ('lots.set_lot_updated_at','lots.prevent_direct_lot_bid_state_update','bids.prevent_direct_bid_insert')) then
    raise exception 'Unexpected auction trigger detected. Inspect it; recovery will not remove custom triggers or invoke them during data changes.';
  end if;
  if exists(select 1 from pg_proc where oid in (${signatures.map(s => `to_regprocedure(${quote(s)})`).join(',')})
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
`;
let recovery = source.replace('begin;', `begin;\n${guards}`);
for (const match of constraints) {
  recovery = recovery.replace(match[0], `do $constraint$
begin
  if not exists(select 1 from pg_constraint where conrelid = 'public.${match[1]}'::regclass and conname = '${match[2]}') then
    ${match[0]}
  end if;
  if exists(select 1 from pg_constraint where conrelid = 'public.${match[1]}'::regclass
    and conname = '${match[2]}' and not convalidated) then
    alter table public.${match[1]} validate constraint ${match[2]};
  end if;
end;
$constraint$;`);
}
// Every known policy gets an explicit CREATE, including the six formerly ALTER-only policies.
recovery = recovery.replace(/alter policy [^;]+;/g, '').replace(/drop policy if exists [^;]+;/g, '');
const policyStart = recovery.indexOf('create policy "Anyone can read non-draft lots"');
const policyEnd = recovery.indexOf('create or replace function public.handle_new_auction_user');
const policySQL = policies.filter(p => p.tablename !== 'auction_rooms').map(p => `drop policy if exists ${JSON.stringify(p.policyname)} on public.${p.tablename};
create policy ${JSON.stringify(p.policyname)} on public.${p.tablename} as ${p.permissive} for ${p.cmd}
to ${p.roles.join(', ')}${p.qual ? `\nusing (${p.qual})` : ''}${p.with_check ? `\nwith check (${p.with_check})` : ''};`).join('\n\n');
recovery = recovery.slice(0, policyStart) + `drop policy if exists "Anyone can read bids for visible lots" on public.bids;
drop policy if exists "Logged-in users can insert bids" on public.bids;\n${policySQL}\n\n` + recovery.slice(policyEnd);
recovery = recovery.replace(/create trigger on_auction_user_created after insert on auth\.users\nfor each row execute function public\.handle_new_auction_user\(\);/, `do $trigger$
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
$enable_triggers$;`);
for (const table of tables) recovery = recovery.replace('-- Grant only catalogue columns.', `alter table public.${table} enable row level security;\n-- Grant only catalogue columns.`);
const header = `-- IDEMPOTENT RECOVERY FOR MIGRATION 005 (operations script, not an automatic migration).
-- Run check_migration_005.sql and release_preflight.sql FIRST as postgres.
-- Back up, pause bidding and all auction schedulers, then run this WHOLE file.
-- Original migration 005 is unchanged. This restores its intended definitions/ACLs.
-- Preserves rows, bid history, deadlines, winners, queue positions and publication membership.
-- Only data changes: normalize inactive legacy timings; insert missing profiles.
-- No cron jobs, extensions, new columns, DROP TABLE, DROP COLUMN, or DELETE.
-- Existing incompatible constraints/indexes/triggers/custom policies abort for review.
-- On any error the transaction rolls back; do not continue individual fragments.
-- Re-run the read-only checks after success. APPLIED objects can be left alone.
`;
await writeFile(new URL('../supabase/operations/recover_migration_005.sql', import.meta.url), header + recovery);
