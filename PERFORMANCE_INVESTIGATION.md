# Auction loading performance investigation — 19 October 2026

## Findings and scope

The local investigation confirms unnecessary catalogue/photo work, serial network dependencies, unbounded history loading, and additional RLS cost introduced by migration 010. Targeted changes reduce those costs without changing auction timings, bid authority, immediate requeue rules, the scheduler, Cloudflare configuration, or the black-and-gold layout.

The reported **5–8 second production delay was not measured directly**. Hosted Supabase plans, Cloudflare wall/CPU times, regional round-trip latency and cold starts are unavailable in this session. Local results below demonstrate the bottlenecks and improvements; they are not production speed promises.

Git comparison: current baseline **e330992** versus prior **9b909f4**. The full-catalogue room fetch and duplicate lot fetch predated the history commit. Keeping completed lots increases the work that path performs. Commit e330992 added unbounded history fetching and migration 010's participant policies; the latter produces a measurable SQL regression on the same local dataset. Removing estimate labels is not itself the expensive operation.

### Confirmed causes

1. `getAuctionRooms()` loaded every visible lot, including SOLD/CANCELLED records, then every gallery image and signed URL before a selected-room read could begin. In the fixture, a room response involved 1,824 returned rows including signing responses. The optimized response involves 58. Room navigation now reads current lots only; the selected room retains its bounded, ordered queue.
2. `getLotAuctionData()` read and signed the displayed gallery twice, alongside the all-catalogue room snapshot. It now runs independent reads concurrently and uses the authoritative lifecycle RPC's returned current lot instead of querying it again. A completed transition still triggers a fresh read of the old displayed lot when needed, so final results remain accurate.
3. My Auctions read the whole catalogue just to filter watched IDs. It also fetched SOLD rows for Your Listings only to discard them, then loaded seller history in another stage. Watchlist reads are now ID-scoped, SOLD filtering occurs in Postgres, and independent account/history reads run concurrently.
4. `my_completed_auctions()` fetched both buying and selling history, followed by separate listing/image reads and signing every photograph although the UI displayed one thumbnail. The new participant-only RPC filters the requested mode in SQL and returns at most 51 records (50 visible plus a next-page marker), with one thumbnail per lot. Profile/photo joins occur after page selection. Previous/Next links retain access to every result; notification links can focus an older record directly. The legacy RPC remains for compatibility.
5. Migration 010's historical-room policy evaluated a definer participant check even for ordinary active-room reads. Its lot policy also repeated `auth.uid()` evaluations per row. Migration 011 gates the historical check to inactive rooms and uses statement initplans for participant IDs, with the same visibility rules.
6. Browser mount and subscription callbacks duplicated initial live-catalogue and notification reads. Requests are now coalesced, with a trailing read queued for a real change received during an in-flight read. Existing listeners/channels still clean up; no channel-count leak was observed. Account navigation labels use the SDK's INITIAL_SESSION event rather than another remote user lookup. Private server pages still verify users; database RLS and RPC ownership checks remain authoritative. The anonymous `/api/live-lots` route avoids unrelated session verification and continues to read public IDs through the anonymous client only.

### What was not changed

The scheduler's database transitions, room locking, 30/30/5-second timings, 60-second lone-lot waiting state, immediate queue-tail reentry, notification generation and final result persistence are unchanged. A trigger-based local test observes **zero lot UPDATEs** across five recovery calls on an unchanged preview, and no duplicate attempts. No speculative scheduler rewrite or permanent scheduling workaround was introduced. Cloudflare/OpenNext configuration is unchanged. No persistent cache of private or mutable auction data was added: React cache usage is limited to a single server render.

## Measurements

Evidence: [measurement summary](performance-results/measurement-summary.json), [local PostgreSQL EXPLAIN plans](performance-results/performance-database.json).

### Production-rendered HTTP responses in an isolated local fixture

Next.js `next start`, not the development compiler. Separate fresh before/after processes, same fixtures: 2 rooms, 2 current lots, 12 queued lots, 240 sold lots, 762 gallery photos, 120 purchases and 120 sales for the test account, and one watched lot. Every simulated Supabase API request has a fixed **150 ms delay**. Times include consuming the entire HTML response, without browser JavaScript. The fixture does not model real Postgres CPU; that is measured separately below.

