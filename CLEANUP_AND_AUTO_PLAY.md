# Test-lot cleanup and Auto-play changes

The pasted request was reviewed and implemented. The black/gold theme, fixed
background, room/sidebar styling, room IDs, Supabase RLS/security rules,
Cloudflare configuration and authoritative auction lifecycle remain unchanged.
No production cleanup, seed, commit, push or deployment was performed.

## Read-only inventory and manual SQL

See `supabase/operations/TEST_LOT_CLEANUP_REPORT.md` for the observed public
catalogue: 60 visible lots, five in each of 12 rooms, all UNSOLD/Returned, with
seed markers and no public bid/winner activity. Private dependencies and seller
Auth identity still require the owner SQL report; no deletion is authorized
from the public snapshot alone.

Manual operation order (no new schema migration is needed):

1. `supabase/operations/test_lot_inventory.sql` — read-only owner report.
2. `supabase/operations/cleanup_reviewed_test_lots.sql` — explicit reviewed UUID
   allowlist and dry run first; change its control row only after review.
3. Repeat the inventory to verify the result and inspect scheduler health.

The cleanup defaults to deleting nothing and fails closed on uncertain identity,
real-account dependencies, any bids/winners, unknown cascade paths, DELETE
triggers/rules, missing IDs or mismatched confirmation/count. Exclusive room/lot/
dependency locks stop the scheduler interfering during the short transaction
without disabling it or changing functions, deadlines or queue positions.
The report/script support both installations with and without notifications.

## Auto-play behavior

- The existing Up Next control is now a keyboard-accessible sliding switch:
  gold/On when enabled, muted grey/Off when disabled. Enter and Space work.
- Preference defaults to On and is stored in localStorage under
  `nonstop-auctions:auto-play`. Refresh/navigation retains it. Separate browsers
  have independent preferences; tabs sharing one browser storage synchronize.
  If storage is unavailable, the current visit still works.
- On follows the selected room's current database lot, including its 30-second
  preview, on homepage, room and individual lot routes. It never follows the
  most-viewed lot from another room. Realtime, reconnect and existing periodic
  lifecycle recovery refresh authoritative data; browser countdowns never decide
  when an auction is sold or unsold.
- Off pins a room/home view to `/lots/<viewed-id>` so updates and refreshes keep
  that lot's result. A pending navigation retains the original pin even if a
  room refresh arrives at the same time. Lot routes remain on their explicitly
  selected lot; manual selection does not re-enable Auto-play.
- Finished lots show their final SOLD/UNSOLD status and the recorded winning bid
  or “No bids.” A “View Current Live Lot” link lets the visitor join the ongoing
  room sequence manually. Switching On rejoins the current lot immediately.
- The requested lot and the room's current lot are separate data fields. This
  prevents viewing a completed lot from losing the current-room destination.
- If no next lot is eligible, Auto-play waits in the same room. Empty rooms show
  “No auctions currently available”; configured Supabase still never falls back
  to mock data. Genuine unsold listings retain their existing seven-day requeue
  and unavailable-until labels; only approved cleanup removes old test rows.
- Toggling has no Supabase write, pause, bid, deadline or scheduler operation.
  Existing lifecycle synchronization keeps running in either viewing mode.

## Validation

Local tests use disposable databases and HTTP/Realtime fixtures; they do not
clean production or verify hosted heartbeat/replication/lock contention.
SQL tests check dry-run and confirmed cleanup, all rooms, dependent rows, account/
room/function/scheduler preservation, genuine bids/winners, edited/real listings,
unknown dependencies, rollback and older schemas without notifications.

The browser suite covers all eight requested scenarios through seven new tests:
automatic advancement/reconnect; Off retaining final results at mobile/desktop
widths; manual next/queued selection; enabling while completed; unsold seven-day
delay; sold/highest-bid result and next preview; refresh preference; independent
visitors. Existing responsive/auth/presence/notification/clock scenarios remain.

Completed local checks:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, zero warnings |
| `npm run typecheck` | Passed |
| `npm test` | 57 passed, zero failures |
| `npm run test:browser` | 16 passed, zero failures |
| Final focused Auto-play rerun | 7 passed after the pending-navigation pin safeguard |
| Final cleanup SQL rerun | 6 passed after identity locks and DELETE-rule checks |
| `npm run build:worker` | Passed, including the Next.js production build and local OpenNext Worker bundle |
| Desktop/mobile visual inspection | Passed |
| `git diff --check` | Passed |

OpenNext emitted its existing Windows compatibility advisory but built
successfully. A test-only image query produces a forward-looking Next 16 warning;
no hosting/configuration change was needed. Existing production lifecycle
tests independently verify actual SQL SOLD/UNSOLD transitions and seven-day delays.
Staging should still verify real Supabase Realtime delivery, two-connection lock
behavior during a manual cleanup dry run, scheduler health and new-account flows.

No new Cloudflare environment variables, Realtime publication or security-policy
changes are needed. Keep the existing Supabase public configuration, Realtime
lots publication and independent auction scheduler. Any prior pending migrations
for watchlists/notifications remain separate from these operation scripts.

## Files changed

Application:

- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/rooms/[roomId]/page.tsx`
- `src/app/lots/[lotId]/page.tsx`
- `src/components/AuctionDashboard.tsx`
- `src/components/UpcomingLotsSidebar.tsx`
- `src/components/BidPanel.tsx`
- `src/components/EmptyAuctionRoom.tsx`
- `src/components/AuctionViewingProvider.tsx` (new)
- `src/components/AutoPlayToggle.tsx` (new)
- `src/lib/auction-data.ts`
- `src/lib/auction-viewing.ts` (new)

Cleanup/report preparation:

- `scripts/build-test-lot-cleanup.mjs` (new, generation only)
- `scripts/read-test-lot-public-inventory.mjs` (new, read-only public queries)
- `supabase/operations/test_lot_inventory.sql` (new)
- `supabase/operations/cleanup_reviewed_test_lots.sql` (new)
- `supabase/operations/TEST_LOT_CLEANUP_REPORT.md` (new)
- `CLEANUP_AND_AUTO_PLAY.md` (new, this report)

Tests:

- `tests/browser-fixture.mjs`
- `tests/browser/global.spec.ts`
- `tests/browser/release.spec.ts`
- `tests/browser/auto-play.spec.ts` (new)
- `tests/auction-viewing.test.mjs` (new)
- `tests/test-lot-cleanup.test.mjs` (new)
