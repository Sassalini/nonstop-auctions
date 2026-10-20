# Seller-controlled relisting and listing removal

Implemented locally on 20 October 2026. New migration: `supabase/migrations/012_seller_relisting_and_notification_events.sql` (apply manually after 011). Previous migrations, Cloudflare configuration and the existing performance optimisations were not rewritten.

## Seller experience

- Sell now offers **Number of automatic relistings** (whole numbers 0–100, default 5) and **Keep relisting until sold**. Unlimited mode disables the numeric input.
- The number counts additional attempts: 0 means one initial attempt; 5 permits at most six attempts. There is no reserve-price input or new payment behaviour.
- My Auctions now offers **Manage relistings**, **Stop future relistings**, and **Remove Listing**, with an explicit removal confirmation. Removed listings remain visible in the seller's account as archived records.
- Queued removal is immediate and soft: the original row becomes CANCELLED. Active removal is pending until the current attempt finishes. A valid winning bid still produces SOLD, never cancellation.
- Changes during PREVIEW, FIRST_BID_WINDOW or ACTIVE_BIDDING are stored separately as pending settings. They do not change the current attempt's price, bids, winner or deadline.
- EXPIRED means the listing finished unsold and has no further eligible retry. It is absent from Up Next and the live queue. Sellers can raise its budget or enable unlimited mode to return the same listing to the original room's tail, provided the room is active. Removed/SOLD listings cannot be restarted through these controls.

## Database state and attempt accounting

Added to lots:

| Field | Purpose |
|---|---|
| relist_unlimited | Effective unlimited/finite policy |
| max_auto_relistings | Total finite allowance for additional attempts, 0–100 |
| auto_relistings_used | Retries already scheduled, including a queued retry that has not started |
| completed_attempts | Completed attempts, including the initial attempt |
| final_unsold_at | Final unsuccessful completion time |
| removal_requested_at | Seller's removal request, retained for audit |
| removed_at | Time removal actually took effect; remains NULL if a pending removal instead ends in a valid sale |
| pending_relist_unlimited / pending_max_auto_relistings | Policy to apply when the active attempt completes |

A retry increments auto_relistings_used exactly once when scheduled. Preview does not increment it again. Limits are totals, not fresh allowances on every edit. If a budget change pauses a retry already counted but not started, restoring that same reservation does not consume the budget twice.

On expiry without bids, the database records an UNSOLD attempt in the existing auction_attempts table and increments completed_attempts once. It then chooses one of:

- UNSOLD and queue-tail reentry, if another retry is permitted.
- EXPIRED with final_unsold_at, if the retry budget is exhausted.
- CANCELLED with removed_at/final_unsold_at, if removal was requested.

On expiry with valid bids, it records SOLD and the authoritative final result, even with pending removal or a zero-retry policy. It increments completed_attempts and clears pending settings. Existing bids and attempt records are retained. Removing a queued listing does not fabricate another completed attempt.

The original room and seller remain unchanged; no new lot rows are created for retries. Room-before-lot locks serialize seller actions with bidding and the scheduler. The deterministic queue order remains queue_position, created_at, id. The 30-second preview, 30-second first-bid window and five-second extensions remain unchanged. A lone unsold lot retains the existing 60-second wait before another preview.

## Existing data and compatibility

Existing published WAITING/PREVIEW/FIRST_BID_WINDOW/ACTIVE_BIDDING/UNSOLD listings retain **unlimited** mode, preserving the policy under which they were originally submitted. Sellers can change them to finite limits. New submissions and existing unfinished drafts default to **five** retries.

For existing published listings, counters are initialized from known auction_attempts records. Attempts lost before that historical table existed cannot be reconstructed. Existing SOLD/CANCELLED rows are not updated; their newly added counters stay at defaults and their existing results/attempt history remain authoritative. The controls do not show those counters for historical terminal rows.

Existing lots, photos, accounts, bids, watchlists, winning results, notifications and read/unread states are preserved. The migration seeds event claims without creating retrospective alerts. Previously duplicated notifications remain intact; future duplicates are prevented.

The original five-argument save_seller_draft RPC remains compatible. The new form calls save_seller_draft_with_relisting, which reuses its validation and submission-key idempotency. Retrying after a lost successful submission response cannot reset preferences/counters or create another lot.

## Notification handling

Added a private listing_notification_events ledger with a unique **(lot_id, event_kind)** primary key. FIRST_LIVE, FIRST_BID and SOLD are claimed once per listing, transactionally with the authoritative state change.

- First live means the first opening of FIRST_BID_WINDOW, after preview. The seller and watchers present at that event receive one alert.
- The first accepted bid produces SELLER_FIRST_BID and WATCHED_FIRST_BID. Watcher recipients are selected from the current watchlist. Later bids/retries cannot recreate that event.
- SOLD retains seller sale, buyer win and current-watcher sale notifications.
- Overlapping roles receive one relevant alert per event: a seller watching their own lot receives the seller alert, and a winning watcher receives WON rather than a second WATCHED_SOLD alert.
- Repeated UNSOLD/requeued attempts produce no new unsold alerts and no repeated first-live alerts.

