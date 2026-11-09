begin;

-- Keep structured terms out of lots and its live auction event payloads.
create table public.listing_fulfilment_terms (
 lot_id uuid primary key references public.lots(id) on delete cascade,
 details jsonb not null,
 summary text not null
);
alter table public.listing_fulfilment_terms enable row level security;
revoke all on public.listing_fulfilment_terms from public,anon,authenticated;
grant select(lot_id,details) on public.listing_fulfilment_terms to authenticated;
create policy seller_reads_listing_terms on public.listing_fulfilment_terms for select to authenticated
 using (exists(select 1 from public.lots l where l.id=lot_id and l.seller_id=(select auth.uid())));

-- The public catalogue already carries shipping_info. Keep the same read payload.
create function public.set_listing_fulfilment(p_lot uuid, p_terms jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare
 mode text := p_terms->>'mode';
 cost numeric;
 areas jsonb := p_terms->'postcode_areas';
 service text := trim(p_terms->>'service');
 handling text := p_terms->>'handling_days';
 restrictions text := trim(coalesce(p_terms->>'restrictions',''));
 town text := trim(p_terms->>'collection_area');
 terms jsonb;
 summary text;
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if mode is null or mode not in ('delivery','collection','both') or octet_length(p_terms::text)>4000 then
  raise exception 'Choose delivery, collection or both';
 end if;
 terms := jsonb_build_object('mode',mode);
 if mode in ('delivery','both') then
  if coalesce(p_terms->>'postage_minor','') !~ '^[0-9]{1,8}$'
    or coalesce(handling,'') !~ '^[1-9][0-9]?$'
    or not coalesce(length(service) between 1 and 100,false) or length(restrictions)>500
    or jsonb_typeof(areas) is distinct from 'array' then raise exception 'Enter valid delivery terms'; end if;
  if jsonb_array_length(areas)>120 or exists(select 1 from jsonb_array_elements_text(areas) a where a is null or a !~ '^[A-Z]{1,2}$') then
   raise exception 'Enter UK postcode areas such as SW, EH or BT';
  end if;
  cost := (p_terms->>'postage_minor')::numeric;
  terms := terms || jsonb_build_object('postage_minor',cost,'country','GB','postcode_areas',areas,
    'service',service,'handling_days',handling::integer,'restrictions',restrictions);
  summary := (case when cost=0 then 'Free delivery' else 'Delivery: £'||(cost/100)::numeric(12,2) end)
   || ' · ' || (case when jsonb_array_length(areas)=0 then 'United Kingdom'
       else 'UK postcode areas ' || (select string_agg(a,', ') from jsonb_array_elements_text(areas) a) end)
   || ' · ' || service || ' · Dispatch within ' || handling || ' working day(s).';
  if restrictions<>'' then summary := summary || ' ' || restrictions; end if;
 end if;
 if mode in ('collection','both') then
  if not coalesce(length(town) between 2 and 80 and town ~ '^[[:alpha:] .’''-]+$',false) then
   raise exception 'Enter the collection town or general area only';
  end if;
  terms := terms || jsonb_build_object('collection_area',town);
  summary := concat_ws(' ',summary,'Free collection in '||town||'. Arrange the handover privately after payment.');
 end if;
 perform 1 from public.lots where id=p_lot and seller_id=auth.uid() and submission_key is not null and status='DRAFT' for update;
 if not found then raise exception 'Fulfilment terms can only be set on your own draft'; end if;
 insert into public.listing_fulfilment_terms(lot_id,details,summary) values(p_lot,terms,summary)
 on conflict(lot_id) do update set details=excluded.details,summary=excluded.summary;
 update public.lots set shipping_info=summary where id=p_lot and shipping_info is distinct from summary;
end;
$$;

create function public.guard_listing_fulfilment()
returns trigger language plpgsql security definer set search_path='' as $$
declare expected text;
begin
 select summary into expected from public.listing_fulfilment_terms where lot_id=new.id;
 if not found then
  if old.status='DRAFT' and new.status<>'DRAFT' and new.submission_key is not null then
   raise exception 'Set delivery or collection terms before submitting';
  end if;
 elsif new.shipping_info is distinct from expected then
  if old.status<>'DRAFT' then raise exception 'Published fulfilment terms are fixed'; end if;
  raise exception 'Update the structured fulfilment terms to change the listing summary';
 end if;
 return new;
end;
$$;
create trigger zz_guard_listing_fulfilment before update of status,shipping_info on public.lots
for each row when ((old.status='DRAFT' and new.status<>'DRAFT') or old.shipping_info is distinct from new.shipping_info)
execute function public.guard_listing_fulfilment();
revoke all on function public.set_listing_fulfilment(uuid,jsonb),public.guard_listing_fulfilment() from public,anon,authenticated;
grant execute on function public.set_listing_fulfilment(uuid,jsonb) to authenticated;

alter table public.fulfilment_orders
 add column terms_snapshot jsonb,
 add column winning_minor bigint,
 add column fulfilment_method text check(fulfilment_method in ('delivery','collection')),
 add column postage_minor integer check(postage_minor>=0),
 add column refunded_minor integer not null default 0 check(refunded_minor>=0),
 add column seller_handover_at timestamptz,
 drop constraint fulfilment_orders_payment_state_check,
 drop constraint fulfilment_orders_shipping_state_check,
 add check(payment_state in ('NOT_RECORDED','UNPAID','PENDING','PAID','FAILED','PARTIALLY_REFUNDED','REFUNDED','DISPUTED')),
 add check(shipping_state in ('AWAITING_ADDRESS','AWAITING_PAYMENT','AWAITING_DISPATCH','DISPATCHED','DELIVERED',
  'PREPARING_COLLECTION','READY_FOR_COLLECTION','COLLECTION_ARRANGED','EXCEPTION','CANCELLED'));

create index fulfilment_orders_buyer_idx on public.fulfilment_orders(buyer_id);
create index fulfilment_orders_seller_idx on public.fulfilment_orders(seller_id);

update public.fulfilment_orders o set winning_minor=(a.final_price*100)::bigint
from public.auction_attempts a where a.lot_id=o.lot_id and a.preview_started_at=o.preview_started_at
and a.final_price between 0.01 and 999999999999.99 and a.final_price=round(a.final_price,2);

create or replace function public.create_sale_fulfilment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.outcome='SOLD' then
  insert into public.fulfilment_orders(lot_id,preview_started_at,buyer_id,seller_id,terms_snapshot,winning_minor,payment_state,shipping_state)
  select new.lot_id,new.preview_started_at,l.highest_bidder_id,l.seller_id,t.details,
   case when new.final_price between 0.01 and 999999999999.99 and new.final_price=round(new.final_price,2)
      then (new.final_price*100)::bigint end,
   case when t.details is null then 'NOT_RECORDED' else 'UNPAID' end,
   case when t.details is null then 'AWAITING_ADDRESS' else 'AWAITING_PAYMENT' end
  from public.lots l left join public.listing_fulfilment_terms t on t.lot_id=l.id
  where l.id=new.lot_id and l.status='SOLD' and l.highest_bidder_id is not null
   and l.seller_id<>l.highest_bidder_id on conflict(lot_id) do nothing;
 end if;
 return new;
end;
$$;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'WATCHED_LIVE','WATCHED_SOLD','WATCHED_UNSOLD','WON','WON_PAYMENT_REQUIRED','SELLER_LIVE','SELLER_SOLD','SELLER_FIRST_BID','WATCHED_FIRST_BID',
 'NEW_MESSAGE','ADDRESS_CONFIRMED','DISPATCHED','TRACKING_ADDED','RECEIPT_CONFIRMED','DELIVERY_ISSUE',
 'PAYMENT_CONFIRMED','ORDER_PAID','PAYMENT_FAILED','PAYMENT_REFUNDED','PAYMENT_REFUND_FAILED','PAYMENT_DISPUTED','PAYMENT_DISPUTE_RESOLVED',
 'COLLECTION_READY','COLLECTION_UPDATED','COLLECTION_HANDOVER','COLLECTION_CONFIRMED'));

