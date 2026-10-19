-- Apply manually after 009. No hosted database execution is required by this change.
begin;
-- Retain legacy timing columns for compatibility; requeue_delay_days is no longer used.
create table public.auction_attempts (
 lot_id uuid not null references public.lots(id),
 preview_started_at timestamptz not null,
 completed_at timestamptz not null,
 outcome text not null check (outcome in ('SOLD','UNSOLD')),
 final_price numeric,
 primary key(lot_id, preview_started_at)
);
alter table public.auction_attempts enable row level security;
revoke all on public.auction_attempts from public, anon, authenticated;
grant select on public.auction_attempts to authenticated;
create policy "Sellers read their attempts" on public.auction_attempts for select to authenticated
 using (exists(select 1 from public.lots l where l.id=lot_id and l.seller_id=auth.uid()));
create function public.record_auction_attempt() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status in ('SOLD','UNSOLD') and old.status is distinct from new.status then
 insert into public.auction_attempts values(new.id,coalesce(new.preview_starts_at,new.created_at),coalesce(new.sold_at,new.unsold_at),new.status::text,new.winning_bid) on conflict do nothing;
 end if;
 return new;
end; $$;
revoke all on function public.record_auction_attempt() from public,anon,authenticated;
create trigger record_auction_attempt after update of status on public.lots for each row execute function public.record_auction_attempt();
insert into public.auction_attempts select id,coalesce(preview_starts_at,created_at),coalesce(sold_at,unsold_at),status::text,winning_bid from public.lots where status in ('SOLD','UNSOLD') and coalesce(sold_at,unsold_at) is not null on conflict do nothing;
-- Participants retain their completed lot even if the original room is later disabled.
create policy "Participants read completed lots" on public.lots for select to authenticated
 using(status='SOLD' and (seller_id=auth.uid() or highest_bidder_id=auth.uid()));
-- A definer check avoids recursive room/lot RLS evaluation for archived rooms.
create function public.has_completed_lot_in_room(p_room_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from public.lots where room_id=p_room_id and status='SOLD' and (seller_id=auth.uid() or highest_bidder_id=auth.uid()));
$$;
revoke all on function public.has_completed_lot_in_room(uuid) from public,anon;
grant execute on function public.has_completed_lot_in_room(uuid) to authenticated;
create policy "Participants read historical rooms" on public.auction_rooms for select to authenticated
 using(public.has_completed_lot_in_room(id));
-- Restrict the winner identity at the column boundary; public catalogue remains readable.
revoke select on public.lots from anon,authenticated;
grant select (submission_key,id,room_id,seller_id,title,description,condition_report,shipping_info,estimate_low,estimate_high,starting_bid,current_bid,bid_count,minimum_increment,bid_extension_seconds,preview_duration_seconds,first_bid_duration_seconds,requeue_delay_days,status,starts_at,preview_starts_at,bidding_starts_at,ends_at,sold_at,unsold_at,next_eligible_at,queue_position,winning_bid,is_premium,created_at,updated_at) on public.lots to anon,authenticated;
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
  transitions integer := 0; next_position integer;
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
    if active_lot.status = 'FIRST_BID_WINDOW' then
      select coalesce(max(queue_position), 0) + 1 into next_position from public.lots where room_id = p_room_id;
      update public.lots set status = 'UNSOLD', ends_at = transition_at, unsold_at = transition_at,
        next_eligible_at = observed_at + case when exists (select 1 from public.lots q where q.room_id = p_room_id and q.id <> active_lot.id and q.status in ('WAITING', 'UNSOLD') and q.next_eligible_at <= observed_at) then interval '0 seconds' else interval '60 seconds' end, queue_position = next_position,
        highest_bidder_id = null, winning_bid = null where id = active_lot.id returning * into completed_lot;
    else
      update public.lots set status = 'SOLD', ends_at = transition_at, sold_at = transition_at,
        winning_bid = current_bid where id = active_lot.id returning * into completed_lot;
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

create or replace function public.place_bid(lot_id uuid, bid_amount numeric)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare bidder uuid := auth.uid(); room uuid; existing_lot public.lots%rowtype;
  result public.lots%rowtype; accepted_at timestamptz; required_bid numeric;
  previous_flag text := current_setting('app.place_bid', true);
