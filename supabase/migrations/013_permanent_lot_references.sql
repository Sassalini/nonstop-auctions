-- Permanent listing references. Apply manually after 012; never derive references
-- from mutable queue_position. Existing UUID identities and auction state stay intact.
begin;
create sequence public.lot_reference_seq as bigint minvalue 1 maxvalue 9007199254740991 no cycle;
do $$
declare old_sequence text; old_high_water bigint:=0;
begin
 if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='lots' and column_name='lot_reference') then
  -- A volatile column default backfills existing rows without firing row UPDATE
  -- triggers: historical sold_at/updated_at, bids and results remain unchanged.
  alter table public.lots add column lot_reference bigint not null default nextval('public.lot_reference_seq');
 else
  old_sequence:=pg_get_serial_sequence('public.lots','lot_reference');
  if old_sequence is not null then execute format('select last_value from %s',old_sequence) into old_high_water; end if;
  -- Preserve legitimate pre-existing references. Refuse ambiguous/partial data
  -- rather than silently overwriting a reference someone may already use.
  if exists(select 1 from public.lots where lot_reference is null or lot_reference<1 or lot_reference>9007199254740991)
   or exists(select 1 from public.lots group by lot_reference having count(*)>1) then
   raise exception 'Existing lot references require manual review: missing, duplicate or invalid values.';
  end if;
  alter table public.lots alter column lot_reference set not null;
  alter table public.lots alter column lot_reference set default nextval('public.lot_reference_seq');
 end if;
 if exists(select 1 from public.lots) or old_high_water>0 then
  perform setval('public.lot_reference_seq',greatest(coalesce((select max(lot_reference) from public.lots),0),(select last_value from public.lot_reference_seq),old_high_water),true);
 end if;
end; $$;
alter table public.lots add constraint lots_reference_range check(lot_reference between 1 and 9007199254740991);
create unique index lots_reference_idx on public.lots(lot_reference);
-- Permanent allocation ledger has no cascading FK: discarding even an unfinished
-- listing cannot free its reference. Sequence gaps (including rollbacks) are normal.
create table public.lot_reference_allocations(reference bigint primary key,lot_id uuid not null unique);
alter table public.lot_reference_allocations enable row level security;
revoke all on public.lot_reference_allocations from public,anon,authenticated;
insert into public.lot_reference_allocations select lot_reference,id from public.lots;
revoke all on sequence public.lot_reference_seq from public,anon,authenticated;
grant select(lot_reference) on public.lots to anon,authenticated;
create function public.guard_lot_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' then
  if new.lot_reference is distinct from old.lot_reference then raise exception 'Lot references are permanent.'; end if;
 else
  insert into public.lot_reference_allocations(reference,lot_id) values(new.lot_reference,new.id);
 end if;
 return new;
end; $$;
revoke all on function public.guard_lot_reference() from public,anon,authenticated;
create trigger guard_lot_reference before insert or update of lot_reference on public.lots for each row execute function public.guard_lot_reference();

alter table public.notifications add column lot_reference bigint;
update public.notifications n set lot_reference=l.lot_reference from public.lots l where l.id=n.lot_id;
alter table public.notifications alter column lot_reference set not null;
create function public.set_notification_lot_reference() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select lot_reference into new.lot_reference from public.lots where id=new.lot_id;
 return new;
end; $$;
revoke all on function public.set_notification_lot_reference() from public,anon,authenticated;
create trigger set_notification_lot_reference before insert on public.notifications for each row execute function public.set_notification_lot_reference();

-- Preserve the prior bounded RPC for existing clients and its participant checks.
create function public.completed_auctions_page_with_reference(p_mode text,p_limit integer default 51,p_offset integer default 0,p_lot_id uuid default null)
returns table(lot_id uuid,title text,sale_price numeric,completed_at timestamptz,seller_name text,buyer_name text,is_buyer boolean,image_url text,storage_path text,lot_reference bigint)
language sql stable security definer set search_path='' as $$
 -- Scalar primary-key lookup keeps this bounded even when the planner's
 -- estimate for the legacy set-returning function exceeds the actual page size.
 select p.*,(select l.lot_reference from public.lots l where l.id=p.lot_id)
 from public.completed_auctions_page(p_mode,p_limit,p_offset,p_lot_id) p
 order by p.completed_at desc,p.lot_id desc;
$$;
revoke all on function public.completed_auctions_page_with_reference(text,integer,integer,uuid) from public,anon;
grant execute on function public.completed_auctions_page_with_reference(text,integer,integer,uuid) to authenticated;
commit;
