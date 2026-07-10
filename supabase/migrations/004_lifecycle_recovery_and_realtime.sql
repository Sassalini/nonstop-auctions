alter table public.lots
add column if not exists bid_count integer not null default 0 check (bid_count >= 0);

update public.lots as lots
set bid_count = bid_totals.total
from (
  select lot_id, count(*)::integer as total
  from public.bids
  group by lot_id
) as bid_totals
where lots.id = bid_totals.lot_id
  and lots.bid_count is distinct from bid_totals.total;

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
    or new.bid_count is distinct from old.bid_count
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

create or replace function public.start_next_lot_preview_at(
  p_room_id uuid,
  p_transition_at timestamptz
)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_lot public.lots%rowtype;
  active_lot public.lots%rowtype;
  updated_lot public.lots%rowtype;
begin
  perform 1
  from public.auction_rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Auction room not found.';
  end if;

  select *
  into active_lot
  from public.lots
  where room_id = p_room_id
    and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
  order by queue_position asc, created_at asc
  limit 1;

  if found then
    return active_lot;
  end if;

  select *
  into selected_lot
  from public.lots
  where room_id = p_room_id
    and status in ('WAITING', 'UNSOLD')
    and coalesce(next_eligible_at, p_transition_at) <= p_transition_at
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
    current_bid = starting_bid,
    bid_count = 0,
    highest_bidder_id = null,
    preview_starts_at = p_transition_at,
    bidding_starts_at = null,
    ends_at = p_transition_at + make_interval(secs => preview_duration_seconds),
    sold_at = null,
    unsold_at = null,
    winning_bid = null,
    updated_at = clock_timestamp()
  where id = selected_lot.id
  returning * into updated_lot;

  return updated_lot;
end;
$$;

create or replace function public.start_next_lot_preview(p_room_id uuid)
returns public.lots
language sql
security definer
set search_path = public
as $$
  select public.start_next_lot_preview_at(p_room_id, clock_timestamp());
$$;

create or replace function public.advance_room_lifecycle(p_room_id uuid)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  active_lot public.lots%rowtype;
  completed_lot public.lots%rowtype;
  next_lot public.lots%rowtype;
  top_bid public.bids%rowtype;
  observed_at timestamptz := clock_timestamp();
  transition_at timestamptz;
  next_queue_position integer;
  total_bids integer;
  transitions integer := 0;
