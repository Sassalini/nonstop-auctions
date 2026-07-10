-- Local/test seed data. Production schema defaults remain 30s preview, 30s first bid, and 5s bid reset.
-- These deterministic records use 10s preview/first-bid windows so `supabase db reset` is useful for cycle testing.

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  is_super_admin,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '00000000-0000-0000-0000-000000000101',
  'authenticated',
  'authenticated',
  'auction-seed@nonstop.local',
  crypt('local-auction-seed', gen_salt('bf')),
  now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"display_name":"Auction Seed Seller"}'::jsonb,
  false,
  now(),
  now()
)
on conflict (id) do nothing;

insert into public.profiles (id, display_name)
values ('00000000-0000-0000-0000-000000000101', 'Auction Seed Seller')
on conflict (id) do update set display_name = excluded.display_name;

select set_config('app.auction_lifecycle', 'true', true);

with lot_seed (room_slug, lot_index, title, estimate_low, estimate_high, starting_bid) as (
  values
    ('jewellery-room', 1, 'Pear Shaped Diamond Pendant Necklace', 13000, 16000, 12500),
    ('jewellery-room', 2, 'Art Deco Diamond Ring', 4000, 6000, 3600),
    ('jewellery-room', 3, 'Sapphire and Diamond Earrings', 3000, 5000, 2500),
    ('jewellery-room', 4, 'Emerald Cut Diamond Ring', 5000, 7000, 4750),
    ('jewellery-room', 5, 'Diamond Tennis Bracelet', 2000, 3500, 1900),
    ('watch-room', 1, 'Vintage Chronograph Wristwatch', 7000, 9000, 6500),
    ('watch-room', 2, 'Art Deco Gold Dress Watch', 2400, 3600, 2100),
    ('watch-room', 3, 'Stainless Steel Diver''s Wristwatch', 3200, 4800, 2800),
    ('watch-room', 4, 'Victorian Silver Pocket Watch', 900, 1400, 750),
    ('watch-room', 5, 'Watchmaker''s Tool Cabinet', 600, 900, 450),
    ('art-room', 1, 'Abstract Oil on Canvas', 18000, 26000, 16000),
    ('art-room', 2, 'Signed British Landscape', 1800, 2600, 1500),
    ('art-room', 3, 'Limited Edition Screen Print', 900, 1400, 750),
    ('art-room', 4, 'Modernist Bronze Sculpture', 3200, 5000, 2800),
    ('art-room', 5, 'Mid-Century Mixed Media Collage', 1200, 1800, 950),
    ('collectibles-room', 1, 'British Silver Coin Collection', 1200, 1800, 1000),
    ('collectibles-room', 2, 'Vintage Model Car Archive', 700, 1100, 550),
    ('collectibles-room', 3, 'Signed Sporting Memorabilia', 900, 1400, 750),
    ('collectibles-room', 4, 'Victorian Postcard Album', 450, 700, 350),
    ('collectibles-room', 5, 'Staunton Boxwood Chess Set', 600, 900, 475),
    ('design-room', 1, 'Mid-Century Lounge Chair', 2500, 4200, 2200),
    ('design-room', 2, 'Studio Ceramic Table Lamp', 700, 1100, 550),
    ('design-room', 3, 'Danish Teak Sideboard', 1800, 2800, 1500),
    ('design-room', 4, 'Italian Glass Coffee Table', 1200, 1900, 950),
    ('design-room', 5, 'Architect''s Swivel Desk Chair', 900, 1400, 700),
    ('wine-room', 1, 'Twelve-Bottle Bordeaux Case', 1800, 2400, 1600),
    ('wine-room', 2, 'Burgundy Grand Cru Magnum', 1200, 1700, 1000),
    ('wine-room', 3, 'Vintage Champagne Collection', 900, 1300, 750),
    ('wine-room', 4, 'Six-Bottle Vintage Port Lot', 650, 950, 500),
    ('wine-room', 5, 'Single-Estate Tuscan Wine Case', 800, 1200, 650),
    ('general-room', 1, 'Vintage Leather Travel Case', 350, 550, 275),
    ('general-room', 2, 'Decorative Brass Table Lamp', 180, 280, 140),
    ('general-room', 3, 'Framed Countryside Print', 120, 200, 90),
    ('general-room', 4, 'Handmade Ceramic Vase', 150, 240, 110),
    ('general-room', 5, 'Oak Storage Chest', 400, 650, 325),
    ('antiques-room', 1, 'Victorian Mahogany Writing Desk', 1400, 2200, 1200),
    ('antiques-room', 2, 'Edwardian Mantel Clock', 500, 800, 400),
    ('antiques-room', 3, 'Georgian Silver Candlesticks', 1100, 1700, 900),
    ('antiques-room', 4, 'Antique Porcelain Tea Set', 450, 700, 350),
    ('antiques-room', 5, 'Regency Occasional Table', 800, 1200, 650),
    ('library-room', 1, 'First-Edition Historical Novel', 800, 1200, 650),
    ('library-room', 2, 'Leather-Bound Encyclopedia Set', 600, 900, 475),
    ('library-room', 3, 'Victorian Writing Slope', 450, 700, 350),
    ('library-room', 4, 'Antique Terrestrial Globe', 900, 1400, 750),
    ('library-room', 5, 'Walnut Bookcase', 1200, 1800, 1000),
    ('dining-room', 1, 'Silver-Plated Cutlery Service', 700, 1100, 550),
    ('dining-room', 2, 'Crystal Decanter Set', 350, 550, 275),
    ('dining-room', 3, 'Set of Mahogany Dining Chairs', 1200, 1900, 1000),
    ('dining-room', 4, 'Porcelain Dinner Service', 500, 800, 400),
    ('dining-room', 5, 'Antique Serving Trolley', 650, 950, 500),
    ('music-room', 1, 'Vintage Acoustic Guitar', 900, 1400, 750),
    ('music-room', 2, 'Upright Piano Stool', 250, 400, 190),
    ('music-room', 3, 'Brass Gramophone', 600, 900, 475),
    ('music-room', 4, 'Curated Vinyl Record Collection', 500, 800, 400),
    ('music-room', 5, 'Antique Violin and Case', 1200, 1800, 1000),
    ('technology-room', 1, 'Vintage Apple Computer', 1800, 2800, 1500),
    ('technology-room', 2, 'Retro Games Console Bundle', 600, 900, 475),
    ('technology-room', 3, 'Mechanical Keyboard Collection', 350, 550, 275),
    ('technology-room', 4, 'Classic 35mm Film Camera', 700, 1100, 550),
    ('technology-room', 5, 'Restored Valve Radio', 450, 700, 350)
), resolved_lots as (
  select
    ('20000000-0000-0000-0000-' || lpad(((rooms.display_order * 100) + seed.lot_index)::text, 12, '0'))::uuid as id,
    rooms.id as room_id,
    seed.lot_index,
    seed.title,
    seed.estimate_low,
    seed.estimate_high,
    seed.starting_bid
  from lot_seed as seed
  join public.auction_rooms as rooms on rooms.slug = seed.room_slug
)
insert into public.lots (
  id,
  room_id,
  seller_id,
  title,
  description,
  condition_report,
  shipping_info,
  estimate_low,
  estimate_high,
  starting_bid,
  current_bid,
  minimum_increment,
  bid_extension_seconds,
  preview_duration_seconds,
  first_bid_duration_seconds,
  requeue_delay_days,
  status,
  preview_starts_at,
  ends_at,
  unsold_at,
  next_eligible_at,
  queue_position
)
select
  id,
  room_id,
  '00000000-0000-0000-0000-000000000101',
  title,
  format('%s is a carefully catalogued example selected to test this room''s complete auction sequence.', title),
  'Good auction condition with age-related wear noted in the catalogue photographs.',
  'Insured UK delivery or collection by appointment. International quotes are available on request.',
  estimate_low,
  estimate_high,
  starting_bid,
  starting_bid,
  case when starting_bid >= 5000 then 250 when starting_bid >= 1000 then 100 else 50 end,
  5,
  10,
  10,
  7,
  case when lot_index = 1 then 'PREVIEW' when lot_index = 5 then 'UNSOLD' else 'WAITING' end,
  case when lot_index = 1 then now() else null end,
  case when lot_index = 1 then now() + interval '10 seconds' else null end,
  case when lot_index = 5 then now() else null end,
  case when lot_index = 5 then now() + interval '7 days' else now() end,
  lot_index
from resolved_lots
on conflict (id) do nothing;

insert into public.lot_images (id, lot_id, image_url, alt_text, sort_order)
select
  ('30000000-0000-0000-0000-' || lpad(((rooms.display_order * 100) + lots.queue_position)::text, 12, '0'))::uuid,
  lots.id,
  rooms.image_url,
  lots.title,
  0
from public.lots as lots
join public.auction_rooms as rooms on rooms.id = lots.room_id
where lots.id::text like '20000000-0000-0000-0000-%'
on conflict (id) do update
set
  image_url = excluded.image_url,
  alt_text = excluded.alt_text;
