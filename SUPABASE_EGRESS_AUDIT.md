# Supabase egress audit

## Scope and confidence

Baseline: Git commit 9a39967 (lot changes). Local Supabase HTTP/Postgres and Realtime protocol fixtures only; no hosted credentials or production data were used. No production configuration, migration, cleanup, commit, push or deployment was performed. There is no connected Supabase/Cloudflare metrics tool in this session. The reported 7.87 GB is user-supplied and cannot be attributed to features from local measurements alone.

## Confirmed sources

1. AuctionLiveSync invoked a full-row lifecycle RPC and refreshed the server page every 15 seconds while visible, even if nothing changed. That render read room cards, the current lot/queue and image metadata, and regenerated signed photo URLs. The server render itself also invokes lifecycle recovery, so one browser recovery could produce two lifecycle responses. Bids caused further page refreshes. These are Supabase-to-Worker reads as well as browser requests, so the browser Network panel alone understates database egress.
2. The global audience provider already received all lot Postgres changes for cross-room Live navigation. A second room-filtered subscription received overlapping rows for the displayed room. The global provider also fetched candidate membership on every bid/lot update even when membership had not changed. One browser client/WebSocket is reused; no runaway socket creation/render loop was confirmed.
3. Notification lists (up to 50 complete rows) plus unread counts were fetched every 15 seconds even with the bell closed. Watch counts also polled every 15 seconds. Auth is not polled every second, but each server refresh invokes verified middleware authentication for signed-in visitors.
4. `next.config.ts` sets `images.unoptimized: true`. CSS/Next Image `sizes` does not resize these files. Gallery thumbnails, room/sidebar cards, catalogue and history photographs use original objects. Up to ten photos of up to 5 MiB each are accepted. Every fresh signed token creates a different URL; the previous implementation replaced mounted image URLs after server refreshes. These are confirmed transfer risks, but actual hosted image sizes/cache hit rates have not been collected.
5. Active seller listings and watchlist rows on My Auctions remain unpaginated and can grow for a high-volume account; their actual production sizes need checking. This was not capped silently, which would hide existing functionality. Listing-card queries included description/condition/shipping paragraphs despite not displaying them. Room/queue/watchlist image resolution signed all photographs even where only one card image was used. Histories already page 50 records, catalogue 24 plus a sentinel; whole completed catalogues are not fetched by ordinary room reads.
6. CountdownTimer updates its local display every 250 ms; it makes no network requests. Clock correction is a small RPC every 30 seconds. Current scheduler SQL returns before UPDATE when a deadline is still in the future. The new current-schema no-op test records zero UPDATEs after ten recovery calls. Real transitions/relistings/bids legitimately write and broadcast. Internal Postgres Cron activity is not itself client egress; an external scheduler returning full rows would need separate verification.

Recent Git comparison: AuctionLiveSync and LiveAudienceProvider polling/feed structure is unchanged from 38d8433 (Lot Performance) through 9a39967. Seller notifications added event kinds, while the gallery work made multiple images visible. This evidence does not establish that relisting itself caused 7.87 GB. Existing no-op safeguards are retained rather than modifying authoritative auction SQL.

## Optimisations

- Share the existing global feed with the selected room through a local browser event; remove the duplicate Postgres subscription. Keep global presence and cross-room Live selection. Only membership changes/unknown events refresh the candidate list; price/bid changes still refresh the relevant room immediately. Missing event identity/status triggers reconciliation.
- Healthy, visible room recovery and live-candidate fallback run every 60 seconds, rather than 15. Disconnected room fallback stays at 15 seconds. Deadline recovery, reconnect, online and visibility recovery remain immediate. Hidden-tab events no longer trigger page/candidate reads; visibility recovery reconciles them. The authoritative scheduler and all auction phase durations remain unchanged.
- Watch count and notification fallback checks run every 60 seconds. Local watch actions, notification Realtime events, reconnect and opening the bell still refresh immediately. Only the unread-count HEAD request runs with the notification list closed; the list uses explicit columns when opened.
- Retain valid one-hour signed URLs for at most 50 minutes within each mounted image. Stable thumbnail keys preserve that cache across RSC refreshes. Replaced paths, expiry and a newer token after an image error are handled. There is no cross-user/global signed URL cache, public bucket conversion or cached auction outcome.
- Sign only one photograph for queue/sidebar/watchlist cards; sign all photographs only for the lot actually displayed. Use card projections without rich descriptions. Full gallery/original photographs remain available.
- Disable speculative link prefetching for room/account/history links, avoiding server reads for destinations a visitor has not opened. This can trade speculative navigation speed for lower data usage; actual navigation remains unchanged.
- Hidden tabs no longer run the 30-second clock RPC. Visible clock synchronisation remains unchanged.

## Measurement method and results

`tests/browser/egress-audit.spec.ts` records fixture-generated response JSON bytes and request counts for the same account login, room visit, idle window, five separated lot events and account navigation. It measures active joined channels and protocol-frame bytes with the installed Supabase SDK. Results are saved under `audit-results/`. Baseline source is temporarily read from Git and all local edits restored afterward; no Git checkout/commit changes are made.

