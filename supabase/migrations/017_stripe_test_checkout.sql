begin;

-- Use an isolated staging database. These mappings are provisioned by an operator
-- in a Stripe sandbox and are never visible to browsers.
create table public.seller_stripe_test_accounts (
 seller_id uuid primary key references public.profiles(id),
 stripe_account text not null unique check(stripe_account ~ '^acct_[A-Za-z0-9]+$')
);
create table public.stripe_checkout_attempts (
 id uuid primary key default gen_random_uuid(),
 order_id uuid not null references public.fulfilment_orders(id),
 stripe_account text not null,
 session_id text unique,
 payment_intent_id text unique,
 method text not null check(method in ('delivery','collection')),
 postage_minor integer not null check(postage_minor>=0),
 total_minor integer not null check(total_minor between 30 and 99999999),
 pending_address jsonb,
 created_at timestamptz not null default clock_timestamp(),
 released_at timestamptz
);
create unique index one_live_checkout_per_order on public.stripe_checkout_attempts(order_id) where released_at is null;
create table public.stripe_payment_events (
 id text primary key,
 attempt_id uuid not null references public.stripe_checkout_attempts(id),
 kind text not null,
 processed_at timestamptz not null default clock_timestamp()
);
create table public.stripe_payment_disputes (
 id text primary key,
 attempt_id uuid not null references public.stripe_checkout_attempts(id),
 status text not null check(status in ('OPEN','LOST','RESOLVED'))
);
create index stripe_payment_disputes_attempt_idx on public.stripe_payment_disputes(attempt_id);
create table public.stripe_payment_refunds (
 id text primary key,
 attempt_id uuid not null references public.stripe_checkout_attempts(id),
 amount_minor integer not null check(amount_minor>0),
 status text not null check(status in ('PENDING','SUCCEEDED','FAILED'))
);
create index stripe_payment_refunds_attempt_idx on public.stripe_payment_refunds(attempt_id);

alter table public.seller_stripe_test_accounts enable row level security;
alter table public.stripe_checkout_attempts enable row level security;
alter table public.stripe_payment_events enable row level security;
alter table public.stripe_payment_disputes enable row level security;
alter table public.stripe_payment_refunds enable row level security;
revoke all on public.seller_stripe_test_accounts,public.stripe_checkout_attempts,
 public.stripe_payment_events,public.stripe_payment_disputes,public.stripe_payment_refunds from public,anon,authenticated,service_role;
grant select on public.seller_stripe_test_accounts,public.stripe_checkout_attempts,public.stripe_payment_events to service_role;

create function public.reserve_test_checkout(p_buyer uuid,p_order uuid,p_method text,p_address uuid,p_account text)
returns public.stripe_checkout_attempts language plpgsql security definer set search_path='' as $$
declare
 o public.fulfilment_orders%rowtype;
 a public.stripe_checkout_attempts%rowtype;
 address jsonb;
 postcode text;
 postage integer := 0;
 mode text;