begin
  if bidder is null then raise exception 'Authentication required to place a bid.'; end if;
  if not exists (select 1 from auth.users where id = bidder and email_confirmed_at is not null) then
    raise exception 'Confirm your email before placing a bid.';
  end if;
  if $2 is null or not ($2 between 0.01 and 999999999999.99) or $2 <> round($2, 2) then
    raise exception 'Bid amount must be a finite positive amount with at most two decimal places.';
  end if;
  select room_id into room from public.lots where id = $1;
  if not found then raise exception 'Lot not found.'; end if;
  perform 1 from public.auction_rooms where id = room and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into existing_lot from public.lots where id = $1 for update;
  accepted_at := clock_timestamp();
  if not found or existing_lot.room_id <> room or existing_lot.status not in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING') then
    raise exception 'Lot is not open for bidding.';
  end if;
  if existing_lot.seller_id = bidder then raise exception 'You cannot bid on your own lot.'; end if;
  if existing_lot.ends_at is null or accepted_at >= existing_lot.ends_at then
    raise exception 'Lot bidding has ended.';
  end if;
  required_bid := case when existing_lot.status = 'FIRST_BID_WINDOW'
    then greatest(existing_lot.starting_bid, 0.01)
    else existing_lot.current_bid + existing_lot.minimum_increment end;
  if $2 < required_bid then raise exception 'Bid must be at least %.', required_bid; end if;
  perform set_config('app.place_bid', 'true', true);
  insert into public.bids (lot_id, bidder_id, amount) values ($1, bidder, $2);
  update public.lots set current_bid = $2, bid_count = existing_lot.bid_count + 1,
    highest_bidder_id = bidder, status = 'ACTIVE_BIDDING',
    bidding_starts_at = coalesce(existing_lot.bidding_starts_at, accepted_at),
    ends_at = accepted_at + interval '5 seconds', sold_at = null, unsold_at = null,
    winning_bid = null where id = existing_lot.id returning * into result;
  perform set_config('app.place_bid', coalesce(previous_flag, ''), true);
  result.highest_bidder_id := null; return result;
end;
$$;

create or replace function public.notify_lot_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  run_at timestamptz := coalesce(new.preview_starts_at, new.bidding_starts_at, new.created_at);
  watcher_kind text;
begin
  if old.status = new.status then return new; end if;
  -- "Live" means bidding has opened, not the non-bidding preview or first bid.
  if new.status in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
    and old.status not in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING') then
    watcher_kind := 'WATCHED_LIVE';
    insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
      values (new.seller_id, new.id, 'SELLER_LIVE', new.title, run_at)
      on conflict (user_id, lot_id, kind, auction_run) do nothing;
  elsif new.status = 'SOLD' then
    watcher_kind := 'WATCHED_SOLD';
    insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
      values (new.seller_id, new.id, 'SELLER_SOLD', new.title, run_at)
      on conflict (user_id, lot_id, kind, auction_run) do nothing;
    if new.highest_bidder_id is not null then
      insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
        values (new.highest_bidder_id, new.id, 'WON', new.title, run_at)
        on conflict (user_id, lot_id, kind, auction_run) do nothing;
    end if;
  elsif new.status = 'UNSOLD' then
    watcher_kind := 'WATCHED_UNSOLD';
  end if;
  if watcher_kind is not null then
    insert into public.notifications(user_id, lot_id, kind, lot_title, auction_run)
      select w.user_id, new.id, watcher_kind, new.title, run_at
      from public.watchlist w where w.lot_id = new.id and (watcher_kind <> 'WATCHED_UNSOLD' or not exists (select 1 from public.notifications n where n.user_id = w.user_id and n.lot_id = new.id and n.kind = 'WATCHED_UNSOLD'))
      on conflict (user_id, lot_id, kind, auction_run) do nothing;
  end if;
  return new;
end;
$$;

-- Private names are available only to the participants. No email/address/payment data.
create function public.my_completed_auctions() returns table(lot_id uuid, sale_price numeric, completed_at timestamptz, seller_name text, buyer_name text, is_buyer boolean)
language sql stable security definer set search_path='' as $$
 select l.id,l.winning_bid,l.sold_at,coalesce(s.display_name,'Seller'),coalesce(b.display_name,'Buyer'),l.highest_bidder_id=auth.uid()
 from public.lots l left join public.profiles s on s.id=l.seller_id left join public.profiles b on b.id=l.highest_bidder_id
 where auth.uid() is not null and l.status='SOLD' and (l.highest_bidder_id=auth.uid() or l.seller_id=auth.uid());
$$;
revoke all on function public.my_completed_auctions() from public,anon;
grant execute on function public.my_completed_auctions() to authenticated;
-- Sellers can inspect bid history for their own completed listings.
create policy "Sellers read completed bidding history" on public.bids for select to authenticated
 using(exists(select 1 from public.lots l where l.id=lot_id and l.seller_id=auth.uid() and l.status='SOLD'));
-- Existing unsold lots return to the queue tail in their existing deterministic order.
select set_config('app.auction_lifecycle','true',true);
with queued as (select id,room_id,row_number() over(partition by room_id order by queue_position,created_at,id) as position from public.lots where status='UNSOLD'), tails as (select room_id,max(queue_position) as tail from public.lots group by room_id)
update public.lots l set queue_position=t.tail+q.position,next_eligible_at=clock_timestamp() from queued q join tails t on t.room_id=q.room_id where l.id=q.id;
select set_config('app.auction_lifecycle','false',true);
commit;
