# Global changes — review and rollout

The attached `[Global].txt` was reviewed alongside the more detailed four-stage
request. The fixed background, translucent black/gold panels, navigation layout
and existing auction lifecycle are retained. No production SQL, commit, push,
upload or deployment was performed.

## Implemented behavior

- Stage 1: the fixed background uses `brightness(1.05)`. The original image and
  overlay are unchanged. The homepage selects `general-room` (The Grand Hall),
  regardless of catalogue order, and loads that room's current lot and queue.
  Empty Grand Hall stays empty; there is no Jewellery fallback.
- Stage 2: Supabase Presence on `auction-live-audience` holds only anonymous,
  random session keys and lot IDs. One browser session counts once per lot,
  including multiple tabs/windows viewing the same lot. Different browsers or
  private contexts count separately. A session cookie survives refreshes;
  no account identity, email or permanent viewing total is published or stored.
  Hidden tabs untrack; leaving a lot, closing a connection or reconnecting
  updates presence. Abrupt connection loss expires through Realtime's heartbeat.
- Each displayed lot has separate **viewers** and **watching** badges. Watching
  counts come from real `watchlist` rows through an aggregate-only RPC that
  reveals no watcher identities. Counts refresh immediately after the current
  user's watch action and every 15 seconds for changes by other accounts.
  A dash means unavailable/demo, rather than a fabricated count.
- Desktop and mobile Live links rank database current lots (`PREVIEW`,
  `FIRST_BID_WINDOW`, `ACTIVE_BIDDING`) by distinct session count descending.
  Equal counts, including all zero counts, prefer Grand Hall, then ascending room
  display order, then lexicographically ascending lot UUID. Retired lots are
  excluded regardless of their remaining viewers. Realtime lot/room changes,
  navigation, reconnect and a 15-second poll refresh the read-only candidate list.
  With no candidates, `/live` shows a waiting state and opens a lot when one
  becomes available. The main logo continues to link to `/`.
- Stage 3: the account bell works on desktop and mobile, with an unread badge,
  latest-50 notification panel, individual/all mark-read actions and lot links.
  Signing out/changing accounts clears the previous account's data. Realtime,
  reconnect, panel opening and periodic refresh fetch persisted notifications.
- An AFTER status-transition trigger generates watched-live, watched-sold,
  watched-unsold, seller-live, seller-sold and won notifications. “Live” here
  means bidding opens, after preview. Winner notices go only to the recorded
  highest bidder after authoritative SOLD. No buyer identity is copied into
  watcher/seller notices. Unique user/lot/event/auction-run keys prevent retries
  and repeated scheduler calls from duplicating events, while a later auction
  run of the same unsold lot can notify again. There is no historical backfill.

## Exact manual SQL order

1. Verify the existing installation has migrations `001`–`005` applied. Do not
   rerun them; do not run the old `005` recovery script on a database already
   upgraded with the new notification trigger. Its strict baseline audit
   intentionally rejects unexpected triggers.
2. Apply `supabase/migrations/007_lot_watchlist_counts.sql` once.
3. Apply `supabase/migrations/008_account_notifications.sql` once.
4. Deploy the reviewed application separately, only after approval.

`006` is reserved for the existing **unapproved**, unrelated proposal in
`supabase/proposals/006_restrict_lifecycle_execution.sql`. Do not apply that
proposal as part of this rollout; it changes existing lifecycle permissions.
The new migrations do not rewrite applied migrations or change any existing
bid, winner, deadline, auction duration, queue position, room ID or slug.

If the earlier homepage catalogue update has not yet been applied, separately
review `supabase/operations/update_homepage_room_details.sql` after the local
Technology image has been deployed. That existing operation updates room copy
and image URLs; it is not a new migration in this change.

## Supabase Realtime configuration

- Enable Realtime and allow public Presence channels for the anonymous audience
  topic. No private identities or authentication metadata should be tracked on
  `auction-live-audience`.
- Migration `008` adds `public.notifications` and `public.auction_rooms` to the
  existing `supabase_realtime` publication. `public.lots` remains required from
  migration `004`. If the publication is absent, create/configure it manually
  before testing Realtime. Verify all three tables in Supabase's publication UI
  or with the read-only query below.
- Notification SELECT/UPDATE policies restrict rows to `auth.uid()`. The client
  subscription also filters by its account ID. Only `read_at` is updateable;
  ordinary clients cannot insert/delete notices or call the generation function.
- No watchlist publication is needed; owner-only watchlist policies stay intact.
  Only a scalar count for public, non-draft lots in active rooms is exposed.
- Keep the existing authoritative lifecycle scheduler enabled so notifications
  are generated when lots advance even while users are offline. No new scheduler,
  external notification provider, email or push integration is introduced.

```sql
select schemaname, tablename
from pg_publication_tables
where pubname = 'supabase_realtime'
  and schemaname = 'public'
  and tablename in ('lots', 'auction_rooms', 'notifications')
order by tablename;
```

