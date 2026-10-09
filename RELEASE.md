# Non-Stop Auctions release preparation

The existing black/gold UI is retained. No payments, payouts, messaging, or shipping automation are included. Seller submissions remain visibly unavailable; this release supports bidder accounts, watching lots, and bidding on an existing catalogue.

## Environment

Use Node.js 24 LTS and `npm ci` with the committed lockfile. Use Linux/WSL for the production build when possible: OpenNext warns that Windows support is incomplete.

| Variable | Where | Required value |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Local `.env.local`; Cloudflare build variables and runtime variables | Supabase project HTTPS URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Same locations | Publishable key or legacy anon key; never a secret/service-role key |
| `AUCTION_DEMO_MODE` | Server environment | `false` in production |
| `NEXTJS_ENV` | Local `.dev.vars` only | `development` for local Worker preview |

`NEXT_PUBLIC_*` values are bundled at build time. Changing only runtime variables cannot repair a client bundle built with missing/wrong keys: rebuild after changing them. The deploy script preserves dashboard variables with `--keep-vars`. Verify variables after a version upload or a dashboard build too.

Missing or partial Supabase configuration fails closed. Explicit `AUCTION_DEMO_MODE=true` displays demonstration data only when both Supabase public variables are absent. A configured connection always wins, including when it returns no rooms/lots or an error. Do not use demo mode for production. `AUCTION_TEST_MODE` is no longer used; auction timings are always 30/30/5 seconds.

No service-role key is required by the website. Cron executes a restricted database function as the database owner. Keep `.env.local`, `.dev.vars`, keys, cookies, and passwords out of Git and logs.

## Database rollout

If migration 005 reports an existing constraint or other duplicate object, stop rather than rerunning it. Use `supabase/operations/check_migration_005.sql` to inspect the actual state, then follow `supabase/operations/MIGRATION_005_RECOVERY.md`. The separate idempotent recovery script preserves production rows and refuses conflicting objects; the original migration remains unchanged.

1. Take a database backup and pause auction traffic/any existing auction scheduler for the migration window. Avoid accepting bids during schema changes.
2. Confirm migrations `001` through `004` have been applied exactly once in order. Do not rerun older migrations: they contain superseded function definitions and migration 003 repairs duplicate active state.
3. Run `supabase/operations/release_preflight.sql` as the database owner. Review invalid amounts/results before proceeding. Existing invalid records make migration 005 fail for manual review; it does not fabricate winners or delete bids.
4. Apply **only** `supabase/migrations/005_release_security_and_lifecycle.sql` to an existing installation. It upgrades test timings to 30/30/5/7, grants catalogue columns explicitly, protects state with RPCs, adds profile creation, and preserves completed results and existing deadlines. It is transactional and intended to run once. Apply while no lot is actively selling, since duration normalization deliberately does not extend a running deadline.
5. On a fresh database apply `001`–`005` in order. `seed.sql` is local test data with known local credentials; **never load it into production**. Seed timings now match production.
6. Re-run the preflight and check Supabase Security/Performance Advisors. Function paths are pinned, authentication expressions in RLS use initplans, and missing foreign-key indexes have been added. Enable leaked-password protection and appropriate password strength/rate limits in Supabase Auth settings; these settings are outside SQL migrations.

Only `place_bid` accepts bids. It requires a verified email, rejects seller self-bids, non-finite values, non-positive amounts and fractional pennies, then locks the room followed by the lot and checks `clock_timestamp()` **after acquiring locks**. A first bid may equal the starting price; later bids must meet the increment. Each valid bid sets a fresh five-second deadline. Client input checks are convenience only.

Seller inserts are drafts. Only catalogue columns can be edited, and only while a draft. `publish_lot` validates ownership, verification and room availability before assigning queue order. Image metadata has draft-owner policies; storage uploads and seller submission UI remain out of this release. Bidder identities/bid histories are restricted to the bidder; the public UI uses `lots.bid_count`.

## Continuous lifecycle scheduling

After migration 005 and deployment verification, enable Supabase Cron and run `supabase/operations/enable_auction_scheduler.sql` as the database owner. It schedules `advance_all_auction_rooms()` **every second** and replaces only this application's existing job when rerun.

The database owns all deadlines and results. Preview lasts 30 seconds with bidding disabled, followed by a 30-second first-bid window. No bid produces UNSOLD, moves the lot to the end of the same room queue and makes it eligible seven days later. A valid first bid starts five-second active bidding. Expiry sells to the recorded highest bidder and immediately starts the next eligible lot's preview. Empty rooms wait for eligibility. Overdue recovery preserves deadline history and commits bounded progress rather than endlessly rolling back a large recovery.