begin
 select * into o from public.fulfilment_orders where id=p_order and buyer_id=p_buyer for update;
 if not found then raise exception 'Order unavailable'; end if;
 mode := o.terms_snapshot->>'mode';
 if mode is null or o.winning_minor is null or o.shipping_state<>'AWAITING_PAYMENT'
   or o.payment_state not in ('UNPAID','PENDING','FAILED') then raise exception 'This order is not eligible for checkout'; end if;
 select * into a from public.stripe_checkout_attempts where order_id=o.id and released_at is null;
 if found then
  if p_address is not null then
   select details into address from public.delivery_addresses where id=p_address and user_id=p_buyer;
  end if;
  if (p_method is not null and p_method<>a.method)
    or (p_address is not null and (address is null or address is distinct from a.pending_address)) then
   raise exception 'An existing checkout uses different details. Refresh the order to resume it.';
  end if;
  return a;
 end if;
 if not exists(select 1 from public.seller_stripe_test_accounts where seller_id=o.seller_id and stripe_account=p_account) then
  raise exception 'Seller payment account unavailable';
 end if;
 if p_method is null or p_method not in ('delivery','collection') or mode not in (p_method,'both') then
  raise exception 'This fulfilment method is not offered';
 end if;
 if p_method='delivery' then
  select details into address from public.delivery_addresses where id=p_address and user_id=p_buyer;
  if not found then raise exception 'Choose your own saved address'; end if;
  postcode := regexp_replace(upper(address->>'postcode'),'[[:space:]]','','g');
  if lower(trim(address->>'country')) not in ('united kingdom','uk','gb','england','scotland','wales','northern ireland')
   or postcode !~ '^([A-Z]{1,2}[0-9][0-9A-Z]?|GIR)[0-9][A-Z]{2}$' or postcode ~ '^(GY|JE|IM)[0-9]'
   or (jsonb_array_length(o.terms_snapshot->'postcode_areas')>0 and not (o.terms_snapshot->'postcode_areas' ? substring(postcode from '^[A-Z]{1,2}')))
  then raise exception 'The seller does not deliver to this address'; end if;
  postage := (o.terms_snapshot->>'postage_minor')::integer;
 end if;
 if o.winning_minor+postage not between 30 and 99999999 then raise exception 'This total is outside the card payment range'; end if;
 insert into public.stripe_checkout_attempts(order_id,stripe_account,method,postage_minor,total_minor,pending_address)
 values(o.id,p_account,p_method,postage,o.winning_minor+postage,address) returning * into a;
 update public.fulfilment_orders set payment_state='PENDING',fulfilment_method=p_method,postage_minor=postage,version=version+1 where id=o.id;
 insert into public.fulfilment_events(order_id,actor_id,kind,version) values(o.id,p_buyer,'payment_pending',o.version+1);
 return a;
end;
$$;

create function public.bind_test_checkout(p_attempt uuid,p_session text)
returns boolean language sql security definer set search_path='' as $$
 with bound as (
  update public.stripe_checkout_attempts set session_id=p_session
  where id=p_attempt and released_at is null and (session_id is null or session_id=p_session)
  returning id
 ) select exists(select 1 from bound);
$$;

-- Only called by the signed webhook after validating Stripe account, test mode,
-- immutable amount/currency and provider IDs. Provider calls stay outside locks.
create function public.record_test_payment(
 p_event text,p_attempt uuid,p_account text,p_session text,p_intent text,p_total integer,
 p_kind text,p_refund_amount integer default null,p_adjustment text default null,p_adjustment_status text default null
) returns void language plpgsql security definer set search_path='' as $$
declare
 a public.stripe_checkout_attempts%rowtype;
 o public.fulfilment_orders%rowtype;
 next_state text;
 notice text;
 refunded integer;
 captured boolean;
 expired boolean;
 failed_refund boolean := false;
