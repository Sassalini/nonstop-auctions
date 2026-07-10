alter table public.auction_rooms
add column if not exists display_order integer not null default 0;

alter table public.lots
add column if not exists estimate_low numeric,
add column if not exists estimate_high numeric;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'lots_estimate_range_check'
  ) then
    alter table public.lots
    add constraint lots_estimate_range_check check (
      (estimate_low is null or estimate_low >= 0)
      and (estimate_high is null or estimate_high >= 0)
      and (estimate_low is null or estimate_high is null or estimate_high >= estimate_low)
    );
  end if;
end;
$$;

create index if not exists auction_rooms_display_order_idx
on public.auction_rooms (is_active, display_order);

create index if not exists auction_lots_room_queue_idx
on public.lots (room_id, status, queue_position);

insert into public.auction_rooms (
  id,
  slug,
  name,
  description,
  image_url,
  display_order,
  is_active
)
values
  ('10000000-0000-0000-0000-000000000001', 'jewellery-room', 'The Jewellery Room', 'Live auctions. Exceptional pieces.', 'https://images.unsplash.com/photo-1605100804763-247f67b3557e?auto=format&fit=crop&w=1400&q=85', 1, true),
  ('10000000-0000-0000-0000-000000000002', 'watch-room', 'The Watch Room', 'Timeless craft. Precision performance.', 'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?auto=format&fit=crop&w=1400&q=85', 2, true),
  ('10000000-0000-0000-0000-000000000003', 'art-room', 'The Art Room', 'Iconic works. Enduring value.', 'https://images.unsplash.com/photo-1579783901586-d88db74b4fe4?auto=format&fit=crop&w=1400&q=85', 3, true),
  ('10000000-0000-0000-0000-000000000004', 'collectibles-room', 'The Collectibles Room', 'Rare finds. Real stories.', 'https://images.unsplash.com/photo-1481627834876-b7833e8f5570?auto=format&fit=crop&w=1400&q=85', 4, true),
  ('10000000-0000-0000-0000-000000000005', 'design-room', 'The Design Room', 'Curated design. Modern classics.', 'https://images.unsplash.com/photo-1540574163026-643ea20ade25?auto=format&fit=crop&w=1400&q=85', 5, true),
  ('10000000-0000-0000-0000-000000000006', 'wine-room', 'The Wine Room', 'Fine wines. Memorable moments.', 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=1400&q=85', 6, true),
  ('10000000-0000-0000-0000-000000000007', 'general-room', 'The General Room', 'Distinctive finds for every collection.', 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?auto=format&fit=crop&w=1400&q=85', 7, true),
  ('10000000-0000-0000-0000-000000000008', 'antiques-room', 'The Antiques Room', 'Period craftsmanship. Lasting character.', 'https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1400&q=85', 8, true),
  ('10000000-0000-0000-0000-000000000009', 'library-room', 'The Library Room', 'Rare editions. Scholarly treasures.', 'https://images.unsplash.com/photo-1507842217343-583bb7270b66?auto=format&fit=crop&w=1400&q=85', 9, true),
  ('10000000-0000-0000-0000-000000000010', 'dining-room', 'The Dining Room', 'Elegant service. Memorable tables.', 'https://images.unsplash.com/photo-1617806118233-18e1de247200?auto=format&fit=crop&w=1400&q=85', 10, true),
  ('10000000-0000-0000-0000-000000000011', 'music-room', 'The Music Room', 'Instruments and sound with provenance.', 'https://images.unsplash.com/photo-1511379938547-c1f69419868d?auto=format&fit=crop&w=1400&q=85', 11, true),
  ('10000000-0000-0000-0000-000000000012', 'technology-room', 'The Technology Room', 'Landmark machines. Ingenious design.', 'https://images.unsplash.com/photo-1518770660439-4636190af6d?auto=format&fit=crop&w=1400&q=85', 12, true)
on conflict (slug) do update
set
  description = coalesce(auction_rooms.description, excluded.description),
  image_url = coalesce(auction_rooms.image_url, excluded.image_url),
  display_order = excluded.display_order;

-- Preserve every lot while repairing any pre-existing duplicate active state.
select set_config('app.auction_lifecycle', 'true', true);

with ranked_active_lots as (
  select
    id,
    row_number() over (
      partition by room_id
      order by queue_position asc, created_at asc, id asc
    ) as active_rank
  from public.lots
  where status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING')
)
update public.lots as lots
set
  status = 'WAITING',
  preview_starts_at = null,
  bidding_starts_at = null,
  ends_at = null,
  updated_at = now()
from ranked_active_lots
where lots.id = ranked_active_lots.id
  and ranked_active_lots.active_rank > 1;

create unique index if not exists lots_one_active_per_room_idx
on public.lots (room_id)
where status in ('PREVIEW', 'FIRST_BID_WINDOW', 'ACTIVE_BIDDING');

create or replace function public.start_next_lot_preview(p_room_id uuid)
returns public.lots
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_lot public.lots%rowtype;
  active_lot public.lots%rowtype;
  updated_lot public.lots%rowtype;
  transition_at timestamptz := now();
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

revoke execute on function public.start_next_lot_preview(uuid) from public, anon, authenticated;
revoke execute on function public.advance_lot(uuid) from public, anon, authenticated;
revoke execute on function public.advance_room_lifecycle(uuid) from public;
grant execute on function public.advance_room_lifecycle(uuid) to anon, authenticated;