## Cloudflare environment

No new environment variables or Worker/OpenNext/Wrangler configuration changes.
Continue to provide `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable/anon key) at build and runtime,
with `AUCTION_DEMO_MODE=false` in production. No service-role credential enters
the browser or is needed by these features. Public config is bundled at build
time, so changing runtime values alone does not reconfigure a built client.

## Validation and remaining hosted checks

Local SQL tests execute the actual migrations, trigger, RLS, grants and lifecycle
functions in disposable PGlite databases. They assert no existing lots/bids are
modified during migration, no notification backfill, all six event types,
deduplication, reauction runs, account isolation, read-only aggregate behavior
and publication membership. Existing 004/005 recovery/audit tests explicitly
retain their historical schema baseline; the lifecycle tests also run the full
migration chain.

Browser tests use three independent browser contexts and the installed Supabase
SDK against local HTTP and Realtime-protocol fixtures. They exercise real SDK
join/track/untrack/rejoin and Presence synchronization, refresh/tab deduplication,
departures, reconnects, navigation changes and automatic room advancement.
Two authenticated fixture accounts verify notification isolation, mark-read,
Realtime delivery, missed-event fetch and sign-out cleanup. Existing responsive
tests cover 320, 375, 768, 1024 and 1440 pixels.

Completed local checks:

| Check | Result |
| --- | --- |
| `npm run lint` | Passed, zero warnings |
| `npm run typecheck` | Passed |
| `npm test` | 48 passed, zero failures |
| `npm run test:browser` | 9 passed, zero failures |
| Focused Presence/notifications rerun | 2 passed, including hidden-tab behavior and mobile panel geometry |
| `npm run build:worker` | Passed; includes `next build` and produces `.open-next/worker.js` without deployment |
| Desktop/mobile screenshot inspection | Passed; original styling retained and panel fits narrow viewports |
| `git diff --check` | Passed |

OpenNext emits its existing Windows-compatibility advisory; the Worker build
completed successfully. Next.js emits a forward-looking Next 16 image-pattern
warning for a test-only image query string. Neither warning required changes to
hosting configuration. These local results do not claim hosted Supabase or
Cloudflare acceptance.

- Presence is an anonymous, client-reported audience estimate, not a bot-proof
  attendance metric. It is used only for navigation/display and cannot modify
  auction outcomes. Global Presence fan-out should be load-tested against the
  project's Realtime connection/message limits before a large launch.
- Check production/staging Presence in several actual browsers: same-session
  tabs/windows, separate private sessions, background tabs, reload, network loss
  and reconnect. Confirm unclean disconnects disappear after heartbeat expiry.
- Verify hosted RLS-filtered notification delivery between bidder, watcher and
  seller accounts, then test offline events/reconnect with the real scheduler.
  Local fixtures do not emulate hosted Auth, replication delivery, heartbeat
  expiry, `pg_cron` or multi-connection PostgreSQL lock races.
- Counts and Live navigation update as Realtime events arrive. During an outage,
  Live uses the documented zero-viewer fallback from the latest read-only
  catalogue; catalogue errors show `/live` rather than using a stale candidate.
  As with any live link, a lot can finish between selecting and opening it; its
  lot page then shows the authoritative completed state.
- Notification UI displays the latest 50 persisted notices; unread count covers
  all records and “Mark all read” applies to all unread records for that account.
  No historical event backfill, pagination, email or push notifications are added.

## Files changed

Application:

- `src/app/globals.css`
- `src/app/layout.tsx`
- `src/app/api/live-lots/route.ts` (new)
- `src/app/live/page.tsx` (new)
- `src/components/AppHeader.tsx`
- `src/components/MobileNavigation.tsx`
- `src/components/LiveLotPanel.tsx`
- `src/components/BidPanel.tsx`
- `src/components/WatchLotButton.tsx`
- `src/components/LiveAudienceProvider.tsx` (new)
- `src/components/LiveNavigationLink.tsx` (new)
- `src/components/LiveLotRedirect.tsx` (new)
- `src/components/LotAudience.tsx` (new)
- `src/components/AccountNotifications.tsx` (new)
- `src/lib/auction-data.ts`
- `src/lib/live-viewers.ts` (new)
- `src/lib/mock-data.ts` (removes fabricated watcher totals)
- `src/lib/supabase/types.ts`

Database and documentation:

- `supabase/migrations/007_lot_watchlist_counts.sql` (new)
- `supabase/migrations/008_account_notifications.sql` (new)
- `GLOBAL_CHANGES.md` (new, this report)

Tests:

- `tests/browser-fixture.mjs`
- `tests/helpers/release-database.mjs`
- `tests/helpers/realtime-fixture.ts` (new)
- `tests/browser/global.spec.ts` (new)
- `tests/global-database.test.mjs` (new)
- `tests/live-viewers.test.mjs` (new)

Implementation references:
[Supabase Presence](https://supabase.com/docs/guides/realtime/presence),
[Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes),
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security).
