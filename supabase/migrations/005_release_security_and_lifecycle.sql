-- Apply with auction traffic paused. Existing deadlines and completed results are preserved.
-- An invalid historical monetary/result record causes this migration to fail for manual review.
begin;

alter function public.set_lot_updated_at() set search_path = '';
alter function public.prevent_direct_bid_insert() set search_path = '';
alter function public.advance_lot(uuid) set search_path = '';
alter function public.start_next_lot_preview(uuid) set search_path = '';

create or replace function public.prevent_direct_lot_bid_state_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_user not in ('anon', 'authenticated') and (
    current_setting('app.place_bid', true) = 'true'
    or current_setting('app.auction_lifecycle', true) = 'true'
  ) then return new; end if;

  if new.current_bid is distinct from old.current_bid
    or new.bid_count is distinct from old.bid_count
    or new.highest_bidder_id is distinct from old.highest_bidder_id
    or new.winning_bid is distinct from old.winning_bid
    or new.sold_at is distinct from old.sold_at
    or new.unsold_at is distinct from old.unsold_at
    or new.ends_at is distinct from old.ends_at
    or new.starts_at is distinct from old.starts_at
    or new.preview_starts_at is distinct from old.preview_starts_at
    or new.bidding_starts_at is distinct from old.bidding_starts_at
    or new.next_eligible_at is distinct from old.next_eligible_at
    or new.queue_position is distinct from old.queue_position
    or new.status is distinct from old.status
    or new.preview_duration_seconds is distinct from old.preview_duration_seconds
    or new.first_bid_duration_seconds is distinct from old.first_bid_duration_seconds
    or new.bid_extension_seconds is distinct from old.bid_extension_seconds
    or new.requeue_delay_days is distinct from old.requeue_delay_days
    or new.is_premium is distinct from old.is_premium
    or new.seller_id is distinct from old.seller_id
    or (old.status <> 'DRAFT' and new.room_id is distinct from old.room_id)
  then raise exception 'Lot state must be changed through a secure server function.'; end if;
  return new;
end;
$$;

select set_config('app.auction_lifecycle', 'true', true);
update public.lots set preview_duration_seconds = 30, first_bid_duration_seconds = 30,
  bid_extension_seconds = 5, requeue_delay_days = 7
where preview_duration_seconds <> 30 or first_bid_duration_seconds <> 30
  or bid_extension_seconds <> 5 or requeue_delay_days <> 7;
select set_config('app.auction_lifecycle', 'false', true);

alter table public.lots add constraint lots_release_timings_check check (
  preview_duration_seconds = 30 and first_bid_duration_seconds = 30
  and bid_extension_seconds = 5 and requeue_delay_days = 7
);
alter table public.lots add constraint lots_finite_money_check check (
  starting_bid between 0 and 999999999999.99 and starting_bid = round(starting_bid, 2)
  and current_bid between 0 and 999999999999.99 and current_bid = round(current_bid, 2)
  and minimum_increment between 0.01 and 999999999999.99 and minimum_increment = round(minimum_increment, 2)
  and (winning_bid is null or (winning_bid between 0.01 and 999999999999.99 and winning_bid = round(winning_bid, 2)))
  and (estimate_low is null or (estimate_low between 0 and 999999999999.99 and estimate_low = round(estimate_low, 2)))
  and (estimate_high is null or (estimate_high between 0 and 999999999999.99 and estimate_high = round(estimate_high, 2)))
);
alter table public.bids add constraint bids_finite_money_check check (
  amount between 0.01 and 999999999999.99 and amount = round(amount, 2)
);
alter table public.lots add constraint lots_release_result_check check (
  (status <> 'ACTIVE_BIDDING' or (bid_count > 0 and highest_bidder_id is not null))
  and (status <> 'SOLD' or (winning_bid is not null and highest_bidder_id is not null and sold_at is not null))
  and (status <> 'FIRST_BID_WINDOW' or (bid_count = 0 and highest_bidder_id is null))
);

-- Grant only catalogue columns. Bids, queue order, timings, and results are RPC-only.
revoke all on public.lots, public.bids, public.auction_rooms, public.lot_images,
  public.profiles, public.watchlist from anon, authenticated;
