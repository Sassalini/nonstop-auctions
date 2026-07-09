alter table public.lots
drop constraint if exists lots_status_check;

alter table public.lots
add column if not exists first_bid_duration_seconds integer not null default 30 check (first_bid_duration_seconds > 0),
add column if not exists requeue_delay_days integer not null default 7 check (requeue_delay_days >= 0),
add column if not exists preview_starts_at timestamptz,
add column if not exists bidding_starts_at timestamptz,
add column if not exists unsold_at timestamptz,
add column if not exists next_eligible_at timestamptz not null default now(),
add column if not exists queue_position integer not null default 0;

update public.lots
set status = case status
  when 'LIVE' then 'FIRST_BID_WINDOW'
  when 'EXTENDED' then 'ACTIVE_BIDDING'
  else status
end
where status in ('LIVE', 'EXTENDED');

alter table public.lots
add constraint lots_status_check check (
  status in (
    'DRAFT',
    'WAITING',
    'PREVIEW',
    'FIRST_BID_WINDOW',
    'ACTIVE_BIDDING',
    'SOLD',
    'UNSOLD',
    'CANCELLED'
  )
);

create index if not exists lots_room_queue_idx
on public.lots (room_id, queue_position, next_eligible_at);

create index if not exists lots_room_status_queue_idx
on public.lots (room_id, status, queue_position, next_eligible_at);

create or replace function public.prevent_direct_lot_bid_state_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.place_bid', true) = 'true'
    or current_setting('app.auction_lifecycle', true) = 'true'
  then
    return new;
  end if;

  if new.current_bid is distinct from old.current_bid
    or new.highest_bidder_id is distinct from old.highest_bidder_id
    or new.winning_bid is distinct from old.winning_bid
    or new.sold_at is distinct from old.sold_at
    or new.unsold_at is distinct from old.unsold_at
    or new.ends_at is distinct from old.ends_at
    or new.preview_starts_at is distinct from old.preview_starts_at
    or new.bidding_starts_at is distinct from old.bidding_starts_at
    or new.next_eligible_at is distinct from old.next_eligible_at
    or new.queue_position is distinct from old.queue_position
    or new.status is distinct from old.status
  then
    raise exception 'Lot bid and lifecycle state must be changed through a secure server function.';
  end if;

  return new;
end;
$$;

drop policy if exists "Logged-in users can insert bids" on public.bids;
create policy "Logged-in users can insert bids"
on public.bids
for insert
to authenticated
with check (
  current_setting('app.place_bid', true) = 'true'
  and bidder_id = auth.uid()
  and exists (
    select 1
    from public.lots
    where lots.id = bids.lot_id
      and lots.status in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
      and lots.ends_at is not null
      and now() < lots.ends_at
  )
);

create or replace function public.start_next_lot_preview(p_room_id uuid)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_lot public.lots%rowtype;
  updated_lot public.lots%rowtype;
  transition_at timestamptz := now();
begin
  select *
  into selected_lot
  from public.lots
  where room_id = p_room_id
    and status in ('WAITING', 'UNSOLD')
    and coalesce(next_eligible_at, transition_at) <= transition_at
  order by queue_position asc, created_at asc
  for update skip locked
  limit 1;

  if not found then
    return null;
  end if;

  perform set_config('app.auction_lifecycle', 'true', true);

  update public.lots
  set
    status = 'PREVIEW',
    preview_starts_at = transition_at,
    bidding_starts_at = null,
    ends_at = transition_at + make_interval(secs => preview_duration_seconds),
    sold_at = null,
    unsold_at = null,
    winning_bid = null,
    updated_at = transition_at
  where id = selected_lot.id
  returning * into updated_lot;

  return updated_lot;
end;
$$;

create or replace function public.advance_lot(p_lot_id uuid)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  current_lot public.lots%rowtype;
  updated_lot public.lots%rowtype;
  next_lot public.lots%rowtype;
  top_bid public.bids%rowtype;
  transition_at timestamptz := now();
  next_queue_position integer;
