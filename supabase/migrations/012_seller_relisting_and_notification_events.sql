-- Apply manually after 011. Keep auction traffic paused during this migration.
-- Published legacy lots retain unlimited cycling; new submissions default to five retries.
begin;
alter table public.lots
 add column relist_unlimited boolean not null default false,
 add column max_auto_relistings integer not null default 5 check (max_auto_relistings between 0 and 100),
 add column auto_relistings_used integer not null default 0 check (auto_relistings_used >= 0),
 add column completed_attempts integer not null default 0 check (completed_attempts >= 0),
 add column final_unsold_at timestamptz,
 add column removal_requested_at timestamptz,
 add column removed_at timestamptz,
 add column pending_relist_unlimited boolean,
 add column pending_max_auto_relistings integer check (pending_max_auto_relistings between 0 and 100);
alter table public.lots drop constraint lots_status_check;
alter table public.lots add constraint lots_status_check check(status in (
 'DRAFT','WAITING','PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING','SOLD','UNSOLD','EXPIRED','CANCELLED'));
alter table public.lots add constraint lots_pending_relisting_pair check (
 (pending_relist_unlimited is null) = (pending_max_auto_relistings is null));
-- One-time backfill from known attempts, never a per-tick history scan. Older lost
-- attempts cannot be reconstructed. Historical SOLD/CANCELLED rows are not updated.
select set_config('app.auction_lifecycle','true',true);
with counts as (select lot_id,count(*)::integer as attempts from public.auction_attempts group by lot_id)
update public.lots l set relist_unlimited=true,
 completed_attempts=coalesce(c.attempts,0),
 auto_relistings_used=coalesce(c.attempts,0)
from (select q.id,counts.attempts from public.lots q left join counts on counts.lot_id=q.id) c
where l.id=c.id and l.status in ('WAITING','PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING','UNSOLD');
select set_config('app.auction_lifecycle','false',true);
grant select (relist_unlimited,max_auto_relistings,auto_relistings_used,completed_attempts,final_unsold_at,removal_requested_at,removed_at,pending_relist_unlimited,pending_max_auto_relistings) on public.lots to authenticated;

create function public.guard_relisting_state() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.relist_unlimited is distinct from old.relist_unlimited
  or new.max_auto_relistings is distinct from old.max_auto_relistings
  or new.auto_relistings_used is distinct from old.auto_relistings_used
  or new.completed_attempts is distinct from old.completed_attempts
  or new.final_unsold_at is distinct from old.final_unsold_at
  or new.removal_requested_at is distinct from old.removal_requested_at
  or new.removed_at is distinct from old.removed_at
  or new.pending_relist_unlimited is distinct from old.pending_relist_unlimited
  or new.pending_max_auto_relistings is distinct from old.pending_max_auto_relistings) and not (
 current_user not in ('anon','authenticated') and coalesce(current_setting('app.auction_lifecycle',true),'')='true') then
  raise exception 'Relisting state must be changed through a secure seller or lifecycle function.';
 end if;
 return new;
end; $$;
revoke all on function public.guard_relisting_state() from public,anon,authenticated;
create trigger guard_relisting_state before update on public.lots for each row execute function public.guard_relisting_state();

create function public.save_seller_draft_with_relisting(p_submission_key uuid,p_room_id uuid,p_title text,
 p_description text,p_starting_bid numeric,p_relist_unlimited boolean,p_max_auto_relistings numeric)
returns public.lots language plpgsql security definer set search_path='' as $$
declare result public.lots%rowtype; previous_flag text := current_setting('app.auction_lifecycle',true);
begin
 if p_relist_unlimited is null or p_max_auto_relistings is null or not (p_max_auto_relistings between 0 and 100)
  or p_max_auto_relistings<>trunc(p_max_auto_relistings) then raise exception 'Automatic relistings must be a whole number from 0 to 100.'; end if;
 -- Existing save RPC handles verified ownership, validation and idempotency locks.
 result := public.save_seller_draft(p_submission_key,p_room_id,p_title,p_description,p_starting_bid);
 if result.status='DRAFT' then
  perform set_config('app.auction_lifecycle','true',true);
  update public.lots set relist_unlimited=p_relist_unlimited,max_auto_relistings=p_max_auto_relistings::integer
   where id=result.id returning * into result;
  perform set_config('app.auction_lifecycle',coalesce(previous_flag,''),true);
 end if;
 result.highest_bidder_id:=null; return result;
