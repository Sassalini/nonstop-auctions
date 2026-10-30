-- Forward-only; apply manually after review. Never modifies auction results.
begin;
create table public.delivery_addresses (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id),
 details jsonb not null, is_default boolean not null default false, created_at timestamptz not null default now()
);
create unique index one_default_address on public.delivery_addresses(user_id) where is_default;
create function public.valid_delivery_address(d jsonb) returns boolean language sql immutable set search_path='' as $$
 select jsonb_typeof(d)='object' and octet_length(d::text)<=4000
 and coalesce(length(trim(d->>'recipient')) between 1 and 150,false)
 and coalesce(length(trim(d->>'line1')) between 1 and 200,false)
 and coalesce(length(trim(d->>'city')) between 1 and 100,false)
 and coalesce(length(trim(d->>'postcode')) between 1 and 30,false)
 and coalesce(length(trim(d->>'country')) between 1 and 100,false)
 and not exists(select 1 from jsonb_each(d) e where e.key not in ('recipient','line1','line2','city','region','postcode','country','instructions') or jsonb_typeof(e.value)<>'string' or length(e.value#>>'{}')>500);
$$;
alter table public.delivery_addresses add check(public.valid_delivery_address(details));
create table public.fulfilment_orders (
 id uuid primary key default gen_random_uuid(), lot_id uuid not null unique references public.lots(id),
 preview_started_at timestamptz not null, buyer_id uuid not null references public.profiles(id), seller_id uuid not null references public.profiles(id),
 foreign key(lot_id,preview_started_at) references public.auction_attempts(lot_id,preview_started_at),
 payment_state text not null default 'NOT_RECORDED' check(payment_state='NOT_RECORDED'),
 shipping_state text not null default 'AWAITING_ADDRESS' check(shipping_state in ('AWAITING_ADDRESS','AWAITING_DISPATCH','DISPATCHED','DELIVERED','COLLECTION_ARRANGED','EXCEPTION','CANCELLED')),
 address_snapshot jsonb, service text not null default '', tracking text not null default '', delivery_notes text not null default '',
 dispatched_at timestamptz, buyer_received_at timestamptz, seller_delivery_reported_at timestamptz, version integer not null default 0,
 created_at timestamptz not null default now(), check(buyer_id<>seller_id)
);
create table public.fulfilment_events (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.fulfilment_orders(id), actor_id uuid references public.profiles(id),
 kind text not null, version integer not null, created_at timestamptz not null default clock_timestamp(), unique(order_id,version)
);
create table public.conversations (
 id uuid primary key default gen_random_uuid(), lot_id uuid not null references public.lots(id), buyer_id uuid not null references public.profiles(id), seller_id uuid not null references public.profiles(id),
 buyer_read_at timestamptz not null default now(), seller_read_at timestamptz not null default now(), created_at timestamptz not null default now(), unique(lot_id,buyer_id,seller_id), check(buyer_id<>seller_id)
);
create table public.private_messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.conversations(id), sender_id uuid not null references public.profiles(id),
 body text not null check(length(trim(body)) between 1 and 2000), client_key uuid not null, created_at timestamptz not null default clock_timestamp(), deleted_at timestamptz, unique(sender_id,client_key)
);
create index messages_history on public.private_messages(conversation_id,created_at desc,id desc);
create index messages_rate on public.private_messages(sender_id,created_at desc);
create index conversations_buyer on public.conversations(buyer_id,created_at desc);
create index conversations_seller on public.conversations(seller_id,created_at desc);
create table public.contact_blocks (user_id uuid not null references public.profiles(id), blocked_id uuid not null references public.profiles(id), primary key(user_id,blocked_id), check(user_id<>blocked_id));
create table public.transaction_reports (
 id uuid primary key default gen_random_uuid(), reporter_id uuid not null references public.profiles(id), message_id uuid references public.private_messages(id), order_id uuid references public.fulfilment_orders(id),
 reason text not null check(length(trim(reason)) between 1 and 1000), created_at timestamptz not null default now(), check((message_id is null)<>(order_id is null))
);
create function public.is_conversation_member(cid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.conversations where id=cid and auth.uid() in (buyer_id,seller_id));
$$;
create function public.is_order_member(oid uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.fulfilment_orders where id=oid and auth.uid() in (buyer_id,seller_id));
$$;
alter table public.delivery_addresses enable row level security;
alter table public.fulfilment_orders enable row level security;
alter table public.fulfilment_events enable row level security;
alter table public.conversations enable row level security;
alter table public.private_messages enable row level security;
alter table public.contact_blocks enable row level security;
alter table public.transaction_reports enable row level security;
revoke all on public.delivery_addresses,public.fulfilment_orders,public.fulfilment_events,public.conversations,public.private_messages,public.contact_blocks,public.transaction_reports from public,anon,authenticated;
grant select on public.delivery_addresses,public.fulfilment_orders,public.fulfilment_events,public.conversations,public.private_messages,public.contact_blocks,public.transaction_reports to authenticated;
create policy address_owner on public.delivery_addresses for select to authenticated using(user_id=(select auth.uid()));
create policy order_participants on public.fulfilment_orders for select to authenticated using((select auth.uid()) in (buyer_id,seller_id));
create policy event_participants on public.fulfilment_events for select to authenticated using(public.is_order_member(order_id));
create policy conversation_participants on public.conversations for select to authenticated using((select auth.uid()) in (buyer_id,seller_id));
create policy message_participants on public.private_messages for select to authenticated using(public.is_conversation_member(conversation_id));
create policy block_owner on public.contact_blocks for select to authenticated using(user_id=(select auth.uid()));
create policy report_owner on public.transaction_reports for select to authenticated using(reporter_id=(select auth.uid()));

create function public.audit_order_creation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into public.fulfilment_events(order_id,kind,version) values(new.id,'order_created',0);
 return new;
end; $$;
revoke all on function public.audit_order_creation() from public,anon,authenticated;
create trigger audit_order_creation after insert on public.fulfilment_orders for each row execute function public.audit_order_creation();
create function public.create_sale_fulfilment() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.outcome='SOLD' then
 insert into public.fulfilment_orders(lot_id,preview_started_at,buyer_id,seller_id)
 select new.lot_id,new.preview_started_at,l.highest_bidder_id,l.seller_id from public.lots l where l.id=new.lot_id and l.status='SOLD' and l.highest_bidder_id is not null on conflict(lot_id) do nothing;
 end if; return new;
end; $$;
create trigger sale_fulfilment after insert on public.auction_attempts for each row execute function public.create_sale_fulfilment();
insert into public.fulfilment_orders(lot_id,preview_started_at,buyer_id,seller_id)
 select l.id,a.preview_started_at,l.highest_bidder_id,l.seller_id from public.lots l join public.auction_attempts a on a.lot_id=l.id and a.outcome='SOLD'
 where l.status='SOLD' and l.highest_bidder_id is not null and l.seller_id<>l.highest_bidder_id on conflict(lot_id) do nothing;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in ('WATCHED_LIVE','WATCHED_SOLD','WATCHED_UNSOLD','WON','SELLER_LIVE','SELLER_SOLD','SELLER_FIRST_BID','WATCHED_FIRST_BID','NEW_MESSAGE','ADDRESS_CONFIRMED','DISPATCHED','TRACKING_ADDED','RECEIPT_CONFIRMED','DELIVERY_ISSUE'));
