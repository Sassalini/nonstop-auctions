-- PROPOSAL ONLY. Not approved, not applied, and deliberately outside migrations/.
-- Prerequisite: migration 005 verified on the intended project.
-- Coordinate an application change BEFORE applying:
--   remove browser and anonymous server-read calls to advance_room_lifecycle;
--   use scheduled lifecycle processing and read-only catalogue/Realtime updates.
-- Verify the Cron job is active and succeeding, or provide trusted server processing.
-- Otherwise the existing site reports lifecycle permission errors after this change.
-- This changes function permissions only; it does not change lots, bids, or deadlines.
begin;

revoke execute on function
  public.start_next_lot_preview_at(uuid, timestamptz),
  public.start_next_lot_preview(uuid),
  public.advance_lot(uuid),
  public.advance_room_lifecycle(uuid),
  public.advance_all_auction_rooms()
from public, anon, authenticated;

grant execute on function public.advance_room_lifecycle(uuid),
  public.advance_all_auction_rooms() to service_role;

-- Fail rather than silently leave ordinary-user access via role inheritance.
do $$
declare signature text; client_role text;
begin
  foreach signature in array array[
    'public.start_next_lot_preview_at(uuid,timestamptz)',
    'public.start_next_lot_preview(uuid)',
    'public.advance_lot(uuid)',
    'public.advance_room_lifecycle(uuid)',
    'public.advance_all_auction_rooms()'
  ] loop
    foreach client_role in array array['anon', 'authenticated'] loop
      if pg_catalog.has_function_privilege(client_role, signature, 'EXECUTE') then
        raise exception 'Lifecycle access remains for role % on %; inspect inherited privileges.', client_role, signature;
      end if;
    end loop;
  end loop;
end;
$$;

commit;