-- Enrich the existing win notification without emitting a second message or
-- changing the lifecycle's listing_notification_events deduplication.
create function public.label_payment_required()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if exists(select 1 from public.listing_fulfilment_terms where lot_id=new.lot_id) then
  new.kind := 'WON_PAYMENT_REQUIRED';
 end if;
 return new;
end;
$$;
create trigger label_payment_required before insert on public.notifications
for each row when (new.kind='WON') execute function public.label_payment_required();
revoke all on function public.label_payment_required() from public,anon,authenticated;

-- Keep the existing address book, messaging, legacy order and report implementation.
alter function public.transaction_action(text,jsonb) rename to legacy_transaction_action;
revoke all on function public.legacy_transaction_action(text,jsonb) from public,anon,authenticated;

create function public.transaction_action(action text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 uid uuid := auth.uid();
 o public.fulfilment_orders%rowtype;
 next_state text := payload->>'state';
 notes text := trim(coalesce(payload->>'notes',''));
 event_kind text;
 notice text;
 recipient uuid;
 result jsonb;
begin
 if uid is null then raise exception 'Sign in required'; end if;
 if octet_length(payload::text)>12000 then raise exception 'Request too large'; end if;
 if action not in ('select_address','shipping','receipt','seller_delivery_report','collection','collection_confirm') then
  return public.legacy_transaction_action(action,payload);
 end if;
 -- Match the lock order in the underlying transaction RPC.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,15));
 select * into o from public.fulfilment_orders where id=(payload->>'order')::uuid for update;
 if not found or uid not in (o.buyer_id,o.seller_id) then raise exception 'Order unavailable'; end if;
 if o.terms_snapshot is null then return public.legacy_transaction_action(action,payload); end if;
 if o.version is distinct from (payload->>'version')::integer then raise exception 'Order changed. Reload before trying again'; end if;
 if action='select_address' then raise exception 'Choose an address during checkout'; end if;
 if o.payment_state not in ('PAID','PARTIALLY_REFUNDED') or o.shipping_state='CANCELLED' then
  raise exception 'Fulfilment requires confirmed payment';
 end if;
 if o.fulfilment_method='delivery' then
  if action='shipping' and (next_state is null or next_state not in ('AWAITING_DISPATCH','DISPATCHED','EXCEPTION')) then
   raise exception 'Invalid delivery state';
  end if;
  if action in ('shipping','receipt','seller_delivery_report') then
   result := public.legacy_transaction_action(action,payload);
   if action='shipping' then
    update public.fulfilment_events set kind=case when o.shipping_state<>next_state then lower(next_state)
      when coalesce(payload->>'tracking','')<>o.tracking then 'tracking_updated' else 'shipping_details_updated' end
    where order_id=o.id and version=o.version+1;
    if next_state='EXCEPTION' and o.shipping_state<>next_state then
     perform public.transaction_notification(o.buyer_id,o.lot_id,'DELIVERY_ISSUE');
    end if;
   end if;
   return result;
  end if;
  raise exception 'This order uses delivery';
 end if;
 if o.fulfilment_method is distinct from 'collection' or o.shipping_state='DELIVERED' then raise exception 'Collection update unavailable'; end if;
 if action='collection' and uid=o.seller_id then
  if length(notes)>1000 then raise exception 'Collection notes too long'; end if;
  if next_state is null or next_state not in ('READY_FOR_COLLECTION','COLLECTION_ARRANGED','EXCEPTION') then raise exception 'Invalid collection state'; end if;
  if o.seller_handover_at is not null and next_state<>'EXCEPTION' then raise exception 'Handover already recorded'; end if;
  if next_state='COLLECTION_ARRANGED' and o.shipping_state not in ('READY_FOR_COLLECTION','COLLECTION_ARRANGED','EXCEPTION') then
   raise exception 'Mark the item ready first';
  end if;
  if o.shipping_state=next_state and o.delivery_notes=notes then return 'true'; end if;
  update public.fulfilment_orders set shipping_state=next_state,delivery_notes=notes,version=version+1 where id=o.id;
  notice := case next_state when 'READY_FOR_COLLECTION' then 'COLLECTION_READY' when 'EXCEPTION' then 'DELIVERY_ISSUE' else 'COLLECTION_UPDATED' end;
  event_kind := lower(next_state);
  recipient := o.buyer_id;
 elsif action='collection_confirm' then
  if uid=o.seller_id and o.shipping_state='COLLECTION_ARRANGED' and o.seller_handover_at is null then
   update public.fulfilment_orders set seller_handover_at=clock_timestamp(),version=version+1 where id=o.id;
   event_kind := 'seller_handover'; notice := 'COLLECTION_HANDOVER'; recipient := o.buyer_id;
  elsif uid=o.buyer_id and o.shipping_state in ('COLLECTION_ARRANGED','EXCEPTION') and o.seller_handover_at is not null then
   update public.fulfilment_orders set shipping_state='DELIVERED',buyer_received_at=clock_timestamp(),version=version+1 where id=o.id;
   event_kind := 'collection_confirmed'; notice := 'COLLECTION_CONFIRMED'; recipient := o.seller_id;
  else raise exception 'Collection cannot be confirmed at this stage'; end if;
 else raise exception 'Collection update not allowed'; end if;
 insert into public.fulfilment_events(order_id,actor_id,kind,version) values(o.id,uid,event_kind,o.version+1);
 perform public.transaction_notification(recipient,o.lot_id,notice);
 return 'true';
end;
$$;
revoke all on function public.transaction_action(text,jsonb) from public,anon,authenticated;
grant execute on function public.transaction_action(text,jsonb) to authenticated;
commit;
