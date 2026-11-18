begin;

-- Distinguish the one request which inserted a new intent from continuations.
-- No existing intent, timestamp, mapping, key, or financial record is changed.
create or replace function public.reserve_seller_stripe_test_account(p_seller uuid,p_platform text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r public.seller_stripe_test_provisioning%rowtype;
 account_id text;
 inserted_id uuid;
begin
 perform 1 from public.profiles where id=p_seller for update;
 if not found then raise exception 'Seller unavailable'; end if;
 select stripe_account into account_id from public.seller_stripe_test_accounts where seller_id=p_seller;
 if found then return jsonb_build_object('stripe_account',account_id); end if;
 insert into public.seller_stripe_test_provisioning(seller_id,platform_account)
 values(p_seller,p_platform) on conflict(seller_id) do nothing returning id into inserted_id;
 select * into r from public.seller_stripe_test_provisioning where seller_id=p_seller for update;
 if r.platform_account is distinct from p_platform then raise exception 'Seller setup requires reconciliation'; end if;
 return jsonb_build_object('id',r.id,'stripe_account',r.stripe_account,
   'may_create',clock_timestamp() < r.created_at + interval '1 hour',
   'new_reservation',inserted_id is not null);
end;
$$;

revoke all on function public.reserve_seller_stripe_test_account(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_seller_stripe_test_account(uuid,text) to service_role;

commit;