The initial phase includes the login redirect and room navigation settling; it is not a production cold-load latency measurement. JSON bytes exclude headers/TLS/compression; fixture HEAD responses record generated `null` bytes even though no body is sent. Actual binary image bodies are counted separately. Fixture Realtime uses synthetic records; it cannot establish production full-row or incremental presence payload sizes. Persistent global presence/notification channels after leaving a room are intentional, not a leak.

Matched 65-second run (includes the 60-second fallback):

| Measurement | Before | After |
|---|---:|---:|
| Initial login/room settling requests | 50 | 44 |
| Initial generated JSON bytes | 14,462 | 12,417 |
| Idle Supabase requests / 65 seconds | 54 | 15 |
| Idle generated JSON bytes / 65 seconds | 20,732 | 4,843 |
| Five separated lot events: requests | 45 | 35 |
| Five separated lot events: JSON bytes | 19,575 | 16,920 |
| Joined channels on signed-in room | 3 | 2 |
| Joined channels on account page | 2 | 2 |

Idle request count fell 72.2%; generated JSON bytes fell 76.6%. Bid-event reads fell 22.2% and generated JSON bytes 13.6%. These are fixture results, not a measured reduction in the hosted billing total. Refreshes on actual bids remain intentionally immediate. Initial counts may include login-route settling, and the link-prefetch change particularly needs a production-build browser check because development prefetch behaviour differs.

Idle generated-body byte breakdown, useful for feature attribution in this fixture:

| Feature | Before / 65s | After / 65s |
|---|---:|---:|
| Full lifecycle RPC responses | 7,496 | 1,874 |
| Lot query responses | 4,872 | 958 |
| Photo metadata | 3,312 | 828 |
| Room metadata | 2,952 | 738 |
| Notifications (closed bell) | 1,268 | 4 (HEAD; real body 0) |
| Verified Auth requests | 776 | 388 |
| Clock correction | 52 | 52 |
| Watch count | 4 | 1 |

Before there were eight lifecycle RPCs and eight notification queries per 65 seconds; after there were two lifecycle RPCs and one notification count HEAD request. The clock is not the dominant JSON source. The earlier 32-second comparison was 27 requests / 10,366 generated JSON bytes before versus 1 / 26 after. This window ends before the 60-second fallback, so it must not be extrapolated as a steady-state 99.7% egress reduction. The 65-second results above include the new fallback interval.

The controlled image test rotates the signed token of the same mounted 2,891,942-byte fixture PNG and triggers a server refresh. It measures repeated object transfer only, not initial image savings or production file sizes. Before: one repeat GET, 2,891,942 bytes. After: zero repeat GETs, zero bytes. Initial photo loading is unchanged. This models a token changing between server renders; it does not assume tokens rotate on every real RPC or claim a 2.89 MB saving on every bid.

## Remaining image limitation

This change reduces repeated downloads but does not generate resized thumbnails/display derivatives. A first visit can still download full originals for gallery thumbnails/cards; navigation/remount or token expiry can download them again. Supabase transformations/Smart CDN availability must not be assumed on the Free plan. No paid dependency was added. A follow-up image pipeline should generate and register small card and medium display WebP/AVIF objects, retain originals for explicit full-size viewing, preserve private draft access, and remove all variants on draft discard. Existing objects need a reviewed, idempotent backfill rather than an automatic production rewrite. Do not make the bucket public or weaken storage RLS to improve cache hits.

The global lots feed still carries full Postgres change rows because the Live link considers all active rooms. Removing the duplicate subscription helps, but it is not a narrow-column feed. If Realtime dominates production egress, measure full payload/fan-out and consider an RLS-protected compact Broadcast design as a separate reviewed change. Global presence also fans out to active clients; its staging behaviour and viewer-minute cost need measuring.

## Production information to collect

Use the same billing dates and project filter for every export. Do not send credentials, auth headers, cookies or signed tokens.