end; $$;
revoke all on function public.save_seller_draft_with_relisting(uuid,uuid,text,text,numeric,boolean,numeric) from public,anon;
grant execute on function public.save_seller_draft_with_relisting(uuid,uuid,text,text,numeric,boolean,numeric) to authenticated;

create function public.manage_seller_listing(p_lot_id uuid,p_relist_unlimited boolean default false,
 p_max_auto_relistings numeric default 5,p_remove boolean default false)
returns public.lots language plpgsql security definer set search_path='' as $$
declare result public.lots%rowtype; room uuid; room_active boolean; observed_at timestamptz;
 previous_flag text:=current_setting('app.auction_lifecycle',true); reserved_retry boolean;
begin
 if auth.uid() is null then raise exception 'Authentication required.'; end if;
 if p_remove is null then raise exception 'Choose a valid listing action.'; end if;
 if not p_remove and (p_relist_unlimited is null or p_max_auto_relistings is null
  or not (p_max_auto_relistings between 0 and 100) or p_max_auto_relistings<>trunc(p_max_auto_relistings)) then
  raise exception 'Automatic relistings must be a whole number from 0 to 100.'; end if;
 select room_id into room from public.lots where id=p_lot_id and seller_id=auth.uid();
 if not found then raise exception 'Listing not found.'; end if;
 -- Same room-before-lot order as place_bid and the scheduler; never advance time here.
 select is_active into room_active from public.auction_rooms where id=room for update;
 select * into result from public.lots where id=p_lot_id and seller_id=auth.uid() for update;
 if not found or result.room_id<>room then raise exception 'Listing changed. Please retry.'; end if;
 if result.status in ('SOLD','DRAFT') then raise exception 'This listing cannot be managed here.'; end if;
 if result.status='CANCELLED' then
  if not p_remove then raise exception 'A removed listing cannot be restarted.'; end if;
  result.highest_bidder_id:=null; return result;
 end if;
 observed_at:=clock_timestamp();
 perform set_config('app.auction_lifecycle','true',true);
 if p_remove then
  if result.removal_requested_at is null then
   if result.status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING') then
    update public.lots set removal_requested_at=observed_at where id=p_lot_id returning * into result;
   else
    update public.lots set status='CANCELLED',removal_requested_at=observed_at,removed_at=observed_at,
     final_unsold_at=case when completed_attempts>0 then coalesce(unsold_at,final_unsold_at,observed_at) else final_unsold_at end,
     pending_relist_unlimited=null,pending_max_auto_relistings=null where id=p_lot_id returning * into result;
   end if;
  end if;
 elsif result.removal_requested_at is not null then
  raise exception 'Removal is already pending. The current attempt will finish.';
 elsif result.status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING') then
  if (p_relist_unlimited,p_max_auto_relistings::integer) is not distinct from (result.relist_unlimited,result.max_auto_relistings) then
   update public.lots set pending_relist_unlimited=null,pending_max_auto_relistings=null
    where id=p_lot_id and pending_relist_unlimited is not null returning * into result;
   if not found then select * into result from public.lots where id=p_lot_id; end if;
  elsif (p_relist_unlimited,p_max_auto_relistings::integer) is distinct from (result.pending_relist_unlimited,result.pending_max_auto_relistings) then
   update public.lots set pending_relist_unlimited=p_relist_unlimited,pending_max_auto_relistings=p_max_auto_relistings::integer
    where id=p_lot_id returning * into result;
  end if;
 else
  if (p_relist_unlimited,p_max_auto_relistings::integer) is distinct from (result.relist_unlimited,result.max_auto_relistings) then
   update public.lots set relist_unlimited=p_relist_unlimited,max_auto_relistings=p_max_auto_relistings::integer
    where id=p_lot_id returning * into result;
  end if;
  if result.status in ('WAITING','UNSOLD') and result.completed_attempts>0 and not result.relist_unlimited and result.auto_relistings_used>result.max_auto_relistings then
   update public.lots set status='EXPIRED',final_unsold_at=coalesce(result.unsold_at,observed_at) where id=p_lot_id returning * into result;
  elsif result.status='EXPIRED' and room_active and (result.relist_unlimited or result.auto_relistings_used<result.max_auto_relistings
   or (result.completed_attempts>0 and result.auto_relistings_used>=result.completed_attempts and result.auto_relistings_used=result.max_auto_relistings)) then
   -- A policy change can pause a retry already counted but not yet started.
   -- Restoring that same reservation must not spend the retry budget twice.
   reserved_retry:=result.completed_attempts>0 and result.auto_relistings_used>=result.completed_attempts;
   update public.lots set status='UNSOLD',final_unsold_at=null,auto_relistings_used=auto_relistings_used+case when reserved_retry then 0 else 1 end,
    queue_position=(select coalesce(max(queue_position),0)+1 from public.lots where room_id=room),
    next_eligible_at=observed_at+case when exists(select 1 from public.lots q where q.room_id=room and q.id<>p_lot_id
     and q.status in ('WAITING','UNSOLD') and q.next_eligible_at<=observed_at) then interval '0 seconds' else interval '60 seconds' end
    where id=p_lot_id returning * into result;
  end if;
 end if;
 perform set_config('app.auction_lifecycle',coalesce(previous_flag,''),true);
 result.highest_bidder_id:=null; return result;
