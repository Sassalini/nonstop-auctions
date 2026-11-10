begin;

-- Guard the PostgREST entry point too. The original ownership and order-state
-- checks still run before any address can be attached to an order.
alter function public.transaction_action(text,jsonb) rename to transaction_action_with_fulfilment;
revoke all on function public.transaction_action_with_fulfilment(text,jsonb) from public,anon,authenticated,service_role;

create function public.transaction_action(action text, payload jsonb default '{}')
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if action='select_address' and coalesce(payload->>'address','') !~* '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' then
  raise exception 'Please select a delivery address';
 end if;
 return public.transaction_action_with_fulfilment(action,payload);
end;
$$;
revoke all on function public.transaction_action(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.transaction_action(text,jsonb) to authenticated;

-- Staging operator only. Call after independently confirming that the buyer
-- still owes the full amount. NOT_RECORDED alone is not evidence of nonpayment.
create function public.enable_reviewed_legacy_test_checkout(p_order uuid,p_buyer uuid,p_winning_minor bigint)
returns void language plpgsql set search_path='' as $$
declare
 o public.fulfilment_orders%rowtype;
 terms jsonb;
begin
 select * into o from public.fulfilment_orders where id=p_order for update;
 if not found or o.buyer_id is distinct from p_buyer then raise exception 'Reviewed buyer does not match the order'; end if;
 if o.payment_state<>'NOT_RECORDED' or o.terms_snapshot is not null or o.shipping_state<>'AWAITING_ADDRESS'
  or o.version<>0 or o.address_snapshot is not null or o.fulfilment_method is not null or o.postage_minor is not null
  or o.refunded_minor<>0 or exists(select 1 from public.stripe_checkout_attempts where order_id=o.id) then
  raise exception 'Order has existing payment or fulfilment activity';
 end if;
 if not coalesce(p_winning_minor between 1 and 99999999,false)
  or (o.winning_minor is not null and o.winning_minor<>p_winning_minor)
  or not exists(select 1 from public.lots l join public.auction_attempts a on a.lot_id=l.id
   where l.id=o.lot_id and l.status='SOLD' and l.highest_bidder_id=o.buyer_id and l.seller_id=o.seller_id
    and a.preview_started_at=o.preview_started_at and a.completed_at=l.sold_at and a.outcome='SOLD'
    and a.final_price=l.winning_bid and a.final_price*100=p_winning_minor) then
  raise exception 'Reviewed amount or participants do not match the sold result';
 end if;
 select t.details into terms from public.listing_fulfilment_terms t join public.lots l on l.id=t.lot_id
 where t.lot_id=o.lot_id and t.summary=l.shipping_info;
 if not found then raise exception 'Original structured delivery or collection terms are missing'; end if;
 if not coalesce(
  (terms->>'mode' in ('delivery','both') and p_winning_minor+(terms->>'postage_minor')::integer between 30 and 99999999)
  or (terms->>'mode' in ('collection','both') and p_winning_minor>=30),false) then
  raise exception 'This total is outside the card payment range';
 end if;
 update public.fulfilment_orders set terms_snapshot=terms,winning_minor=p_winning_minor,
  payment_state='UNPAID',shipping_state='AWAITING_PAYMENT',version=version+1 where id=o.id;
 insert into public.fulfilment_events(order_id,kind,version) values(o.id,'legacy_checkout_enabled',o.version+1);
end;
$$;
revoke all on function public.enable_reviewed_legacy_test_checkout(uuid,uuid,bigint) from public,anon,authenticated,service_role;

commit;