create function public.transaction_notification(uid uuid,lid uuid,k text) returns void language sql security definer set search_path='' as $$
 insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run) select uid,lid,k,title,clock_timestamp() from public.lots where id=lid on conflict do nothing;
$$;
-- One RPC boundary for validated, ownership-checked mutations. No direct client writes.
create function public.transaction_action(action text, payload jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid(); aid uuid; cid uuid; mid uuid; o public.fulfilment_orders%rowtype; c public.conversations%rowtype; l public.lots%rowtype; d jsonb; next_state text; recipient uuid;
begin
 if uid is null then raise exception 'Sign in required'; end if;
 -- Serialize account mutations, including spam checks and default-address changes.
 perform pg_advisory_xact_lock(hashtextextended(uid::text,15));
 if octet_length(payload::text)>12000 then raise exception 'Request too large'; end if;
 if action in ('report_order','report_message') and (select count(*) from public.transaction_reports where reporter_id=uid and created_at>clock_timestamp()-interval '1 day')>=20 then raise exception 'Report limit reached'; end if;
 if action='save_address' then
  d:=payload->'details'; if not coalesce(public.valid_delivery_address(d),false) then raise exception 'Complete the required address fields'; end if;
  aid:=coalesce(nullif(payload->>'id','')::uuid,gen_random_uuid());
  if exists(select 1 from public.delivery_addresses where id=aid and user_id<>uid) then raise exception 'Address unavailable'; end if;
  if (select count(*) from public.delivery_addresses where user_id=uid)>=20 and not exists(select 1 from public.delivery_addresses where id=aid and user_id=uid) then raise exception 'Address book limit reached'; end if;
  if coalesce((payload->>'default')::boolean,false) then update public.delivery_addresses set is_default=false where user_id=uid; end if;
  insert into public.delivery_addresses(id,user_id,details,is_default) values(aid,uid,d,coalesce((payload->>'default')::boolean,false)) on conflict(id) do update set details=excluded.details,is_default=excluded.is_default where delivery_addresses.user_id=uid;
  return to_jsonb(aid);
 elsif action='delete_address' then
  delete from public.delivery_addresses where id=(payload->>'id')::uuid and user_id=uid;
 elsif action='conversation' then
  select * into l from public.lots where id=(payload->>'lot')::uuid;
  if not found or l.status in ('DRAFT','REMOVED') then raise exception 'Listing unavailable'; end if;
  if uid=l.seller_id then
   select * into o from public.fulfilment_orders where lot_id=l.id and seller_id=uid;
   if not found then raise exception 'A seller can contact the winning buyer through an order'; end if;
   recipient:=o.buyer_id;
  else recipient:=uid; end if;
  if recipient=l.seller_id then raise exception 'Cannot message yourself'; end if;
  if (select count(*) from public.conversations where buyer_id=uid and created_at>clock_timestamp()-interval '1 hour')>=20 and not exists(select 1 from public.conversations where lot_id=l.id and buyer_id=recipient and seller_id=l.seller_id) then raise exception 'Conversation limit reached'; end if;
  insert into public.conversations(lot_id,buyer_id,seller_id) values(l.id,recipient,l.seller_id) on conflict(lot_id,buyer_id,seller_id) do update set lot_id=excluded.lot_id returning id into cid;
  return to_jsonb(cid);
 elsif action in ('send','read','block','unblock','delete_message','report_message') then
  select * into c from public.conversations where id=(payload->>'conversation')::uuid for update;
  if not found or uid not in (c.buyer_id,c.seller_id) then raise exception 'Conversation unavailable'; end if;
  recipient:=case when uid=c.buyer_id then c.seller_id else c.buyer_id end;
  if action='send' then
   if length(trim(payload->>'body')) not between 1 and 2000 or payload->>'body' is null then raise exception 'Messages must contain 1–2000 characters'; end if;
   select id into mid from public.private_messages where sender_id=uid and client_key=(payload->>'key')::uuid;
   if found then return to_jsonb(mid); end if;
   if exists(select 1 from public.contact_blocks where (user_id=uid and blocked_id=recipient) or (user_id=recipient and blocked_id=uid)) and not exists(select 1 from public.fulfilment_orders where lot_id=c.lot_id and buyer_id=c.buyer_id and seller_id=c.seller_id and shipping_state not in ('DELIVERED','CANCELLED')) then raise exception 'Contact blocked'; end if;
   if (select count(*) from public.private_messages where sender_id=uid and created_at>clock_timestamp()-interval '1 minute')>=10 or (select count(*) from public.private_messages where sender_id=uid and created_at>clock_timestamp()-interval '1 day')>=200 then raise exception 'Message limit reached. Try later'; end if;
   insert into public.private_messages(conversation_id,sender_id,body,client_key) values(c.id,uid,trim(payload->>'body'),(payload->>'key')::uuid) returning id into mid;
   perform public.transaction_notification(recipient,c.lot_id,'NEW_MESSAGE'); return to_jsonb(mid);
  elsif action='read' then
   update public.conversations set buyer_read_at=case when uid=buyer_id then clock_timestamp() else buyer_read_at end,seller_read_at=case when uid=seller_id then clock_timestamp() else seller_read_at end where id=c.id;
  elsif action='block' then insert into public.contact_blocks values(uid,recipient) on conflict do nothing;
  elsif action='unblock' then delete from public.contact_blocks where user_id=uid and blocked_id=recipient;
  else
   select id into mid from public.private_messages where id=(payload->>'message')::uuid and conversation_id=c.id;
   if not found then raise exception 'Message unavailable'; end if;
   if action='delete_message' then
    if exists(select 1 from public.fulfilment_orders where lot_id=c.lot_id) or exists(select 1 from public.transaction_reports where message_id=mid) then raise exception 'Transaction or reported messages must be retained'; end if;
    update public.private_messages set body='[Message deleted]',deleted_at=clock_timestamp() where id=mid and sender_id=uid;
   else
    if not exists(select 1 from public.transaction_reports where message_id=mid and reporter_id=uid) then insert into public.transaction_reports(reporter_id,message_id,reason) values(uid,mid,payload->>'reason'); end if;
   end if;
  end if;
 else
  select * into o from public.fulfilment_orders where id=(payload->>'order')::uuid for update;
  if not found or uid not in (o.buyer_id,o.seller_id) then raise exception 'Order unavailable'; end if;
  if action='report_order' then
   if not exists(select 1 from public.transaction_reports where order_id=o.id and reporter_id=uid) then
    insert into public.transaction_reports(reporter_id,order_id,reason) values(uid,o.id,payload->>'reason');
    perform public.transaction_notification(case when uid=o.buyer_id then o.seller_id else o.buyer_id end,o.lot_id,'DELIVERY_ISSUE');
   end if;
   return 'true';
  end if;
  if o.version<>(payload->>'version')::integer or payload->>'version' is null then raise exception 'Order changed. Reload before trying again'; end if;
  if action='select_address' then
   if uid<>o.buyer_id or o.shipping_state not in ('AWAITING_ADDRESS','AWAITING_DISPATCH') or o.dispatched_at is not null then raise exception 'Address cannot be changed at this stage'; end if;
   select details into d from public.delivery_addresses where id=(payload->>'address')::uuid and user_id=uid;
   if not found then raise exception 'Address unavailable'; end if;
   if o.address_snapshot=d and o.shipping_state='AWAITING_DISPATCH' then return 'true'; end if;
   update public.fulfilment_orders set address_snapshot=d,shipping_state='AWAITING_DISPATCH',version=version+1 where id=o.id;
   perform public.transaction_notification(o.seller_id,o.lot_id,'ADDRESS_CONFIRMED');
  elsif action='shipping' then
   if uid<>o.seller_id or o.shipping_state in ('DELIVERED','CANCELLED') then raise exception 'Shipping update not allowed'; end if;
   next_state:=payload->>'state';
   if next_state not in ('AWAITING_DISPATCH','DISPATCHED','COLLECTION_ARRANGED','EXCEPTION') or next_state is null then raise exception 'Invalid shipping state'; end if;
   if o.dispatched_at is not null and next_state not in ('DISPATCHED','EXCEPTION') then raise exception 'Dispatch cannot be reversed'; end if;
   if next_state='DISPATCHED' and o.address_snapshot is null then raise exception 'Buyer must confirm an address before dispatch'; end if;
   if next_state='AWAITING_DISPATCH' and o.address_snapshot is null then raise exception 'Address required'; end if;
   if length(coalesce(payload->>'service',''))>100 or length(coalesce(payload->>'tracking',''))>100 or length(coalesce(payload->>'notes',''))>1000 then raise exception 'Shipping details too long'; end if;
   if next_state=o.shipping_state and coalesce(payload->>'service','')=o.service and coalesce(payload->>'tracking','')=o.tracking and coalesce(payload->>'notes','')=o.delivery_notes then return 'true'; end if;
   update public.fulfilment_orders set shipping_state=next_state,service=coalesce(payload->>'service',''),tracking=coalesce(payload->>'tracking',''),delivery_notes=coalesce(payload->>'notes',''),dispatched_at=case when next_state='DISPATCHED' then coalesce(dispatched_at,clock_timestamp()) else dispatched_at end,version=version+1 where id=o.id;
   if next_state='DISPATCHED' and o.dispatched_at is null then perform public.transaction_notification(o.buyer_id,o.lot_id,'DISPATCHED');
   elsif coalesce(payload->>'tracking','')<>o.tracking then perform public.transaction_notification(o.buyer_id,o.lot_id,'TRACKING_ADDED'); end if;
  elsif action='receipt' then
   if uid<>o.buyer_id or (o.shipping_state not in ('DISPATCHED','COLLECTION_ARRANGED') and not (o.shipping_state='EXCEPTION' and o.dispatched_at is not null)) then raise exception 'Receipt cannot be confirmed yet'; end if;
   update public.fulfilment_orders set shipping_state='DELIVERED',buyer_received_at=clock_timestamp(),version=version+1 where id=o.id;
   perform public.transaction_notification(o.seller_id,o.lot_id,'RECEIPT_CONFIRMED');
  elsif action='seller_delivery_report' then
   if uid<>o.seller_id or o.dispatched_at is null or o.seller_delivery_reported_at is not null then raise exception 'Delivery report not allowed'; end if;
   update public.fulfilment_orders set seller_delivery_reported_at=clock_timestamp(),version=version+1 where id=o.id;
  else raise exception 'Unknown action'; end if;
  insert into public.fulfilment_events(order_id,actor_id,kind,version) values(o.id,uid,action,o.version+1);
 end if;
 return 'true';
end; $$;
-- Realtime sends only participant-authorised message rows. Addresses/orders are
-- deliberately excluded from the publication; no address or message bodies in notifications.
do $$ begin
 if exists(select 1 from pg_publication where pubname='supabase_realtime') then
  alter publication supabase_realtime add table public.private_messages;
 end if;
end $$;
revoke all on function public.transaction_action(text,jsonb),public.is_conversation_member(uuid),public.is_order_member(uuid),public.valid_delivery_address(jsonb),public.create_sale_fulfilment(),public.transaction_notification(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.transaction_action(text,jsonb),public.is_conversation_member(uuid),public.is_order_member(uuid),public.valid_delivery_address(jsonb) to authenticated;
create function public.unread_message_count() returns bigint language sql stable security definer set search_path='' as $$
 select count(*) from public.private_messages m join public.conversations c on c.id=m.conversation_id
 where auth.uid() in (c.buyer_id,c.seller_id) and m.sender_id<>auth.uid() and m.created_at>case when auth.uid()=c.buyer_id then c.buyer_read_at else c.seller_read_at end;
$$;
revoke all on function public.unread_message_count() from public,anon;
grant execute on function public.unread_message_count() to authenticated;
-- Explicit operator retention tool: no schedule or production execution is added.
-- Never purges transaction conversations or messages retained as report evidence.
create function public.purge_nontransaction_messages(p_before timestamptz) returns bigint language plpgsql security definer set search_path='' as $$
declare affected bigint;
begin
 if p_before is null or p_before>now()-interval '30 days' then raise exception 'An approved cutoff at least 30 days old is required'; end if;
 delete from public.private_messages m where m.created_at<p_before
 and not exists(select 1 from public.transaction_reports r where r.message_id=m.id)
 and not exists(select 1 from public.conversations c join public.fulfilment_orders o on o.lot_id=c.lot_id where c.id=m.conversation_id);
 get diagnostics affected=row_count;return affected;
end; $$;
revoke all on function public.purge_nontransaction_messages(timestamptz) from public,anon,authenticated;
grant execute on function public.purge_nontransaction_messages(timestamptz) to service_role;
commit;