“First” means first visit to that route in the process; only the first homepage visit is also a fresh-process load. Subsequent routes share the running process. “Warm” is the median of three subsequent visits. These are not Cloudflare cold-start measurements.

| Page | First before → after | Warm before → after | API requests before → after | API bytes before → after |
|---|---:|---:|---:|---:|
| Homepage | 1,720 → 905 ms | 1,591 → 789 ms | 10 → 8 | 653,622 → 19,327 |
| Auction room | 1,588 → 787 ms | 1,590 → 787 ms | 10 → 8 | 653,622 → 19,327 |
| Individual lot | 2,287 → 1,106 ms | 2,216 → 1,104 ms | 15 → 12 | 657,079 → 21,943 |
| My Auctions, including Sold Auctions/watchlist | 1,718 → 1,149 ms | 1,648 → 1,114 ms | 14 → 12 | 995,097 → 37,572 |
| Won Auctions | 841 → 653 ms | 837 → 651 ms | 6 → 4 | 270,392 → 34,375 |
| Authenticated room | 1,758 → 949 ms | 1,745 → 947 ms | 11 → 9 | 653,822 → 19,521 |

The two verified server authentication calls on account pages (middleware and page) remain two; they are not bypassed. This fixture deliberately imposes the same latency on auth calls. Production auth latency itself needs a real trace.

### Browser hydration and subscriptions

A separate authenticated Chrome run used the SDK plus a Realtime protocol fixture and two seconds of observation after the main heading appeared. These are single-run observations, not medians. Static images/assets are excluded from browser request counts; server requests caused by refreshes are included in the API totals.

| Route | Heading visible before → after | Browser data requests | Total fixture API requests | `/api/live-lots` calls | Active channels |
|---|---:|---:|---:|---:|---:|
| Room | 1,616 → 924 ms | 20 → 15 | 41 → 29 | 2 → 1 | 3 → 3 |
| Second room | 1,470 → 865 ms | 20 → 15 | 41 → 29 | 2 → 1 | 3 → 3 |
| My Auctions | 1,179 → 850 ms | 12 → 8 | 26 → 19 | 2 → 1 | 2 → 2 |

One WebSocket was active in each observation. Stable channel counts plus disconnect/reconnect/navigation tests did not show a subscription leak or a render loop. The confirmed issue was duplicated reads plus the expensive server work each refresh repeated. Real Supabase reconnect behavior, JWT/RLS delivery and service load still require staging verification.

### PostgreSQL execution and index evidence

Local PGlite/PostgreSQL reconstructed from repository migrations, same 5,000 SOLD lots, authenticated buyer, four executions per query (first reported separately in JSON; warm is median of the remaining three). These millisecond values are local engine measurements, not hosted Supabase timings.

| Query | Migration 009 warm | Migration 010 warm | Migration 011 warm |
|---|---:|---:|---:|
| Active room metadata under RLS | 0.024 ms | 0.199 ms | 0.025 ms |
| Catalogue page under RLS, limit 1,000 | 4.317 ms | 25.128 ms | 3.870 ms |
| Same ordered 51-row buyer history base query, definer context | 2.254 ms | 2.317 ms | 0.084 ms |

The history base plan changes from a **5,000-row sequential scan plus top-N sort** to `lots_buyer_sold_history_idx` reading **51 rows**. This justifies the participant/sale-order indexes, rather than adding indexes speculatively. The old all-history RPC takes 21.164 ms warm at migration 010; the new bounded RPC, including participant names/thumbnail lookup, takes 0.508 ms warm at migration 011. These RPCs intentionally return different amounts of work: all history versus a page, with all records still reachable through pagination. The legacy RPC remains unbounded for compatibility and is not used by the updated UI.

## SQL and release steps — manual only

New forward-only migration: `supabase/migrations/011_auction_read_performance.sql`.

It preserves existing data and participant access, adjusts two policy expressions, adds `completed_auctions_page(...)`, and adds:

- `lots_buyer_sold_history_idx (highest_bidder_id, sold_at DESC, id DESC) WHERE status='SOLD'`
- `lots_seller_sold_history_idx (seller_id, sold_at DESC, id DESC) WHERE status='SOLD'`

No earlier migration was edited. Apply 011 manually after 010, then release the matching app. The new history pages depend on its RPC. Index creation is transactional and should be scheduled for the normal migration window on a large production table; it was not executed against Supabase here.