grant select on public.lots, public.auction_rooms, public.lot_images to anon, authenticated;
grant select on public.bids to authenticated;
grant select, insert on public.profiles to authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;
grant select, insert, delete on public.watchlist to authenticated;
grant insert (room_id, seller_id, title, description, condition_report, shipping_info,
  estimate_low, estimate_high, starting_bid, minimum_increment) on public.lots to authenticated;
grant update (room_id, title, description, condition_report, shipping_info,
  estimate_low, estimate_high, starting_bid, minimum_increment) on public.lots to authenticated;
grant insert (lot_id, image_url, alt_text, sort_order) on public.lot_images to authenticated;
grant update (image_url, alt_text, sort_order), delete on public.lot_images to authenticated;

drop policy if exists "Anyone can read non-draft lots" on public.lots;
create policy "Anyone can read non-draft lots" on public.lots for select to anon, authenticated
using (seller_id = (select auth.uid()) or (status <> 'DRAFT'
  and exists (select 1 from public.auction_rooms r where r.id = room_id and r.is_active)));
drop policy if exists "Sellers can create their own lots" on public.lots;
create policy "Sellers can create their own lots" on public.lots for insert to authenticated
with check (seller_id = (select auth.uid()) and status = 'DRAFT' and current_bid = 0
  and bid_count = 0 and highest_bidder_id is null and winning_bid is null
  and sold_at is null and unsold_at is null and ends_at is null and queue_position = 0
  and preview_starts_at is null and bidding_starts_at is null and not is_premium
  and exists (select 1 from public.auction_rooms r where r.id = room_id and r.is_active));
drop policy if exists "Sellers can update draft or waiting lots" on public.lots;
create policy "Sellers can update draft or waiting lots" on public.lots for update to authenticated
using (seller_id = (select auth.uid()) and status = 'DRAFT')
with check (seller_id = (select auth.uid()) and status = 'DRAFT');

drop policy if exists "Anyone can read images for visible lots" on public.lot_images;
create policy "Anyone can read images for visible lots" on public.lot_images for select to anon, authenticated
using (exists (select 1 from public.lots l where l.id = lot_id));
create policy "Sellers can add draft images" on public.lot_images for insert to authenticated
with check (exists (select 1 from public.lots l where l.id = lot_id and l.seller_id = (select auth.uid()) and l.status = 'DRAFT'));
create policy "Sellers can edit draft images" on public.lot_images for update to authenticated
using (exists (select 1 from public.lots l where l.id = lot_id and l.seller_id = (select auth.uid()) and l.status = 'DRAFT'))
with check (exists (select 1 from public.lots l where l.id = lot_id and l.seller_id = (select auth.uid()) and l.status = 'DRAFT'));
create policy "Sellers can remove draft images" on public.lot_images for delete to authenticated
using (exists (select 1 from public.lots l where l.id = lot_id and l.seller_id = (select auth.uid()) and l.status = 'DRAFT'));

drop policy if exists "Anyone can read bids for visible lots" on public.bids;
drop policy if exists "Logged-in users can insert bids" on public.bids;
create policy "Users can read their own bids" on public.bids for select to authenticated
using (bidder_id = (select auth.uid()));
alter policy "Users can read their own profile" on public.profiles using (id = (select auth.uid()));
alter policy "Users can create their own profile" on public.profiles with check (id = (select auth.uid()));
alter policy "Users can update their own profile" on public.profiles using (id = (select auth.uid())) with check (id = (select auth.uid()));
alter policy "Users can read their own watchlist" on public.watchlist using (user_id = (select auth.uid()));
alter policy "Users can add their own watchlist items" on public.watchlist with check (user_id = (select auth.uid()));
alter policy "Users can remove their own watchlist items" on public.watchlist using (user_id = (select auth.uid()));

create or replace function public.handle_new_auction_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'display_name', 'Bidder'), 80))
  on conflict (id) do nothing;
  return new;
end;
$$;
create trigger on_auction_user_created after insert on auth.users
for each row execute function public.handle_new_auction_user();
insert into public.profiles (id, display_name)
select id, left(coalesce(raw_user_meta_data ->> 'display_name', 'Bidder'), 80) from auth.users
on conflict (id) do nothing;