begin
  perform 1
  from public.auction_rooms
  where id = p_room_id
  for update;

  if not found then
    raise exception 'Auction room not found.';
  end if;

  loop
    transitions := transitions + 1;

    if transitions > 1000 then
      raise exception 'Auction lifecycle recovery exceeded its safety limit for room %.', p_room_id;
    end if;

    select *
    into active_lot
    from public.lots
    where room_id = p_room_id
      and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
    order by queue_position asc, created_at asc
    for update
    limit 1;

    if not found then
      return public.start_next_lot_preview_at(p_room_id, observed_at);
    end if;

    if active_lot.ends_at is null then
      perform set_config('app.auction_lifecycle', 'true', true);

      update public.lots
      set
        ends_at = observed_at + make_interval(
          secs => case
            when status = 'PREVIEW' then preview_duration_seconds
            when status = 'FIRST_BID_WINDOW' then first_bid_duration_seconds
            else bid_extension_seconds
          end
        ),
        updated_at = observed_at
      where id = active_lot.id
      returning * into active_lot;

      return active_lot;
    end if;

    if active_lot.ends_at > observed_at then
      return active_lot;
    end if;

    transition_at := active_lot.ends_at;
    perform set_config('app.auction_lifecycle', 'true', true);

    if active_lot.status = 'PREVIEW' then
      update public.lots
      set
        status = 'FIRST_BID_WINDOW',
        bidding_starts_at = transition_at,
        ends_at = transition_at + make_interval(secs => first_bid_duration_seconds),
        updated_at = observed_at
      where id = active_lot.id
      returning * into active_lot;

      continue;
    end if;

    if active_lot.status = 'FIRST_BID_WINDOW' then
      select *
      into top_bid
      from public.bids
      where lot_id = active_lot.id
      order by amount desc, created_at asc
      limit 1;

      if found then
        select count(*)::integer
        into total_bids
        from public.bids
        where lot_id = active_lot.id;

        update public.lots
        set
          status = 'ACTIVE_BIDDING',
          current_bid = top_bid.amount,
          bid_count = total_bids,
          highest_bidder_id = top_bid.bidder_id,
          ends_at = transition_at + make_interval(secs => bid_extension_seconds),
          updated_at = observed_at
        where id = active_lot.id
        returning * into active_lot;

        continue;
      end if;

      select coalesce(max(queue_position), 0) + 1
      into next_queue_position
      from public.lots
      where room_id = active_lot.room_id;

      update public.lots
      set
        status = 'UNSOLD',
        ends_at = transition_at,
        unsold_at = transition_at,
        next_eligible_at = transition_at + make_interval(days => requeue_delay_days),
        queue_position = next_queue_position,
        updated_at = observed_at
      where id = active_lot.id
      returning * into completed_lot;

      next_lot := public.start_next_lot_preview_at(active_lot.room_id, transition_at);

      if next_lot.id is null then
        return completed_lot;
      end if;

      continue;
    end if;

    update public.lots
    set
      status = 'SOLD',
      ends_at = transition_at,
      sold_at = transition_at,
      winning_bid = current_bid,
      updated_at = observed_at
    where id = active_lot.id
    returning * into completed_lot;

    next_lot := public.start_next_lot_preview_at(active_lot.room_id, transition_at);

    if next_lot.id is null then
      return completed_lot;
    end if;
  end loop;
end;
$$;

create or replace function public.advance_lot(p_lot_id uuid)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  lot_room_id uuid;
begin
  select room_id
  into lot_room_id
  from public.lots
  where id = p_lot_id;

  if not found then
    raise exception 'Lot not found.';
  end if;

  return public.advance_room_lifecycle(lot_room_id);
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
  lot_room_id uuid;
  existing_lot public.lots%rowtype;
  updated_lot public.lots%rowtype;
  required_bid numeric;
  transition_at timestamptz;
begin
  if bidder is null then
    raise exception 'Authentication required to place a bid.';
  end if;

  if $2 is null or $2 <= 0 then
    raise exception 'Bid amount must be greater than zero.';
  end if;

  select room_id
  into lot_room_id
  from public.lots
  where id = $1;

  if not found then
    raise exception 'Lot not found.';
  end if;

  perform 1
  from public.auction_rooms
  where id = lot_room_id
  for update;

  select *
  into existing_lot
  from public.lots
  where id = $1
  for update;

  transition_at := clock_timestamp();

  if existing_lot.room_id <> lot_room_id
    or existing_lot.status not in ('FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
  then
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
    bid_count = existing_lot.bid_count + 1,
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

do $$
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) and not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lots'
  ) then
    execute 'alter publication supabase_realtime add table public.lots';
  end if;
end;
$$;

grant select on table public.auction_rooms to anon, authenticated;
grant select on table public.lots to anon, authenticated;
grant select on table public.lot_images to anon, authenticated;
grant select on table public.bids to anon, authenticated;

revoke execute on function public.start_next_lot_preview_at(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.start_next_lot_preview(uuid) from public, anon, authenticated;
revoke execute on function public.advance_lot(uuid) from public, anon, authenticated;
revoke execute on function public.advance_room_lifecycle(uuid) from public;
revoke execute on function public.place_bid(uuid, numeric) from public;

grant execute on function public.advance_room_lifecycle(uuid) to anon, authenticated;
grant execute on function public.place_bid(uuid, numeric) to authenticated;