begin
  select *
  into current_lot
  from public.lots
  where id = p_lot_id
  for update;

  if not found then
    raise exception 'Lot not found.';
  end if;

  if current_lot.status not in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING') then
    return current_lot;
  end if;

  if current_lot.ends_at is null or transition_at < current_lot.ends_at then
    return current_lot;
  end if;

  perform set_config('app.auction_lifecycle', 'true', true);

  if current_lot.status = 'PREVIEW' then
    update public.lots
    set
      status = 'FIRST_BID_WINDOW',
      bidding_starts_at = transition_at,
      ends_at = transition_at + make_interval(secs => first_bid_duration_seconds),
      updated_at = transition_at
    where id = current_lot.id
    returning * into updated_lot;

    return updated_lot;
  end if;

  if current_lot.status = 'FIRST_BID_WINDOW' then
    select *
    into top_bid
    from public.bids
    where lot_id = current_lot.id
    order by amount desc, created_at asc
    limit 1;

    if found then
      update public.lots
      set
        status = 'ACTIVE_BIDDING',
        current_bid = top_bid.amount,
        highest_bidder_id = top_bid.bidder_id,
        ends_at = transition_at + make_interval(secs => bid_extension_seconds),
        updated_at = transition_at
      where id = current_lot.id
      returning * into updated_lot;

      return updated_lot;
    end if;

    select coalesce(max(queue_position), 0) + 1
    into next_queue_position
    from public.lots
    where room_id = current_lot.room_id;

    update public.lots
    set
      status = 'UNSOLD',
      ends_at = null,
      unsold_at = transition_at,
      next_eligible_at = transition_at + make_interval(days => requeue_delay_days),
      queue_position = next_queue_position,
      updated_at = transition_at
    where id = current_lot.id
    returning * into updated_lot;

    next_lot := public.start_next_lot_preview(current_lot.room_id);

    if next_lot.id is not null then
      return next_lot;
    end if;

    return updated_lot;
  end if;

  if current_lot.status = 'ACTIVE_BIDDING' then
    update public.lots
    set
      status = 'SOLD',
      ends_at = transition_at,
      sold_at = transition_at,
      winning_bid = current_bid,
      updated_at = transition_at
    where id = current_lot.id
    returning * into updated_lot;

    next_lot := public.start_next_lot_preview(current_lot.room_id);

    if next_lot.id is not null then
      return next_lot;
    end if;

    return updated_lot;
  end if;

  return current_lot;
end;
$$;

create or replace function public.advance_room_lifecycle(p_room_id uuid)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  active_lot public.lots%rowtype;
  transition_at timestamptz := now();
begin
  select *
  into active_lot
  from public.lots
  where room_id = p_room_id
    and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
  order by queue_position asc, created_at asc
  for update
  limit 1;

  if found then
    if active_lot.ends_at is not null and transition_at >= active_lot.ends_at then
      return public.advance_lot(active_lot.id);
    end if;

    return active_lot;
  end if;

  return public.start_next_lot_preview(p_room_id);
end;
$$;

create or replace function public.place_bid(lot_id uuid, bid_amount numeric)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  bidder uuid := auth.uid();
  existing_lot public.lots%rowtype;
  updated_lot public.lots%rowtype;
  required_bid numeric;
  transition_at timestamptz := now();
begin
  if bidder is null then
    raise exception 'Authentication required to place a bid.';
  end if;

  if $2 is null or $2 <= 0 then
    raise exception 'Bid amount must be greater than zero.';
  end if;

  select *
  into existing_lot
  from public.lots
  where id = $1
  for update;

  if not found then
    raise exception 'Lot not found.';
  end if;

  if existing_lot.status not in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING') then
    raise exception 'Lot is not open for bidding.';
  end if;

  if existing_lot.ends_at is null or transition_at >= existing_lot.ends_at then
    raise exception 'Lot bidding has ended.';
  end if;

  if existing_lot.status = 'FIRST_BID_WINDOW' then
    required_bid := greatest(existing_lot.current_bid, existing_lot.starting_bid);
  else
    required_bid := existing_lot.current_bid + existing_lot.minimum_increment;
  end if;

  if $2 < required_bid then
    raise exception 'Bid must be at least %.', required_bid;
  end if;

  perform set_config('app.place_bid', 'true', true);

  insert into public.bids (lot_id, bidder_id, amount)
  values ($1, bidder, $2);

  update public.lots
  set
    current_bid = $2,
    highest_bidder_id = bidder,
    status = 'ACTIVE_BIDDING',
    bidding_starts_at = coalesce(existing_lot.bidding_starts_at, transition_at),
    ends_at = transition_at + make_interval(secs => existing_lot.bid_extension_seconds),
    sold_at = null,
    unsold_at = null,
    winning_bid = null,
    updated_at = transition_at
  where id = existing_lot.id
  returning * into updated_lot;

  return updated_lot;
end;
$$;

revoke execute on function public.start_next_lot_preview(uuid) from public;
revoke execute on function public.advance_lot(uuid) from public;
revoke execute on function public.advance_room_lifecycle(uuid) from public;
revoke execute on function public.place_bid(uuid, numeric) from public;

grant execute on function public.advance_lot(uuid) to anon, authenticated;
grant execute on function public.advance_room_lifecycle(uuid) to anon, authenticated;
grant execute on function public.place_bid(uuid, numeric) to authenticated;