end; $$;
revoke all on function public.manage_seller_listing(uuid,boolean,numeric,boolean) from public,anon;
grant execute on function public.manage_seller_listing(uuid,boolean,numeric,boolean) to authenticated;
create or replace function public.start_next_lot_preview_at(p_room_id uuid, p_transition_at timestamptz)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare selected_lot public.lots%rowtype; result public.lots%rowtype;
  previous_flag text := current_setting('app.auction_lifecycle', true);
begin
  perform 1 from public.auction_rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into result from public.lots where room_id = p_room_id
    and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING') limit 1;
  if found then result.highest_bidder_id := null; return result; end if;
  select * into selected_lot from public.lots where room_id = p_room_id
    and status in ('WAITING', 'UNSOLD') and next_eligible_at <= p_transition_at
    and final_unsold_at is null and removal_requested_at is null and removed_at is null
    order by queue_position, created_at, id limit 1 for update;
  if not found then return null; end if;
  perform set_config('app.auction_lifecycle', 'true', true);
  update public.lots set status = 'PREVIEW', current_bid = starting_bid, bid_count = 0,
    highest_bidder_id = null, preview_starts_at = p_transition_at, bidding_starts_at = null,
    ends_at = p_transition_at + interval '30 seconds', sold_at = null, unsold_at = null,
    winning_bid = null where id = selected_lot.id returning * into result;
  perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
  result.highest_bidder_id := null; return result;
end;
$$;

create or replace function public.advance_room_lifecycle(p_room_id uuid)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare active_lot public.lots%rowtype; completed_lot public.lots%rowtype;
  next_lot public.lots%rowtype; observed_at timestamptz; transition_at timestamptz;
  previous_flag text := current_setting('app.auction_lifecycle', true);
  transitions integer := 0; next_position integer; retry_allowed boolean; unlimited_mode boolean; retry_limit integer;
