begin;

select set_config('app.auction_lifecycle', 'true', true);

do $$
declare
  test_room_id uuid;
  test_bidder_id uuid := '00000000-0000-0000-0000-000000000101';
  first_lot_id uuid;
  second_lot_id uuid;
  third_lot_id uuid;
  first_lot public.lots%rowtype;
  previous_deadline timestamptz;
  expected_increment numeric;
  rejected boolean;
  duplicate_active_blocked boolean := false;
begin
  select id
  into test_room_id
  from public.auction_rooms
  where slug = 'general-room';

  if test_room_id is null then
    raise exception 'Test fixture missing: general-room.';
  end if;

  select id into first_lot_id
  from public.lots
  where room_id = test_room_id
  order by queue_position, created_at
  offset 0 limit 1;

  select id into second_lot_id
  from public.lots
  where room_id = test_room_id
  order by queue_position, created_at
  offset 1 limit 1;

  select id into third_lot_id
  from public.lots
  where room_id = test_room_id
  order by queue_position, created_at
  offset 2 limit 1;

  if first_lot_id is null or second_lot_id is null or third_lot_id is null then
    raise exception 'Test fixture requires at least three lots in general-room.';
  end if;

  delete from public.bids
  where lot_id in (
    select id from public.lots where room_id = test_room_id
  );

  update public.lots
  set
    status = 'WAITING',
    current_bid = starting_bid,
    bid_count = 0,
    highest_bidder_id = null,
    winning_bid = null,
    preview_starts_at = null,
    bidding_starts_at = null,
    ends_at = null,
    sold_at = null,
    unsold_at = null,
    next_eligible_at = clock_timestamp()
  where room_id = test_room_id;

  update public.lots
  set
    status = 'PREVIEW',
    preview_starts_at = clock_timestamp() - interval '2 seconds',
    ends_at = clock_timestamp() - interval '1 second'
  where id = first_lot_id;

  perform public.advance_room_lifecycle(test_room_id);

  select * into first_lot from public.lots where id = first_lot_id;

  if first_lot.status <> 'FIRST_BID_WINDOW' or first_lot.ends_at <= clock_timestamp() then
    raise exception 'Preview did not advance to an open first-bid window.';
  end if;

  perform set_config('request.jwt.claim.sub', test_bidder_id::text, true);
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', test_bidder_id::text, 'role', 'authenticated')::text,
    true
  );

  select *
  into first_lot
  from public.place_bid(first_lot_id, first_lot.starting_bid);

  if first_lot.status <> 'ACTIVE_BIDDING'
    or first_lot.bid_count <> 1
    or first_lot.ends_at < clock_timestamp() + interval '4 seconds'
  then
    raise exception 'First bid did not start a fresh active-bidding window.';
  end if;

  rejected := false;
  begin
    perform public.place_bid(first_lot_id, first_lot.current_bid);
  exception when others then
    if sqlerrm like 'Bid must be at least %' then
      rejected := true;
    else
      raise;
    end if;
  end;

  if not rejected then
    raise exception 'An equal active bid was not rejected.';
  end if;

  previous_deadline := first_lot.ends_at;
  expected_increment := first_lot.minimum_increment;

  select *
  into first_lot
  from public.place_bid(first_lot_id, first_lot.current_bid + expected_increment);

  if first_lot.bid_count <> 2
    or first_lot.ends_at <= previous_deadline
    or first_lot.ends_at < clock_timestamp() + interval '4 seconds'
  then
    raise exception 'A later valid bid did not reset a fresh five-second window.';
  end if;

  update public.lots
  set ends_at = clock_timestamp() - interval '1 second'
  where id = first_lot_id;

  rejected := false;
  begin
    perform public.place_bid(first_lot_id, first_lot.current_bid + expected_increment);
  exception when others then
    if sqlerrm = 'Lot bidding has ended.' then
      rejected := true;
    else
      raise;
    end if;
  end;

  if not rejected then
    raise exception 'A late bid was not rejected.';
  end if;

  perform public.advance_room_lifecycle(test_room_id);

  select * into first_lot from public.lots where id = first_lot_id;

  if first_lot.status <> 'SOLD'
    or first_lot.winning_bid <> first_lot.current_bid
    or first_lot.highest_bidder_id <> test_bidder_id
    or first_lot.sold_at is null
  then
    raise exception 'Expired active bidding did not record the winner and sale.';
  end if;

  if (select status from public.lots where id = second_lot_id) <> 'PREVIEW' then
    raise exception 'The next lot did not enter preview after the sale.';
  end if;

  update public.lots
  set
    status = 'FIRST_BID_WINDOW',
    bidding_starts_at = clock_timestamp() - interval '2 seconds',
    ends_at = clock_timestamp() - interval '1 second'
  where id = second_lot_id;

  perform public.advance_room_lifecycle(test_room_id);

  if (select status from public.lots where id = second_lot_id) <> 'UNSOLD' then
    raise exception 'A no-bid lot was not returned to its queue.';
  end if;

  if (select queue_position from public.lots where id = second_lot_id) <
    (select max(queue_position) from public.lots where room_id = test_room_id)
  then
    raise exception 'The returned lot was not moved to the bottom of its room queue.';
  end if;

  if (select status from public.lots where id = third_lot_id) <> 'PREVIEW' then
    raise exception 'The next same-room lot did not start after a return.';
  end if;

  update public.lots
  set ends_at = clock_timestamp() - interval '2 minutes'
  where id = third_lot_id;

  perform public.advance_room_lifecycle(test_room_id);

  if (select status from public.lots where id = third_lot_id) = 'PREVIEW' then
    raise exception 'Overdue recovery left the lot stuck in preview.';
  end if;

  if (
    select count(*)
    from public.lots
    where room_id = test_room_id
      and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
  ) > 1 then
    raise exception 'The room has more than one current lot.';
  end if;

  update public.lots
  set status = 'WAITING', ends_at = null
  where room_id = test_room_id;

  update public.lots
  set status = 'PREVIEW', ends_at = clock_timestamp() + interval '30 seconds'
  where id = first_lot_id;

  begin
    update public.lots
    set status = 'PREVIEW', ends_at = clock_timestamp() + interval '30 seconds'
    where id = second_lot_id;
  exception when unique_violation then
    duplicate_active_blocked := true;
  end;

  if not duplicate_active_blocked then
    raise exception 'The one-current-lot database constraint did not reject a duplicate.';
  end if;
end;
$$;

rollback;
