create extension if not exists "pgcrypto";

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table if not exists public.auction_rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  image_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.lots (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.auction_rooms (id) on delete cascade,
  seller_id uuid not null references public.profiles (id) on delete restrict,
  title text not null,
  description text,
  condition_report text,
  shipping_info text,
  starting_bid numeric not null check (starting_bid >= 0),
  current_bid numeric not null default 0 check (current_bid >= 0),
  minimum_increment numeric not null default 50 check (minimum_increment > 0),
  bid_extension_seconds integer not null default 5 check (bid_extension_seconds > 0),
  preview_duration_seconds integer not null default 30 check (preview_duration_seconds >= 0),
  status text not null default 'DRAFT' check (
    status in ('DRAFT', 'WAITING', 'PREVIEW', 'LIVE', 'EXTENDED', 'SOLD', 'CANCELLED')
  ),
  starts_at timestamptz,
  ends_at timestamptz,
  sold_at timestamptz,
  highest_bidder_id uuid references public.profiles (id) on delete set null,
  winning_bid numeric check (winning_bid is null or winning_bid >= 0),
  is_premium boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lot_images (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots (id) on delete cascade,
  image_url text not null,
  alt_text text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.bids (
  id uuid primary key default gen_random_uuid(),
  lot_id uuid not null references public.lots (id) on delete cascade,
  bidder_id uuid not null references public.profiles (id) on delete restrict,
  amount numeric not null check (amount > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.watchlist (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  lot_id uuid not null references public.lots (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, lot_id)
);

create index if not exists auction_rooms_slug_idx on public.auction_rooms (slug);
create index if not exists auction_rooms_active_idx on public.auction_rooms (is_active);
create index if not exists lots_room_id_idx on public.lots (room_id);
create index if not exists lots_seller_id_idx on public.lots (seller_id);
create index if not exists lots_status_ends_at_idx on public.lots (status, ends_at);
create index if not exists lot_images_lot_id_sort_idx on public.lot_images (lot_id, sort_order);
create index if not exists bids_lot_id_created_at_idx on public.bids (lot_id, created_at desc);
create index if not exists bids_bidder_id_idx on public.bids (bidder_id);
create index if not exists watchlist_user_id_idx on public.watchlist (user_id);

create or replace function public.set_lot_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_lot_updated_at on public.lots;
create trigger set_lot_updated_at
before update on public.lots
for each row
execute function public.set_lot_updated_at();

create or replace function public.prevent_direct_lot_bid_state_update()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.place_bid', true) = 'true' then
    return new;
  end if;

  if new.current_bid is distinct from old.current_bid
    or new.highest_bidder_id is distinct from old.highest_bidder_id
    or new.winning_bid is distinct from old.winning_bid
    or new.sold_at is distinct from old.sold_at
    or new.ends_at is distinct from old.ends_at
  then
    raise exception 'Bid state fields must be changed through a secure server function.';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_direct_lot_bid_state_update on public.lots;
create trigger prevent_direct_lot_bid_state_update
before update on public.lots
for each row
execute function public.prevent_direct_lot_bid_state_update();

create or replace function public.prevent_direct_bid_insert()
returns trigger
language plpgsql
as $$
begin
  if current_setting('app.place_bid', true) = 'true' then
    return new;
  end if;

  raise exception 'Bids must be placed through the secure place_bid function.';
end;
$$;

drop trigger if exists prevent_direct_bid_insert on public.bids;
create trigger prevent_direct_bid_insert
before insert on public.bids
for each row
execute function public.prevent_direct_bid_insert();

alter table public.profiles enable row level security;
alter table public.auction_rooms enable row level security;
alter table public.lots enable row level security;
alter table public.lot_images enable row level security;
alter table public.bids enable row level security;
alter table public.watchlist enable row level security;

drop policy if exists "Users can read their own profile" on public.profiles;
create policy "Users can read their own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "Users can create their own profile" on public.profiles;
create policy "Users can create their own profile"
on public.profiles
for insert
to authenticated
with check (id = auth.uid());

drop policy if exists "Users can update their own profile" on public.profiles;
create policy "Users can update their own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Anyone can read active auction rooms" on public.auction_rooms;
create policy "Anyone can read active auction rooms"
on public.auction_rooms
for select
to anon, authenticated
using (is_active = true);

drop policy if exists "Anyone can read non-draft lots" on public.lots;
create policy "Anyone can read non-draft lots"
on public.lots
for select
to anon, authenticated
using (status <> 'DRAFT');

drop policy if exists "Sellers can create their own lots" on public.lots;
create policy "Sellers can create their own lots"
on public.lots
for insert
to authenticated
with check (
  seller_id = auth.uid()
  and status in ('DRAFT', 'WAITING')
  and current_bid = 0
  and highest_bidder_id is null
  and winning_bid is null
  and sold_at is null
  and ends_at is null
);

drop policy if exists "Sellers can update draft or waiting lots" on public.lots;
create policy "Sellers can update draft or waiting lots"
on public.lots
for update
to authenticated
using (seller_id = auth.uid() and status in ('DRAFT', 'WAITING'))
with check (seller_id = auth.uid() and status in ('DRAFT', 'WAITING'));

drop policy if exists "Anyone can read images for visible lots" on public.lot_images;
create policy "Anyone can read images for visible lots"
on public.lot_images
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.lots
    where lots.id = lot_images.lot_id
      and lots.status <> 'DRAFT'
  )
);

drop policy if exists "Anyone can read bids for visible lots" on public.bids;
create policy "Anyone can read bids for visible lots"
on public.bids
for select
to anon, authenticated
using (
  exists (
    select 1
    from public.lots
    where lots.id = bids.lot_id
      and lots.status <> 'DRAFT'
  )
);

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
      and lots.status in ('LIVE', 'EXTENDED')
      and lots.ends_at is not null
      and now() < lots.ends_at
  )
);

drop policy if exists "Users can read their own watchlist" on public.watchlist;
create policy "Users can read their own watchlist"
on public.watchlist
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can add their own watchlist items" on public.watchlist;
create policy "Users can add their own watchlist items"
on public.watchlist
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can remove their own watchlist items" on public.watchlist;
create policy "Users can remove their own watchlist items"
on public.watchlist
for delete
to authenticated
using (user_id = auth.uid());

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

  if existing_lot.status not in ('LIVE', 'EXTENDED') then
    raise exception 'Lot is not open for bidding.';
  end if;

  if existing_lot.ends_at is null or now() >= existing_lot.ends_at then
    raise exception 'Lot bidding has ended.';
  end if;

  required_bid := existing_lot.current_bid + existing_lot.minimum_increment;

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
    ends_at = existing_lot.ends_at + make_interval(secs => existing_lot.bid_extension_seconds),
    status = 'EXTENDED',
    updated_at = now()
  where id = existing_lot.id
  returning * into updated_lot;

  return updated_lot;
end;
$$;

revoke execute on function public.place_bid(uuid, numeric) from public;
grant execute on function public.place_bid(uuid, numeric) to authenticated;
