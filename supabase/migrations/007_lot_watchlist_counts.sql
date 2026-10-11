-- 006 is reserved for the separate, unapproved lifecycle-permissions proposal.
-- This read-only aggregate reveals no watcher identities and changes no lot state.
begin;

create function public.lot_watchlist_count(p_lot_id uuid)
returns bigint language sql stable security definer set search_path = '' as $$
  select count(*) from public.watchlist w
  where w.lot_id = p_lot_id and exists (
    select 1 from public.lots l join public.auction_rooms r on r.id = l.room_id
    where l.id = p_lot_id and l.status <> 'DRAFT' and r.is_active
  );
$$;

revoke all on function public.lot_watchlist_count(uuid) from public, anon, authenticated;
grant execute on function public.lot_watchlist_count(uuid) to anon, authenticated;
commit;