Current Realtime subscriptions are reused. There are no additional channels, polling loops or browser-generated auction outcomes/notifications. The existing notification list/count deduplication remains in place.

## Security and performance

New authenticated, ownership-checked RPCs are save_seller_draft_with_relisting and manage_seller_listing. Management accepts only relisting policy and removal intent; it has no price, deadline, winner, starting-bid or ownership arguments. SOLD and draft listings reject management here; unfinished drafts retain their existing draft workflow.

New policy/counter/removal fields have no direct authenticated UPDATE grants. A trigger also rejects direct changes and ignores forged client lifecycle flags. Existing RLS and public winner-identity restrictions are retained. Event-ledger reads/writes and trigger-function execution are unavailable to anonymous/authenticated clients; notifications retain owner-only read/update policies.

The scheduler uses stored counters and indexed event claims, without counting historical attempts or scanning old notifications on each tick. Full-history backfills run only during migration. A local trigger-based test observes zero lot UPDATEs during repeated recovery of an unchanged live phase. Scoped room/watchlist reads, concurrent account fetching, bounded history/thumbnail queries, request-scoped caching and existing subscription cleanup remain in place. Browser performance guards still verify bounded room reads and no duplicate displayed-lot fetch.

## Scheduler impacts and manual release actions

No cron schedule, service-role grant, scheduler enablement, Cloudflare setting or timer-duration changes are required. Existing advance_all_auction_rooms / advance_room_lifecycle entry points use the new policy logic after migration. Keep the scheduler operating normally after the release.

1. Verify the target project has migrations through 011. Hosted schema inspection and production SQL execution were not performed by this task.
2. Review and manually apply migration 012 in staging first, then in a coordinated production migration window with auction traffic paused/drained. The migration takes schema locks and performs one-time metadata/event backfills; choose an idle auction window rather than interrupting active bidders.
3. Release the matching UI together with the migration. The new UI depends on its fields/RPCs and recognizes EXPIRED and the two new notification kinds.
4. Verify real seller accounts, pending settings/removal, private photo signing and Realtime delivery. Test concurrent scheduler calls and a bid racing with removal/settings on real multi-connection Postgres. Local database tests use PGlite's single connection and cannot reproduce a genuine multi-connection lock race.
5. Confirm existing published listings show Until sold, new listings show five retries, and existing sold history and notification read states remain intact.

No production SQL, commit, push or deployment was performed. No known local test/build blocker remains; staging/production application and real-service verification remain manual.

## Tests and builds

- Lint and TypeScript: passed.
- Automated Node/PostgreSQL tests: 98 passed, including 19 new relisting/management/notification tests.
- Chrome browser tests: 31 passed, including six new seller-flow tests and the existing performance guards, buyer/seller history, watchlist, bidding, Realtime/reconnect and Auto-play regressions.
- Next.js production build: passed.
- OpenNext/Cloudflare production build: passed locally; its existing Windows compatibility warning remains.

New database coverage includes 0 and 5 finite budgets, unlimited mode beyond the default allowance, disabling unlimited mode, changing limits after attempts, reusing a paused retry, queue order and independent rooms, queued removal, removal during all three active phases, accepting a bid after removal was requested, unsold pending removal, a pending zero-retry policy that still allows a sale, exact notification counts/current-watcher membership, overlapping roles, old data/read-state preservation, direct-write/ownership/flag-forgery rejection, draft validation/idempotency and unchanged scheduler calls producing no writes.

Browser coverage includes numeric bounds, disabled unlimited input, persisted 0/5/unlimited submissions, confirmed queued removal, deferred active removal/settings, exhausted-listing reactivation/stop, and mobile (375px)/desktop (1440px) layout checks.

## Files changed
- `SELLER_RELISTING.md`
- `src/components/RelistingControls.tsx`
- `src/components/SellerListingManagement.tsx`
- `supabase/migrations/012_seller_relisting_and_notification_events.sql`
- `tests/browser/seller-relisting.spec.ts`
- `tests/seller-relisting.test.mjs`
- `src/app/my-auctions/page.tsx`
- `src/components/AccountNotifications.tsx`
- `src/components/AuctionDashboard.tsx`
- `src/components/BidForm.tsx`
- `src/components/SellerListingForm.tsx`
- `src/lib/auction-data.ts`
- `src/lib/auction-lifecycle.ts`
- `src/lib/lot-columns.ts`
- `src/lib/seller-validation.ts`
- `src/lib/supabase/types.ts`
- `tests/browser-fixture.mjs`