begin
  -- Every bidding/lifecycle function takes the room lock before the lot lock.
  perform 1 from public.auction_rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  observed_at := clock_timestamp();
  loop
    select * into active_lot from public.lots where room_id = p_room_id
      and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING') limit 1 for update;
    if not found then return public.start_next_lot_preview_at(p_room_id, observed_at); end if;
    -- Commit bounded recovery progress rather than rolling an entire recovery back.
    if transitions >= 1000 then active_lot.highest_bidder_id := null; return active_lot; end if;
    transitions := transitions + 1;
    if active_lot.ends_at is null then raise exception 'Current lot is missing its database deadline.'; end if;
    if active_lot.ends_at > observed_at then active_lot.highest_bidder_id := null; return active_lot; end if;
    transition_at := active_lot.ends_at;
    perform set_config('app.auction_lifecycle', 'true', true);
    if active_lot.status = 'PREVIEW' then
      update public.lots set status = 'FIRST_BID_WINDOW', bidding_starts_at = transition_at,
        ends_at = transition_at + interval '30 seconds' where id = active_lot.id;
      perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
      continue;
    end if;
    unlimited_mode:=coalesce(active_lot.pending_relist_unlimited,active_lot.relist_unlimited);
    retry_limit:=coalesce(active_lot.pending_max_auto_relistings,active_lot.max_auto_relistings);
    if active_lot.status = 'FIRST_BID_WINDOW' then
      retry_allowed:=active_lot.removal_requested_at is null and (unlimited_mode or active_lot.auto_relistings_used<retry_limit);
      if retry_allowed then
       select coalesce(max(queue_position),0)+1 into next_position from public.lots where room_id=p_room_id;
      end if;
      update public.lots set
        status=case when active_lot.removal_requested_at is not null then 'CANCELLED' when retry_allowed then 'UNSOLD' else 'EXPIRED' end,
        ends_at=transition_at,unsold_at=transition_at,
        final_unsold_at=case when retry_allowed then null else transition_at end,
        removed_at=case when active_lot.removal_requested_at is not null then transition_at else null end,
        completed_attempts=completed_attempts+1,
        auto_relistings_used=auto_relistings_used+case when retry_allowed then 1 else 0 end,
        relist_unlimited=unlimited_mode,max_auto_relistings=retry_limit,
        pending_relist_unlimited=null,pending_max_auto_relistings=null,
        next_eligible_at=case when retry_allowed then observed_at+case when exists (
          select 1 from public.lots q where q.room_id=p_room_id and q.id<>active_lot.id
          and q.status in ('WAITING','UNSOLD') and q.next_eligible_at<=observed_at
          and q.final_unsold_at is null and q.removal_requested_at is null and q.removed_at is null
        ) then interval '0 seconds' else interval '60 seconds' end else next_eligible_at end,
        queue_position=case when retry_allowed then next_position else queue_position end,
        highest_bidder_id=null,winning_bid=null where id=active_lot.id returning * into completed_lot;
    else
      update public.lots set status='SOLD',ends_at=transition_at,sold_at=transition_at,winning_bid=current_bid,
        completed_attempts=completed_attempts+1,relist_unlimited=unlimited_mode,max_auto_relistings=retry_limit,
        pending_relist_unlimited=null,pending_max_auto_relistings=null
        where id=active_lot.id returning * into completed_lot;
    end if;
    perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
    next_lot := public.start_next_lot_preview_at(p_room_id, observed_at);
    if next_lot.id is null then
      -- A lot may have become eligible between an overdue deadline and this call.
      next_lot := public.start_next_lot_preview_at(p_room_id, observed_at);
      if next_lot.id is null then completed_lot.highest_bidder_id := null; return completed_lot; end if;
    end if;
  end loop;
end;
$$;


create or replace function public.record_auction_attempt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.status in ('FIRST_BID_WINDOW','ACTIVE_BIDDING') and new.status in ('SOLD','UNSOLD','EXPIRED','CANCELLED') and old.status is distinct from new.status then
  insert into public.auction_attempts(lot_id,preview_started_at,completed_at,outcome,final_price)
   values(new.id,coalesce(new.preview_starts_at,new.created_at),coalesce(new.sold_at,new.unsold_at),
    case when new.status='SOLD' then 'SOLD' else 'UNSOLD' end,new.winning_bid) on conflict do nothing;
 end if;
 return new;
