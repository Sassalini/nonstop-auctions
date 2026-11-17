begin;

-- Durable creation intent: never delete/reset an uncertain attempt or its key.
-- Existing mappings and all financial records are left untouched.
create table public.seller_stripe_test_provisioning (
 seller_id uuid primary key references public.profiles(id),
 id uuid not null unique default gen_random_uuid(),
 platform_account text not null check(platform_account ~ '^acct_[A-Za-z0-9]+$'),
 created_at timestamptz not null default clock_timestamp(),
 stripe_account text unique check(stripe_account ~ '^acct_[A-Za-z0-9]+$')
);
alter table public.seller_stripe_test_provisioning enable row level security;
revoke all on public.seller_stripe_test_provisioning from public,anon,authenticated,service_role;
grant select on public.seller_stripe_test_provisioning to service_role;

create function public.reserve_seller_stripe_test_account(p_seller uuid,p_platform text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 r public.seller_stripe_test_provisioning%rowtype;
 account_id text;
begin
 -- Serialize reserve/bind for this seller without holding locks during Stripe calls.
 perform 1 from public.profiles where id=p_seller for update;
 if not found then raise exception 'Seller unavailable'; end if;
 select stripe_account into account_id from public.seller_stripe_test_accounts where seller_id=p_seller;
 if found then return jsonb_build_object('stripe_account',account_id); end if;
 insert into public.seller_stripe_test_provisioning(seller_id,platform_account)
 values(p_seller,p_platform) on conflict(seller_id) do nothing;
 select * into r from public.seller_stripe_test_provisioning where seller_id=p_seller for update;
 if r.platform_account is distinct from p_platform then raise exception 'Seller setup requires reconciliation'; end if;
 return jsonb_build_object('id',r.id,'stripe_account',r.stripe_account,
   'may_create',clock_timestamp() < r.created_at + interval '1 hour');
end;
$$;

create function public.bind_seller_stripe_test_account(p_seller uuid,p_reservation uuid,p_platform text,p_account text)
returns text language plpgsql security definer set search_path='' as $$
declare
 r public.seller_stripe_test_provisioning%rowtype;
 account_id text;
begin
 perform 1 from public.profiles where id=p_seller for update;
 if not found then raise exception 'Seller unavailable'; end if;
 select * into r from public.seller_stripe_test_provisioning where seller_id=p_seller for update;
 if not found or r.id is distinct from p_reservation or r.platform_account is distinct from p_platform
   or (r.stripe_account is not null and r.stripe_account is distinct from p_account) then
  raise exception 'Seller setup does not match the reservation';
 end if;
 select stripe_account into account_id from public.seller_stripe_test_accounts where seller_id=p_seller;
 if found then
  if account_id is distinct from p_account then raise exception 'Seller already has a different payment account'; end if;
  return account_id;
 end if;
 insert into public.seller_stripe_test_accounts(seller_id,stripe_account) values(p_seller,p_account);
 update public.seller_stripe_test_provisioning set stripe_account=p_account where seller_id=p_seller;
 return p_account;
end;
$$;

revoke all on function public.reserve_seller_stripe_test_account(uuid,text),
 public.bind_seller_stripe_test_account(uuid,uuid,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_seller_stripe_test_account(uuid,text),
 public.bind_seller_stripe_test_account(uuid,uuid,text,text) to service_role;

commit;
