# Completed auctions and immediate requeue

## Implementation

- `/won-auctions` lists the signed-in buyer's completed wins; `/my-auctions#sold-auctions` lists the seller's completed sales. Results use existing SOLD lots, winning_bid, highest_bidder_id and sold_at. Images and descriptions remain on the original listing.
- Purchases display auction completion separately from payment, fulfilment and delivery. These three statuses say **not recorded**; no payment or delivery processing has been added.
- Winner confirmation links to Won Auctions. WON notifications open the matching history entry, which links to the completed lot. SELLER_SOLD notifications open the matching sales entry. Existing authoritative notification triggers still generate sale notifications atomically.
- WATCHED_UNSOLD is emitted at most once per watcher/lot across retries. Live notifications retain their per-attempt behavior. Existing notification records are preserved.
- All auction prices use starting_bid before bidding, current_bid during active bidding and winning_bid after sale. Estimates remain compatibility-only data and are not displayed. GBP fractional amounts retain two decimal places.
- Each expired attempt is archived in auction_attempts before the lot is retried. A unique lot/preview timestamp prevents duplicate attempt records. The existing lot row is the only queue entry, so retries do not duplicate listings.
- Unsold lots move to the room queue tail immediately. If no other eligible waiting lot exists, the lot waits **60 seconds from the scheduler observation** before it can start another 30-second preview. Next previews begin from observation time, preventing overdue scheduler calls from replaying an unbounded sequence of retries.
- Database room locks serialize bidding, queue tail allocation and lifecycle transitions. Queue order is queue_position, created_at, id. Existing one-current-lot-per-room uniqueness remains in place. SOLD lots never qualify for retries.
- Public SELECT grants exclude highest_bidder_id. Public lifecycle/bid RPC responses also redact that field; authoritative stored results remain intact. my_completed_auctions exposes participant display names only to the actual buyer or seller. Bid RLS permits sellers to inspect bids on their own completed listings. Participants retain access to completed lots/images even if a room is later disabled.

## New migration and manual Supabase steps

`supabase/migrations/010_completed_auctions_and_immediate_requeue.sql` is forward-only. Earlier migrations were not edited.

1. Verify the target Supabase project has migrations 001 through 009, and take the normal database backup. The hosted schema was not inspected or modified in this task; local tests reconstruct it from repository migrations.
2. During the release window, manually apply migration 010 using the project's normal SQL migration process. It runs in a transaction, backfills available completed attempts, makes existing UNSOLD lots immediately eligible at the queue tail, and preserves all existing SOLD rows, bids, watchlists and notifications. Older lost retries cannot be reconstructed from a single mutable lot row.
3. Release the matching application after migration success: old application versions using `lots.select('*')` are incompatible with the new private-column grants. Do not leave an old application running against the new grants.
4. In staging, verify real buyer/seller accounts, historical SOLD detail pages, notification subscriptions under the narrowed grants, scheduler operation and simultaneous scheduler/bid connections. The local PostgreSQL engine is single-connection, so it cannot demonstrate a genuine multi-connection lock race.
5. Keep the existing scheduler enabled. No Cloudflare configuration changes are required. No migration, deployment, commit or push was executed by this task.

The compatibility column requeue_delay_days retains its old value and constraints; the new lifecycle does not consult it. Do not interpret it as the current requeue policy.

## Validation

- Lint and TypeScript checks passed.
- 75 Node/PostgreSQL tests passed, including purchase ownership and unauthenticated denial, private winner column denial, seller bid access, existing SOLD preservation, immediate queue ordering, retry reset, one-lot cooldown, attempt idempotency and unsold notification deduplication.
- All 23 browser tests passed. Browser coverage includes buyer/seller history at 375px and 1440px, completed detail links, login gating, absent estimates, notification destinations, existing Auto-play behavior, seller submission flows, account isolation and narrow viewport checks.
- Next.js production build and OpenNext Cloudflare bundle passed locally. OpenNext emits its existing Windows compatibility warning.
- Hosted Supabase and actual simultaneous scheduler connections remain staging release checks. There are no production changes from this task.

## Files changed
- `COMPLETED_AUCTIONS.md`
- `src/app/won-auctions/page.tsx`
- `src/components/AuctionWinConfirmation.tsx`
- `src/components/CompletedAuctions.tsx`
- `src/lib/lot-columns.ts`
- `src/lib/lot-price.ts`
- `supabase/migrations/010_completed_auctions_and_immediate_requeue.sql`
- `tests/browser/completed-auctions.spec.ts`
- `tests/completed-auctions.test.mjs`
- `src/app/my-auctions/page.tsx`
- `src/app/sell/page.tsx`
- `src/components/AccountMenu.tsx`
- `src/components/AccountNotifications.tsx`
- `src/components/AuctionRoomCard.tsx`
- `src/components/BidPanel.tsx`
- `src/components/LiveLotPanel.tsx`
- `src/components/UpcomingLotCard.tsx`
- `src/lib/auction-data.ts`
- `src/lib/format.ts`
- `src/lib/mock-data.ts`
- `src/lib/supabase/types.ts`
- `tests/browser-fixture.mjs`
- `tests/browser/auto-play.spec.ts`
- `tests/browser/global.spec.ts`
- `tests/database.test.mjs`