end; $$;

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check(kind in (
 'WATCHED_LIVE','WATCHED_SOLD','WATCHED_UNSOLD','WON','SELLER_LIVE','SELLER_SOLD','SELLER_FIRST_BID','WATCHED_FIRST_BID'));
create table public.listing_notification_events (
 lot_id uuid not null references public.lots(id),
 event_kind text not null check(event_kind in ('FIRST_LIVE','FIRST_BID','SOLD')),
 occurred_at timestamptz not null,
 primary key(lot_id,event_kind)
);
alter table public.listing_notification_events enable row level security;
revoke all on public.listing_notification_events from public,anon,authenticated;
-- Preserve every notification/read state. Seed claims from evidence of prior events,
-- without sending historical alerts. These whole-history reads run only at migration.
insert into public.listing_notification_events
 select lot_id,case when kind in ('SELLER_LIVE','WATCHED_LIVE') then 'FIRST_LIVE' else 'SOLD' end,min(created_at)
 from public.notifications where kind in ('SELLER_LIVE','WATCHED_LIVE','SELLER_SOLD','WATCHED_SOLD','WON')
 group by lot_id,case when kind in ('SELLER_LIVE','WATCHED_LIVE') then 'FIRST_LIVE' else 'SOLD' end on conflict do nothing;
insert into public.listing_notification_events
 select id,'FIRST_LIVE',coalesce(bidding_starts_at,sold_at,unsold_at,created_at) from public.lots
 where bidding_starts_at is not null or sold_at is not null or unsold_at is not null
 on conflict do nothing;
insert into public.listing_notification_events
 select lot_id,'FIRST_LIVE',min(completed_at) from public.auction_attempts group by lot_id on conflict do nothing;
insert into public.listing_notification_events
 select lot_id,'FIRST_BID',min(created_at) from public.bids group by lot_id on conflict do nothing;
insert into public.listing_notification_events
 select id,'SOLD',sold_at from public.lots where status='SOLD' on conflict do nothing;

create or replace function public.notify_lot_transition() returns trigger language plpgsql security definer set search_path='' as $$
declare event_name text; seller_kind text; watcher_kind text;
 run_at timestamptz:=coalesce(new.preview_starts_at,new.bidding_starts_at,new.created_at);
begin
 if old.status=new.status then return new; end if;
 if new.status='FIRST_BID_WINDOW' and old.status='PREVIEW' then
  event_name:='FIRST_LIVE';seller_kind:='SELLER_LIVE';watcher_kind:='WATCHED_LIVE';
 elsif new.status='ACTIVE_BIDDING' and old.status='FIRST_BID_WINDOW' and new.bid_count>old.bid_count then
  event_name:='FIRST_BID';seller_kind:='SELLER_FIRST_BID';watcher_kind:='WATCHED_FIRST_BID';
 elsif new.status='SOLD' then
  event_name:='SOLD';seller_kind:='SELLER_SOLD';watcher_kind:='WATCHED_SOLD';
 else return new;
 end if;
 insert into public.listing_notification_events(lot_id,event_kind,occurred_at)
  values(new.id,event_name,clock_timestamp()) on conflict do nothing;
 if not found then return new; end if;
 insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run)
  values(new.seller_id,new.id,seller_kind,new.title,run_at) on conflict do nothing;
 insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run)
  select w.user_id,new.id,watcher_kind,new.title,run_at from public.watchlist w
  where w.lot_id=new.id and w.user_id<>new.seller_id
   and (event_name<>'SOLD' or w.user_id is distinct from new.highest_bidder_id)
  on conflict do nothing;
 if event_name='SOLD' and new.highest_bidder_id is not null then
  insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run)
   values(new.highest_bidder_id,new.id,'WON',new.title,run_at) on conflict do nothing;
 end if;
 return new;
end; $$;
commit;