begin
 select * into o from public.fulfilment_orders
 where id=(select order_id from public.stripe_checkout_attempts where id=p_attempt) for update;
 select * into a from public.stripe_checkout_attempts where id=p_attempt for update;
 if not found or a.stripe_account is distinct from p_account or a.total_minor is distinct from p_total
   or p_session is null or (a.session_id is not null and a.session_id<>p_session)
   or (a.payment_intent_id is not null and a.payment_intent_id is distinct from p_intent) then
  raise exception 'Provider payment does not match the reserved order';
 end if;
 insert into public.stripe_payment_events(id,attempt_id,kind) values(p_event,a.id,p_kind) on conflict do nothing;
 if not found then return; end if;
 if a.released_at is not null then
  if p_kind in ('paid','refund','dispute') then raise exception 'Payment on a released session requires reconciliation'; end if;
  return;
 end if;
 captured := p_kind in ('paid','refund','dispute');
 expired := p_kind='expired';
 if not captured and o.payment_state in ('PAID','PARTIALLY_REFUNDED','REFUNDED','DISPUTED') then return; end if;
 if captured and p_intent is null then raise exception 'Missing payment intent'; end if;
 if p_kind not in ('paid','refund','dispute','expired','failed') then raise exception 'Unknown payment event'; end if;
 update public.stripe_checkout_attempts set session_id=p_session,
  payment_intent_id=case when captured then p_intent else payment_intent_id end,
  released_at=case when expired then clock_timestamp() end,
  pending_address=case when expired then null else pending_address end where id=a.id;
 refunded := o.refunded_minor;
 if p_kind='refund' then
  if p_refund_amount is null or p_refund_amount not between 1 and a.total_minor then
   raise exception 'Refund amount does not match the payment';
  end if;
  insert into public.stripe_payment_refunds(id,attempt_id,amount_minor,status)
  values(p_adjustment,a.id,p_refund_amount,p_adjustment_status)
  on conflict(id) do update set status=excluded.status
  where stripe_payment_refunds.attempt_id=a.id and stripe_payment_refunds.amount_minor=excluded.amount_minor
   and stripe_payment_refunds.status<>excluded.status and (stripe_payment_refunds.status='PENDING'
    or (stripe_payment_refunds.status='SUCCEEDED' and excluded.status='FAILED'));
  failed_refund := found and p_adjustment_status='FAILED';
  select coalesce(sum(amount_minor),0) into refunded from public.stripe_payment_refunds where attempt_id=a.id and status='SUCCEEDED';
  if refunded>a.total_minor then raise exception 'Refund total exceeds the payment'; end if;
 end if;
 if p_kind='dispute' then
  insert into public.stripe_payment_disputes(id,attempt_id,status) values(p_adjustment,a.id,p_adjustment_status)
  on conflict(id) do update set status=excluded.status
  where stripe_payment_disputes.attempt_id=a.id and (stripe_payment_disputes.status='OPEN'
   or (stripe_payment_disputes.status='LOST' and excluded.status='RESOLVED'));
 end if;
 next_state := case
  when not captured then 'FAILED'
  when exists(select 1 from public.stripe_payment_disputes where attempt_id=a.id and status in ('OPEN','LOST')) then 'DISPUTED'
  when refunded=a.total_minor then 'REFUNDED'
  when refunded>0 then 'PARTIALLY_REFUNDED'
  else 'PAID' end;
 if o.payment_state=next_state and o.refunded_minor=refunded and not expired and not failed_refund then return; end if;
 if next_state in ('PAID','PARTIALLY_REFUNDED') and a.pending_address is not null then
  update public.stripe_checkout_attempts set pending_address=null where id=a.id;
 end if;
 update public.fulfilment_orders set payment_state=next_state,refunded_minor=refunded,
  address_snapshot=case when next_state in ('PAID','PARTIALLY_REFUNDED') then coalesce(address_snapshot,a.pending_address) else address_snapshot end,
  fulfilment_method=case when expired then null else fulfilment_method end,
  postage_minor=case when expired then null else postage_minor end,
  shipping_state=case when next_state in ('PAID','PARTIALLY_REFUNDED') and shipping_state='AWAITING_PAYMENT'
    then case when a.method='delivery' then 'AWAITING_DISPATCH' else 'PREPARING_COLLECTION' end else shipping_state end,
  version=version+1 where id=o.id;
 insert into public.fulfilment_events(order_id,kind,version) values(o.id,
  case when expired then 'checkout_expired' when failed_refund then 'payment_refund_failed'
   when p_kind in ('refund','dispute') then 'payment_'||p_kind
   else 'payment_'||lower(next_state) end,o.version+1);
 notice := case
  when failed_refund then 'PAYMENT_REFUND_FAILED'
  when next_state='DISPUTED' and o.payment_state<>next_state then 'PAYMENT_DISPUTED'
  when p_kind='dispute' and o.payment_state='DISPUTED' and next_state<>'DISPUTED' then 'PAYMENT_DISPUTE_RESOLVED'
  when refunded>o.refunded_minor then 'PAYMENT_REFUNDED'
  when next_state='PAID' and o.payment_state<>next_state then 'PAYMENT_CONFIRMED'
  when next_state='FAILED' and o.payment_state<>next_state and not expired then 'PAYMENT_FAILED'
  end;
 if notice is not null then
  perform public.transaction_notification(o.buyer_id,o.lot_id,notice);
  if notice<>'PAYMENT_FAILED' then
   perform public.transaction_notification(o.seller_id,o.lot_id,case when notice='PAYMENT_CONFIRMED' then 'ORDER_PAID' else notice end);
  end if;
 end if;
end;
$$;

revoke all on function public.reserve_test_checkout(uuid,uuid,text,uuid,text),public.bind_test_checkout(uuid,text),
 public.record_test_payment(text,uuid,text,text,text,integer,text,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.reserve_test_checkout(uuid,uuid,text,uuid,text),public.bind_test_checkout(uuid,text),
 public.record_test_payment(text,uuid,text,text,text,integer,text,integer,text,text) to service_role;
commit;
