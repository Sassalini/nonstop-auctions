-- Read-only checks. Run as database owner before/after migration 005.
select status, count(*) from public.lots group by status order by status;
select preview_duration_seconds, first_bid_duration_seconds, bid_extension_seconds,
  requeue_delay_days, count(*) from public.lots group by 1,2,3,4;

select id, status from public.lots where
  not (starting_bid between 0 and 999999999999.99 and starting_bid = round(starting_bid, 2))
  or not (current_bid between 0 and 999999999999.99 and current_bid = round(current_bid, 2))
  or not (minimum_increment between 0.01 and 999999999999.99 and minimum_increment = round(minimum_increment, 2))
  or (winning_bid is not null and not (winning_bid between 0.01 and 999999999999.99 and winning_bid = round(winning_bid, 2)))
  or (estimate_low is not null and not (estimate_low between 0 and 999999999999.99 and estimate_low = round(estimate_low, 2)))
  or (estimate_high is not null and not (estimate_high between 0 and 999999999999.99 and estimate_high = round(estimate_high, 2)))
  or (status = 'ACTIVE_BIDDING' and (bid_count = 0 or highest_bidder_id is null))
  or (status = 'SOLD' and (winning_bid is null or highest_bidder_id is null or sold_at is null))
  or (status = 'FIRST_BID_WINDOW' and (bid_count <> 0 or highest_bidder_id is not null))
  or (status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING') and ends_at is null);
select id from public.bids where not (amount between 0.01 and 999999999999.99 and amount = round(amount, 2));
select room_id, count(*) from public.lots where status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING') group by room_id having count(*) > 1;

select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace
  and proname in ('place_bid','advance_room_lifecycle','start_next_lot_preview_at',
    'start_next_lot_preview','advance_lot','advance_all_auction_rooms','publish_lot',
    'set_lot_updated_at','prevent_direct_lot_bid_state_update','prevent_direct_bid_insert','handle_new_auction_user');
select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' order by tablename, policyname;
select * from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lots';
