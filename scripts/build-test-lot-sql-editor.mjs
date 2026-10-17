// File generation only. Never connects to Supabase or executes operation SQL.
// Reuses the original inventory/cleanup safety body verbatim.
import { readFile, writeFile } from 'node:fs/promises';

const directory = 'supabase/operations';
const inventory = await readFile(`${directory}/test_lot_inventory.sql`, 'utf8');
const cleanup = await readFile(`${directory}/cleanup_reviewed_test_lots.sql`, 'utf8');
const originalInputs = `create temporary table cleanup_control(dry_run boolean not null,expected_count integer not null,confirmation text not null) on commit drop;
insert into cleanup_control values (true,0,'');
-- For application only: false, exact reviewed count, 'DELETE REVIEWED TEST LOTS ONLY'.
create temporary table cleanup_approved_lots(lot_id uuid primary key) on commit drop;
-- Add ONLY reviewed, eligible UUIDs, for example:
-- insert into cleanup_approved_lots values ('20000000-0000-0000-0000-000000000701');`;
const originalOutputs = `select * from cleanup_preview order by lot_id;
select * from cleanup_result;`;
if (!cleanup.includes(originalInputs) || !cleanup.includes(originalOutputs)) throw new Error('Original cleanup changed: review the editor generator before regenerating.');

const editorInputs = `-- ========== EDIT ONLY THIS INPUT BLOCK ==========
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
  cross join lateral jsonb_array_elements_text(input.reviewed_lot_ids) as id(value);`;

const editorOutputs = `-- One result grid exposes the summary AND each reviewed ID in SQL Editor.
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
select row_type,lot_id,details from result order by sort_order,lot_id;`;
await writeFile(`${directory}/cleanup_reviewed_test_lots_sql_editor.sql`, cleanup
  .replace('-- ONE-TIME MANUAL CLEANUP.', '-- SQL EDITOR VERSION — ONE-TIME MANUAL CLEANUP.')
  .replace(originalInputs, editorInputs).replace(originalOutputs, editorOutputs));

const originalInventoryOutput = `select * from jsonb_to_recordset(current_setting('app.test_lot_inventory')::jsonb) as r(section text,record_id text,details jsonb)
order by section,record_id;`;
if (!inventory.includes(originalInventoryOutput)) throw new Error('Inventory output changed: review the generator.');
const exportOutput = `-- The summary JSON is a convenience for COPYING reviewed IDs, not an approval.
-- Every lot row remains visible, including excluded records and review reasons.
with report as (
  select * from jsonb_to_recordset(current_setting('app.test_lot_inventory')::jsonb)
    as r(section text,record_id text,details jsonb)
), lot_rows as (
  select record_id::uuid as lot_id,details from report where section='lot'
), summary as (
  select count(*) as total_lots,
    count(*) filter(where (details->>'eligible_for_reviewed_cleanup')::boolean) as eligible_count,
    coalesce(jsonb_agg(lot_id order by lot_id) filter(where (details->>'eligible_for_reviewed_cleanup')::boolean),'[]'::jsonb)::text as eligible_id_json
  from lot_rows
), result as (
  select 0 as sort_order,'summary'::text as row_type,null::uuid as lot_id,
    null::text as room,null::text as title,null::boolean as eligible,
    null::text as review_reason,s.total_lots,s.eligible_count,s.eligible_id_json,
    null::bigint as bid_records,null::text as highest_bidder_id,null::text as winning_bid,
    null::bigint as non_seed_account_dependencies from summary s
  union all
  select 1,'lot',lot_id,details->>'room_name',details->>'title',
    (details->>'eligible_for_reviewed_cleanup')::boolean,details->>'review_reason',
    null,null,null,(details->>'bid_records')::bigint,details->>'highest_bidder_id',details->>'winning_bid',
    (details->>'non_seed_account_dependencies')::bigint from lot_rows
)
select row_type,lot_id,room,title,eligible,review_reason,total_lots,eligible_count,eligible_id_json,
  bid_records,highest_bidder_id,winning_bid,non_seed_account_dependencies
from result order by sort_order,room,lot_id;`;
await writeFile(`${directory}/test_lot_review_list.sql`, inventory
  .replace('-- READ-ONLY OWNER REPORT.', '-- READ-ONLY REVIEW LIST AND UUID EXPORT.')
  .replace(originalInventoryOutput, exportOutput));

const verification = `-- READ-ONLY POST-CLEANUP VERIFICATION. No persistent tables are changed.
-- Paste exactly the same reviewed UUID JSON array and expected count as cleanup.
begin read only;
set local statement_timeout = '30s';
do $$
declare
  expected_count integer := 0; -- EDIT: reviewed count, e.g. 60 if all 60 were approved
  reviewed_ids jsonb := $reviewed_ids$
[]
  $reviewed_ids$::jsonb; -- EDIT: same reviewed list used by the cleanup script
  id_count integer; unique_count integer; notification_rows jsonb := '[]';
begin
  if jsonb_typeof(reviewed_ids) <> 'array' then raise exception 'Reviewed IDs must be a JSON array.'; end if;
  select count(*),count(distinct value::uuid) into id_count,unique_count from jsonb_array_elements_text(reviewed_ids);
  if expected_count<=0 or id_count<>expected_count or unique_count<>id_count then
    raise exception 'Paste the nonempty reviewed UUID list and matching expected count before verification.';
  end if;
  if to_regclass('public.notifications') is not null then
    execute 'select coalesce(jsonb_agg(jsonb_build_object(''lot_id'',lot_id)),''[]''::jsonb) from public.notifications where lot_id in (select value::uuid from jsonb_array_elements_text($1))'
      into notification_rows using reviewed_ids;
  end if;
  perform set_config('app.cleanup_reviewed_ids',reviewed_ids::text,true);
  perform set_config('app.cleanup_notification_rows',notification_rows::text,true);
end;
$$;
with reviewed as (
  select value::uuid as lot_id from jsonb_array_elements_text(current_setting('app.cleanup_reviewed_ids')::jsonb)
), remaining as (
  select a.lot_id,
    (select count(*) from public.lots l where l.id=a.lot_id) as lots_remaining,
    (select count(*) from public.bids b where b.lot_id=a.lot_id) as bids_remaining,
    (select count(*) from public.watchlist w where w.lot_id=a.lot_id) as watchlists_remaining,
    (select count(*) from public.lot_images i where i.lot_id=a.lot_id) as images_remaining,
    (select count(*) from jsonb_to_recordset(current_setting('app.cleanup_notification_rows')::jsonb) as n(lot_id uuid) where n.lot_id=a.lot_id) as notifications_remaining
  from reviewed a
), result as (
  select 0 as sort_order,'summary'::text as row_type,null::uuid as lot_id,
    jsonb_build_object('reviewed_count',count(*),'approved_lots_remaining',sum(lots_remaining),
      'bids_remaining',sum(bids_remaining),'watchlists_remaining',sum(watchlists_remaining),
      'images_remaining',sum(images_remaining),'notifications_remaining',sum(notifications_remaining),
      'all_approved_lots_removed',bool_and(lots_remaining=0)) as details from remaining
  union all
  select 1,'reviewed_lot',lot_id,to_jsonb(r)-'lot_id' from remaining r
)
select row_type,lot_id,details from result order by sort_order,lot_id;
commit;
`;
await writeFile(`${directory}/verify_reviewed_test_lot_cleanup.sql`, verification);
console.log('Generated SQL Editor cleanup, read-only review/UUID export, and read-only verification. Original operation files unchanged; no database connection.');
