-- Manual catalogue update: review and run in the Supabase SQL Editor after
-- deploying the app containing public/images/technology-room.jpg.
-- This is an operation script, not a schema migration; it is not run automatically.
-- Live room cards read name, description and image_url from public.auction_rooms.
-- Demo rooms are maintained separately in src/lib/mock-data.ts.
-- Only display fields change. IDs, slugs (including general-room), room order,
-- active flags, lots, foreign keys and auction lifecycle state remain untouched.
-- Technology source: the previous Unsplash photo ID ended in 4636190af6d (404).
-- The local asset uses photo-1518770660439-4636190af475.

begin;

-- Fail before making changes if any expected room is missing.
do $$
begin
  if (select count(*) from public.auction_rooms where slug in (
    'jewellery-room', 'design-room', 'general-room', 'dining-room',
    'music-room', 'technology-room'
  )) <> 6 then
    raise exception 'Expected all six homepage rooms; check the catalogue before applying this update.';
  end if;
end;
$$;

update public.auction_rooms as room
set description = changes.description
from (values
  ('jewellery-room', 'The Finest in Jewellery.'),
  ('design-room', 'Timeless Generational Homeware.'),
  ('general-room', 'For the more special and unique spectacles.'),
  ('dining-room', 'The finest of cookware and crockery.'),
  ('music-room', 'Instruments with provenance.')
) as changes(slug, description)
where room.slug = changes.slug;

update public.auction_rooms
set name = 'The Grand Hall'
where slug = 'general-room';

update public.auction_rooms
set image_url = '/images/technology-room.jpg'
where slug = 'technology-room';

-- Review the updated catalogue values in the SQL Editor results.
select id, slug, name, description, image_url
from public.auction_rooms
where slug in (
  'jewellery-room', 'design-room', 'general-room', 'dining-room',
  'music-room', 'technology-room'
)
order by display_order;

commit;