create or replace function public.start_next_lot_preview_at(p_room_id uuid, p_transition_at timestamptz)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare selected_lot public.lots%rowtype; result public.lots%rowtype;
  previous_flag text := current_setting('app.auction_lifecycle', true);
begin
  perform 1 from public.auction_rooms where id = p_room_id and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into result from public.lots where room_id = p_room_id
    and status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING') limit 1;
  if found then return result; end if;
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
  return result;
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
    if transitions >= 1000 then return active_lot; end if;
    transitions := transitions + 1;
    if active_lot.ends_at is null then raise exception 'Current lot is missing its database deadline.'; end if;
    if active_lot.ends_at > observed_at then return active_lot; end if;
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
        next_eligible_at = transition_at + interval '7 days', queue_position = next_position,
        highest_bidder_id = null, winning_bid = null where id = active_lot.id returning * into completed_lot;
    else
      update public.lots set status = 'SOLD', ends_at = transition_at, sold_at = transition_at,
        winning_bid = current_bid where id = active_lot.id returning * into completed_lot;
    end if;
    perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
    next_lot := public.start_next_lot_preview_at(p_room_id, transition_at);
    if next_lot.id is null then
      -- A lot may have become eligible between an overdue deadline and this call.
      next_lot := public.start_next_lot_preview_at(p_room_id, observed_at);
      if next_lot.id is null then return completed_lot; end if;
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
  return result;
end;
$$;

create or replace function public.publish_lot(p_lot_id uuid)
returns public.lots language plpgsql security definer set search_path = '' as $$
declare result public.lots%rowtype; room uuid; previous_flag text := current_setting('app.auction_lifecycle', true);
begin
  select room_id into room from public.lots where id = p_lot_id and seller_id = auth.uid();
  if not found then raise exception 'Lot not found.'; end if;
  perform 1 from public.auction_rooms where id = room and is_active for update;
  if not found then raise exception 'Auction room is unavailable.'; end if;
  select * into result from public.lots where id = p_lot_id and seller_id = auth.uid() for update;
  if not found or result.room_id <> room or result.status <> 'DRAFT' then raise exception 'Only your own draft can be published.'; end if;
  if not exists (select 1 from auth.users where id = auth.uid() and email_confirmed_at is not null) then
    raise exception 'Confirm your email before publishing.';
  end if;
  perform set_config('app.auction_lifecycle', 'true', true);
  update public.lots set status = 'WAITING', next_eligible_at = clock_timestamp(),
    queue_position = (select coalesce(max(queue_position), 0) + 1 from public.lots where room_id = room)
    where id = p_lot_id returning * into result;
  perform set_config('app.auction_lifecycle', coalesce(previous_flag, ''), true);
  return result;
end;
$$;

create or replace function public.advance_all_auction_rooms()
returns integer language plpgsql security definer set search_path = '' as $$
declare room uuid; advanced integer := 0;
begin
  for room in select id from public.auction_rooms where is_active order by id loop
    perform public.advance_room_lifecycle(room);
    advanced := advanced + 1;
  end loop;
  return advanced;
end;
$$;

create or replace function public.auction_server_time()
returns timestamptz language sql volatile set search_path = '' as $$
  select clock_timestamp();
$$;

create index if not exists lots_highest_bidder_id_idx on public.lots (highest_bidder_id);
create index if not exists watchlist_lot_id_idx on public.watchlist (lot_id);

revoke execute on function public.handle_new_auction_user(), public.set_lot_updated_at(),
  public.prevent_direct_lot_bid_state_update(), public.prevent_direct_bid_insert(),
  public.start_next_lot_preview_at(uuid, timestamptz), public.start_next_lot_preview(uuid),
  public.advance_lot(uuid), public.advance_all_auction_rooms(), public.publish_lot(uuid),
  public.place_bid(uuid, numeric), public.advance_room_lifecycle(uuid) from public, anon, authenticated;
grant execute on function public.place_bid(uuid, numeric), public.publish_lot(uuid) to authenticated;
grant execute on function public.advance_room_lifecycle(uuid) to anon, authenticated;
grant execute on function public.advance_all_auction_rooms() to service_role;
revoke execute on function public.auction_server_time() from public;
grant execute on function public.auction_server_time() to anon, authenticated;
commit;
