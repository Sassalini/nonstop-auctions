# Auction room and lot viewing improvements

Implemented against fba26f6. Scope follows the explicit pasted request; More changes.txt supplies the matching UI observations. Theme, fixed background, translucent panels, auction timing, bidding decisions, relisting limits and existing UUID identities are retained.

## Changes

- Room badges occupy a separate opaque footer. The Grand Hall is first in the sidebar only; other room order, database display order and queue positions are unchanged.
- Removed the inert gallery volume button. Added synchronised arrows/thumbnails and full-size, aspect-preserving image viewing with close button, Escape, focus trapping/restoration and image reset per listing.
- Deliberate selections use `?view=manual`, survive refresh/Realtime and temporarily suspend navigation without modifying saved Auto-play. Return to Live Auction resumes live viewing. Explicitly switching Auto-play back on also rejoins. Server bidding eligibility and lifecycle remain independent.
- Removed Condition Report tab; relevant plain-text condition information appears within Description with duplicate/placeholder suppression. Existing database content is retained.
- Added permanent database lot references across lot cards/details, account history, seller management and notifications. Header/mobile reference search uses an exact indexed lookup under the caller's RLS context.
- Renamed Auction Price to Costs. Public requeued lots show ordinary upcoming status; seller records retain their unsold/relisting information.
- Full Catalogue opens without navigation, fetches only the selected room's active queue, pages 24 listings at a time, excludes terminal lots, and supports keyboard/mobile closing and manual item selection. It reuses existing room refreshes while open, with no additional Realtime subscriptions or continuous polling.

## Changed files

Application routes: `src/app/my-auctions/page.tsx`, new `src/app/search/page.tsx`, new `src/app/api/rooms/[roomId]/catalogue/route.ts`, `src/middleware.ts`.

Components: `AccountNotifications`, `AppHeader`, `AuctionDashboard`, `AuctionRoomCard`, `AuctionRoomSidebar`, `AutoPlayToggle`, `BidForm`, `BidPanel`, `CompletedAuctions`, `LotImageGallery`, `LotTabs`, `MobileNavigation`, `UpcomingLotCard`, `UpcomingLotsSidebar`; new `FullCatalogue` and `Modal` (all under `src/components/`).

Data/helpers: `src/lib/auction-data.ts`, `auction-lifecycle.ts`, `auction-viewing.ts`, `completed-auctions.ts`, `lot-columns.ts`, `mock-data.ts`, `supabase/types.ts`; new `lot-description.ts`, `lot-reference.ts`, `room-order.ts`.

Tests: new `tests/lot-viewing-improvements.test.mjs`, new `tests/browser/lot-viewing-improvements.spec.ts`; updated lifecycle, browser fixture, Auto-play and seller-relisting tests.

SQL: new `supabase/migrations/013_permanent_lot_references.sql`. No existing migration was modified.

## SQL review and Supabase actions

Review and apply migration 013 manually after 012 before releasing application changes. Nothing has been executed against production.

The migration adds a bounded bigint sequence, unique lot-reference index, range constraint, immutable-reference trigger and private allocation ledger that survives draft deletion. It backfills references without row UPDATE triggers on existing lots, preserving previous auction fields. Numbers may have gaps and do not indicate queue order. The ledger prevents reusing a previously allocated reference. Notifications receive a reference snapshot; a new bounded history RPC retains the existing participant checks and old RPC compatibility. RLS is not weakened.

Legitimate existing numeric lot_reference values and an owned serial allocator's high-water mark are preserved. Missing, duplicate or invalid pre-existing references abort for manual review. If production used another reference field or external allocator, review that mapping and its deleted-reference high-water mark before applying; this local repository cannot establish that external history. Sequence allocation is concurrency-safe in Postgres; local overlapping creation tests use one PGlite connection, not a hosted multi-connection load test.

## Validation

- ESLint: passed, zero warnings.
- TypeScript: passed.
- Node/database/logic tests: 103 passed.
- Browser regression suite: 38 passed, including gallery/catalogue at mobile and desktop sizes, manual selection and Auto-play, queued bidding restrictions, live transitions, notifications, seller flows and existing bounded-read performance assertions.
- Screenshots inspected at mobile and desktop sizes; automated viewport/clipping checks cover 375, 768 and 1440px gallery layouts and 375/1440px catalogue layouts.
- Next.js production build: passed.
- OpenNext/Cloudflare: standard build stops at the installed Next.js 15.5.27 support-policy gate. Local compatibility packaging passed with `npm run build:worker -- --dangerouslyUseUnsupportedNextVersion`, producing `.open-next/worker.js`. OpenNext also warns about Windows support. The override was used only for local verification; dependency upgrades and deployment configuration were not changed. Resolve the support-policy gate before a normal release.

Performance safeguards: catalogue is fetched only when open, 24 cards plus one pagination sentinel, one signed thumbnail per card. Reference search needs one indexed listing lookup, no gallery signing. Completed history retains bounded paging and adds a primary-key reference lookup per returned row. Existing room/detail request-count and history-pagination regression tests pass. No production latency measurements or improvement claims are made in this UI-polish task.

## Remaining staging checks

After reviewing/applying SQL in staging, verify with real Supabase sessions/storage/Realtime, concurrent independent database connections, and the Cloudflare preview environment. Confirm references across real existing notifications/history and lifecycle transitions. Check Safari/iOS native-dialog behaviour and real photographs. Production credentials, query plans and live deployment were not exercised. No production SQL, cleanup, commit, push or deployment was performed.