1. Organization Usage: choose this exact project and billing period; export daily total/uncached/cached egress and hover service breakdown (Storage, Database/PostgREST, Auth, Realtime, Edge Functions, Shared Pooler, Log Drains). Check other projects/preview branches included in the organization total. Capture whether 7.87 GB is uncached or total.
2. Observability/Logs Explorer: API Gateway/edge_logs request counts grouped by request path/method/status, daily and for a quiet 30-minute window. Include /rest/v1/lots, lot_images, auction_rooms, notifications, lifecycle/time/watch-count RPCs, /auth/v1/user and /storage/v1/object/sign paths. API logs do not provide reliable response byte totals; do not infer bytes from request count alone.
3. Storage: top requested object paths, GET counts and cf_cache_status HIT/MISS/BYPASS split. Collect object metadata `size`, Content-Length, Cache-Control, actual image dimensions and type for the largest/top-requested 20 objects. Do not download every production image just to audit it. Estimate each object's egress as object bytes times uncached GETs, then reconcile with the service graph.
4. Product Reports > Realtime: connected clients, Postgres Changes, Presence, Broadcast counts and reconnect/join activity over the same quiet/busy intervals. Dashboard Realtime egress is aggregate, not a per-topic byte breakdown. Record a sanitised browser WebSocket frame sample for 60 seconds idle and 60 seconds bidding to measure frame lengths and topics; compare one versus multiple tabs.
5. Advisors > Query Performance: calls, returned rows and average times for the endpoints above. Collect two snapshots 10 minutes apart so calls/rows can be differenced; do not reset statistics. Check deployed Cron jobs for duplicate schedules and external worker schedulers, execution frequency and response payload size. Avoid disabling the scheduler.
6. Browser DevTools: fresh-profile cold load and warm repeat load, one room for 5 minutes, switching rooms, opening catalogue/gallery/fullscreen, bell closed/open and signed-in/out. Record request URL path without token, transferred/resource bytes, cache source and initiator; include visibility/navigation timestamps. Sanitise HARs before sharing.
7. Cloudflare: Worker request counts, CPU/wall time, cache status and subrequest counts for these same paths/time ranges. Supabase-to-Worker responses count even if the browser receives a smaller RSC response. Do not enable public caching of private responses or auction outcomes.

Manual configuration changes required: none for these code fixes. No new SQL migration/index. Verify actual Storage cache headers and duplicate schedulers before proposing any production setting change.

## Free plan suitability

The Free plan is potentially adequate for a small controlled test, not a guaranteed fit for an image-heavy live auction site. Budget the stated 5 GB uncached separately from cached allowance. For illustration, reserving 1 GB for database/auth/Realtime leaves 4 GB: about 800 visits at 5 MB uncached photos per visit, or 200 at 20 MB. These are arithmetic scenarios, not forecasts. Long-lived tabs, repeated originals and multiple simultaneous viewers can exhaust the allowance with little public traffic. Use measured daily uncached GB, visits and viewer-minutes to forecast; test the remaining original-image risk before relying on Free for launch. A paid plan is not required by this implementation, but the current architecture cannot promise to stay within 5 GB without hosted measurements and image optimisation.

## Validation and files

ESLint and TypeScript passed. All 104 Node/database tests passed, including the current-schema no-op scheduler check. All 40 browser tests passed (with the missing-event reconciliation fix), covering room navigation, bidding display/reset, expiration and Auto-play transitions, relisting management, history pagination, notifications, viewer sessions/reconnect, uploads/gallery, watchlists and mobile/desktop navigation. Database tests cover concurrent bidding and winner decisions. Next.js production build passed. The standard OpenNext command stops at its existing Next.js 15.5.27 support-policy gate. Local Worker packaging passed with `npm run build:worker -- --dangerouslyUseUnsupportedNextVersion`, producing `.open-next/worker.js`; OpenNext also warns about Windows support. Resolve the normal release gate separately before deployment. The additional active-lot gallery regression passed at 375, 768 and 1440px. Production tests are not claimed. Unit/database tests use local PGlite; browser tests use local HTTP/Realtime fixtures.

Application files:
- `src/components/AuctionLiveSync.tsx`, `LiveAudienceProvider.tsx`: shared feed and recovery scheduling.
- `AccountNotifications.tsx`, `LotAudience.tsx`, `AuctionClockProvider.tsx`: bounded background reads.
- New `src/components/LotPhoto.tsx`; `LotImageGallery.tsx`, `AuctionRoomCard.tsx`, `UpcomingLotCard.tsx`, `CompletedAuctions.tsx`: mounted photo URL reuse.
- `src/lib/auction-data.ts`, `src/lib/lot-columns.ts`: card projections, one-photo card signing, reuse of the already-resolved detail gallery.
- `src/components/AppHeader.tsx`, `AccountMenu.tsx`, `MobileNavigation.tsx`, `AuctionRoomCard.tsx`, `CompletedAuctions.tsx`, `src/app/my-auctions/page.tsx`: selective prefetch disabled.

Tests/evidence:
- `tests/browser/egress-audit.spec.ts`, `tests/helpers/realtime-fixture.ts`, `tests/browser-fixture.mjs`: repeatable counts, JSON/binary bytes, joined channels and signed-token rotation.
- `tests/egress.test.mjs`: no-op scheduler proof on schema through migration 013.
- `tests/browser/lot-viewing-improvements.spec.ts`: full gallery remains available on an active lot detail route.
- `audit-results/*.json`: sanitised local before/after measurements.
- This report. No dependency/configuration or migration changes.

Sources: [Egress accounting and investigation](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [Storage bandwidth and object-request query](https://supabase.com/docs/guides/storage/serving/bandwidth), [Realtime egress accounting](https://supabase.com/kb/troubleshooting/realtime-egress-faq), [Realtime reports](https://supabase.com/docs/guides/realtime/reports), [Signed URL cache keys](https://supabase.com/docs/guides/storage/cdn/smart-cdn).
