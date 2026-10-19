-- Forward-only performance changes after 010. Apply manually with the matching app.
-- No auction results, timings, queue positions, lifecycle functions or existing grants are changed.
begin;

-- auth.uid() becomes an initplan, rather than repeated per visible lot.
alter policy "Participants read completed lots" on public.lots
 using(status='SOLD' and (seller_id=(select auth.uid()) or highest_bidder_id=(select auth.uid())));
-- Public/active rooms never need the historical participant lookup.
alter policy "Participants read historical rooms" on public.auction_rooms
 using(not is_active and public.has_completed_lot_in_room(id));

-- Plans for the bounded history query need participant filtering AND sale ordering.
create index lots_buyer_sold_history_idx on public.lots (highest_bidder_id, sold_at desc, id desc) where status='SOLD';
create index lots_seller_sold_history_idx on public.lots (seller_id, sold_at desc, id desc) where status='SOLD';

-- Bounded, participant-only history plus its single thumbnail. Join profiles/photos
-- AFTER selecting the page. Participant access rules and public winner-column grants
-- are preserved. This definer RPC explicitly authorizes every returned lot.
create function public.completed_auctions_page(
 p_mode text, p_limit integer default 51, p_offset integer default 0, p_lot_id uuid default null
) returns table(lot_id uuid, title text, sale_price numeric, completed_at timestamptz,
 seller_name text, buyer_name text, is_buyer boolean, image_url text, storage_path text)
language plpgsql stable security definer set search_path='' as $$
declare viewer uuid := auth.uid();
begin
 if viewer is null then raise exception 'Authentication required.'; end if;
 if p_mode is null or p_mode not in ('buyer','seller') then raise exception 'Invalid history mode.'; end if;
 if p_limit is null or p_limit < 1 or p_limit > 51 or p_offset is null or p_offset < 0 then
  raise exception 'Invalid history page.';
 end if;
 return query
 with page as materialized (
  select l.id,l.title,l.winning_bid,l.sold_at,l.seller_id,l.highest_bidder_id
  from public.lots l
  where l.status='SOLD'
   and ((p_mode='buyer' and l.highest_bidder_id=viewer) or (p_mode='seller' and l.seller_id=viewer))
   and (p_lot_id is null or l.id=p_lot_id)
  order by l.sold_at desc,l.id desc limit p_limit offset p_offset
 )
 select l.id,l.title,l.winning_bid,l.sold_at,coalesce(s.display_name,'Seller'),coalesce(b.display_name,'Buyer'),l.highest_bidder_id=viewer,
  photo.image_url,photo.storage_path
 from page l
 left join public.profiles s on s.id=l.seller_id
 left join public.profiles b on b.id=l.highest_bidder_id
 left join lateral (select i.image_url,i.storage_path from public.lot_images i where i.lot_id=l.id order by i.sort_order,i.id limit 1) photo on true
 order by l.sold_at desc,l.id desc;
end;
$$;
revoke all on function public.completed_auctions_page(text,integer,integer,uuid) from public,anon;
grant execute on function public.completed_auctions_page(text,integer,integer,uuid) to authenticated;
commit;
