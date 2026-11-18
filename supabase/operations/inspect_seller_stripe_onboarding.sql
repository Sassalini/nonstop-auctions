-- READ ONLY. Run in the intended isolated Supabase project as an operator.
-- Replace ONLY the sample seller UUID with the verified seller's auth user ID.
-- Output contains internal IDs; keep it in the private support investigation.
-- Check schema existence first; do not run the second query if either is null.
select to_regclass('public.seller_stripe_test_accounts') as mappings_table,
       to_regclass('public.seller_stripe_test_provisioning') as intents_table,
       to_regprocedure('public.reserve_seller_stripe_test_account(uuid,text)') as reserve_function,
       to_regprocedure('public.bind_seller_stripe_test_account(uuid,uuid,text,text)') as bind_function;

begin transaction read only;

with target(seller_id) as (
 values ('00000000-0000-0000-0000-000000000000'::uuid)
)
select
 exists(select 1 from public.profiles where id=t.seller_id) as seller_exists,
 m.stripe_account as mapped_account,
 p.id as reservation_id,
 p.platform_account as reserved_platform,
 p.stripe_account as provisioned_account,
 p.created_at as reserved_at,
 clock_timestamp() as inspected_at,
 clock_timestamp()-p.created_at as reservation_age,
 clock_timestamp() < p.created_at+interval '1 hour' as inside_original_retry_window,
 case when p.id is null then null
      else 'nonstop-test-seller-v1-' || p.id::text end as original_idempotency_key,
 case
  when m.stripe_account is not null and p.stripe_account is not null
       and m.stripe_account is distinct from p.stripe_account then 'CONFLICT_REQUIRES_REVIEW'
  when m.stripe_account is not null then 'MAPPED_VERIFY_STRIPE'
  when p.stripe_account is not null then 'INTENT_ACCOUNT_WITHOUT_MAPPING_REQUIRES_REVIEW'
  when p.id is null then 'NO_MAPPING_OR_INTENT'
  when clock_timestamp() >= p.created_at+interval '1 hour' then 'EXPIRED_OUTCOME_UNKNOWN'
  else 'PENDING_OUTCOME_UNKNOWN'
 end as database_observation
from target t
left join public.seller_stripe_test_accounts m on m.seller_id=t.seller_id
left join public.seller_stripe_test_provisioning p on p.seller_id=t.seller_id;

-- Check deployed function definitions without invoking either RPC. reserve()
-- inserts state, so it must NOT be used as a diagnostic query.
select p.proname, pg_get_functiondef(p.oid) as definition
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname in
 ('reserve_seller_stripe_test_account','bind_seller_stripe_test_account');

-- Columns show exactly what is recorded; there is no failed/pending status,
-- attempt counter, last-error field, or renewable provisioning lock.
select table_name,column_name,data_type,is_nullable
from information_schema.columns
where table_schema='public' and table_name in
 ('seller_stripe_test_accounts','seller_stripe_test_provisioning')
order by table_name,ordinal_position;

commit;