Before declaring the production incident resolved:

1. Compare initial-document and RSC response TTFB in browser DevTools for anonymous and authenticated users, cold and warm, on the same pages/accounts/catalogue size. Separate image loading from waiting for HTML/data.
2. Inspect Cloudflare request traces for wall time versus CPU time, cold invocations and subrequest latency. No live Cloudflare timing data was available here.
3. Inspect Supabase Query Performance/pg_stat_statements and authenticated, representative EXPLAIN (ANALYZE, BUFFERS) SELECT plans for room, watchlist and history reads. Use actual participant claims in staging when evaluating RLS; an owner-only SQL Editor plan does not measure participant-policy cost.
4. Inspect `/auth/v1/user` duration, Storage signing duration and deployment/database region round trips. The 150 ms fixture delay is a controlled test input, not evidence of actual production latency.
5. Verify real Realtime subscriptions, notifications, reconnects, historical-photo signing, scheduled transitions and concurrent scheduler/bid lock waits. Local database tests use one connection, so actual multi-connection contention is not measured.

## Validation

Passed: lint, TypeScript, 79 automated Node/PostgreSQL tests, all 25 Chrome browser tests, standalone Next.js production builds, and the final OpenNext production build (which also runs Next.js). OpenNext prints its existing Windows compatibility warning.

Coverage includes homepage/room navigation, individual lots, login/account loading, buyer/seller history, pagination and old-record focus, watchlist, private buyer/seller isolation, archived-room access, correct prices, unchanged SOLD records, live bidding, clock correction, reconnect recovery, Auto-play, immediate unsold requeue, lone-lot cooldown, deterministic queue ordering and no updates on unchanged scheduler recovery. New request-count tests guard against reintroducing whole-catalogue reads and duplicate displayed-lot reads. The local lifecycle fixture was corrected to return the actual current lot, matching the real RPC contract that the optimized application now reuses.

No SQL was executed against production. No commit, push or deployment was performed.

## Reproducing measurements

All profiling scripts use localhost fixture URLs and fake accounts. They do not load production credentials themselves.

1. Build the desired code revision with `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54399` and `NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_browser_test` in that build process only.
2. Start `node tests/browser-fixture.mjs` with `PERFORMANCE_NEXT_START=1` and `PERFORMANCE_API_DELAY_MS=150`.
3. Run `node scripts/measure-page-performance.mjs <label>`; it records one first visit plus three warm loads, request timings/counts, bytes and auth calls. The actual configured fixture delay is read from the fixture, not assumed.
4. Separately run `node --no-warnings scripts/measure-browser-performance.mjs <label>` to record hydration and Realtime channel observations. Do not run these alongside page measurements: they share and reset the trace.
5. Run `node scripts/measure-database-performance.mjs supabase/migrations/011_auction_read_performance.sql` for local 009/010/011 comparisons and EXPLAIN plans.
6. Profiling outputs are saved in `performance-results`, outside Playwright's automatically cleared output directory. `measurement-summary.json` preserves rounded observations captured from the before/after runs.
7. Rebuild normally before packaging a real release so the fixture URL cannot enter the deployable bundle. The final OpenNext build in this task used the project's normal environment.

## Files changed

- `PERFORMANCE_INVESTIGATION.md`
- `performance-results/measurement-summary.json`
- `performance-results/performance-database.json`
- `scripts/measure-browser-performance.mjs`
- `scripts/measure-database-performance.mjs`
- `scripts/measure-page-performance.mjs`
- `src/app/my-auctions/page.tsx`
- `src/app/won-auctions/page.tsx`
- `src/components/AccountMenu.tsx`
- `src/components/AccountNotifications.tsx`
- `src/components/AuctionWinConfirmation.tsx`
- `src/components/CompletedAuctions.tsx`
- `src/components/LiveAudienceProvider.tsx`
- `src/lib/auction-data.ts`
- `src/lib/completed-auctions.ts`
- `src/lib/lot-columns.ts`
- `src/lib/supabase/server.ts`
- `src/lib/supabase/types.ts`
- `src/middleware.ts`
- `supabase/migrations/011_auction_read_performance.sql`
- `tests/browser-fixture.mjs`
- `tests/browser/global.spec.ts`
- `tests/browser/read-performance.spec.ts`
- `tests/helpers/realtime-fixture.ts`
- `tests/read-performance.test.mjs`