Monitor `cron.job` and `cron.job_run_details`. Pause with `select cron.unschedule('nonstop-auction-lifecycle');`. Prune Cron history as part of database maintenance. If a different scheduler already exists, replace it deliberately: do not add duplicate jobs.

Browser expiry, reconnection and periodic recovery requests are supplementary. SQL checks its own clock before any transition, so an early browser request cannot close an auction. Browser timers display absolute deadlines, sample the database clock, and never write SOLD/UNSOLD themselves.

## Authentication

Set Supabase Auth Site URL to `https://nonstopauction.com` and allow redirect URL `https://nonstopauction.com/auth/callback` (plus the explicit localhost callback for development). Keep email confirmation enabled. Configure production SMTP/delivery and test confirmation mail with a staging account. The existing sign-in screen supports password sign-in and account creation. Email confirmation exchanges a PKCE code through `/auth/callback`; return URLs are restricted to this site. Middleware refreshes cookie sessions; account data uses a verified `getUser()` result and RLS. Personalized responses are not publicly cacheable.

Migration 005 creates profiles for existing and new Auth users. `/my-auctions` requires sign-in and shows the user's own watchlist and highest bid. Public pages never need a service key. Test both a bidder and a separate seller account before release. Password recovery uses the same allowed PKCE callback and a protected `/reset-password` page; verify email delivery, expired links and session revocation in staging. Seller submissions remain out of this release.

## Checks and deployment

```text
npm ci
npm audit --omit=dev
npm run typecheck
npm run lint
npm test
npm run test:browser
npm run build:worker
npm run preview
```

Browser tests use installed Chrome (`channel: chrome`). Install Chrome or change the test channel to an installed Chromium browser. Tests start a separate local HTTP fixture and override Supabase credentials; they do not touch hosted data. PostgreSQL tests run the real migration SQL/functions/triggers/RLS with a minimal Supabase Auth schema in PGlite. The optional repository SQL integration scenario is also executed there. PGlite has one connection: **multi-connection race tests still require a staging PostgreSQL instance**. Supabase Auth, Realtime and pg_cron services are not emulated by it.

The production npm audit is clean after a compatible Next.js 15 update and PostCSS 8 override. The full audit still reports seven findings rooted in `braces` in Tailwind 3/ESLint tooling. Upstream has no compatible patch; npm proposes breaking upgrades. These tools process trusted repository patterns during builds. Do not expose them to uploaded/untrusted glob patterns. Review the finding when a compatible upstream patch is available; no forced Tailwind 4 migration has been applied.

Existing Wrangler/OpenNext configuration remains unchanged. `build:worker` runs the Next.js build and creates `.open-next/worker.js`. `npm run deploy` builds and publishes; `npm run upload` builds and uploads a version. Neither command is part of local release preparation. Keep the custom domain bound to this Worker in Cloudflare.

Local verification on 3 October 2026: TypeScript and lint passed, all 22 automated checks and five browser scenarios passed, and the production dependency audit reported zero vulnerabilities. The Next.js/OpenNext Worker build passed. A local Wrangler runtime smoke check returned HTTP 200 for `/login` and the background image. Browser scenarios cover widths from 320 to 1440 pixels, empty real-data queues, preview restrictions, authentication error handling, password recovery controls, database clock correction, bid countdown resets and lot-image changes. These results do not verify hosted services or deploy the changes.

## Hosted acceptance before public bidding

- Verify production build/runtime variables and callback URLs.
- Apply migration 005, enable the one-second Cron job, and inspect its successful runs.
- Use a staging bidder/seller pair to verify login, confirmation, password reset, sign-out, watchlists and private account isolation.
- Use two browser sessions for simultaneous bids, minimum increments, deadline-edge bids and reconnect recovery. Confirm only one valid winner and one active lot per room in PostgreSQL.
- With all browsers closed, observe preview → first window → UNSOLD → next preview. Verify SOLD and seven-day requeue in staged backdated fixtures, not by editing live results.
- Verify Realtime publication contains `public.lots` and cross-browser bid resets arrive promptly. A disconnected client should recover without changing results.
- Verify `/`, `/rooms/[roomId]`, `/lots/[lotId]`, `/login`, `/my-auctions` and `/sell` at mobile and desktop widths. Empty queues must never show a mock item.
- Check Worker runtime logs and errors on the custom domain after deployment. A local Worker build alone does not prove a hosted release is healthy.

These external acceptance checks, scheduler activation, production migration application and deployment remain explicit release actions.
