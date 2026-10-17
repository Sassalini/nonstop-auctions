-- READ-ONLY POST-CLEANUP VERIFICATION. No persistent tables are changed.
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
