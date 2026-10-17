# Seller submissions — review and manual setup

## Assessment and scope

The pasted request overrides the attachment's reserve dropdown/amount proposal. The MVP has no reserve fields or reserve validation. The existing schema and authoritative bidding/sale functions contain no reserve columns or reserve conditions. No historical columns or data are removed.

Migration 005 already provides seller-owned drafts, verified-email publishing into WAITING, room locking and queue allocation. There is no separate moderator approval state/workflow. New submissions therefore use DRAFT while photographs upload, then the existing `publish_lot` transition into WAITING. Submission does not start preview, advance a room or change an existing deadline. The scheduler/recovery functions continue to control 30-second preview, 30-second first-bid window, five-second bid resets, sale to highest bidder and seven-day same-room unsold requeue.

The page retains its black/gold panels, fixed background and responsive form/sidebar arrangement. All requested copy is applied, every active room is loaded from Supabase, and the only input fields are title, room, starting bid, description and photographs. My Auctions now includes the user's seller listings and unfinished submissions. A minimum-width fix to the existing header search container prevents horizontal overflow for authenticated tablet users.

## Migration application order

Nothing has been executed against hosted Supabase. Review and test on a separate staging project before applying manually.

1. Confirm the existing migration baseline: 001, 002, 003, 004 and 005, followed by 007 and 008. Do not rerun applied migrations. The repository intentionally reserves 006 for a separate, unapproved lifecycle-permissions proposal; this feature does not apply that proposal.
2. Apply **009_seller_submissions.sql** once, using an owner account capable of creating Storage policies. It is transactional and additive. It creates two nullable columns/indexes (`lots.submission_key`, `lot_images.storage_path`), the private photo bucket, policies, validated seller RPCs and guards. It revokes direct browser INSERT column grants on lots; new listings must use `save_seller_draft`. Existing own-draft catalogue edit permissions remain subject to RLS and final submission checks.
3. Only after review and migration application, release the corresponding application code through the normal release process. No deployment has been performed.

If a bucket already exists with the name `lot-photos`, the migration deliberately fails rather than changing an existing bucket's privacy/settings silently. Review that bucket and its contents before resolving the name conflict. Do not change it to public to work around an error.

## Storage configuration

009 creates `lot-photos` as **private**, with a 5 MiB per-file limit and allowed MIME types `image/jpeg`, `image/png`, `image/webp`. Ensure the project's global Storage upload limit is at least 5 MiB. No public bucket, service-role browser key or extra environment variable is required. The existing public Supabase URL and anon/publishable key are used with the signed-in user's session.

Write permissions require an exact photo reference registered to the user's own DRAFT. There is no overwrite policy. Restrictive policies isolate this bucket even in the presence of older broad Storage policies, without restricting unrelated buckets. Another seller and anonymous visitors cannot read draft files. Once a lot is submitted, its images can be read for that publicly visible lot but cannot be changed or deleted by browser users. Permanent storage paths are kept in `lot_images`; one-hour signed URLs are created when loading the existing gallery and refreshed by normal page refreshes. Selected gallery images follow refreshed URLs instead of retaining an expired URL.

Client validation also decodes photographs to reject corrupt/renamed files. Storage enforces size/MIME restrictions, and database finalization checks actual object records and metadata, plus the 1–10 image limit. File-content antivirus/moderation is not implemented; MIME metadata alone is not a full server-side file-content inspection.

Supabase documents the [private bucket access model](https://supabase.com/docs/guides/storage/buckets/fundamentals) and requires actual object removal through its [Storage API, rather than deleting SQL metadata](https://supabase.com/docs/guides/storage/schema/design).

## Retries and interrupted uploads

The browser saves a per-account submission retry key in sessionStorage. The database enforces one lot per seller/key and serializes duplicate requests. Ownership comes from `auth.uid()`, never an arbitrary seller ID. Publishing retries return the same submitted lot without reordering its queue or starting another auction. Current bids, winner, timing, status and queue fields remain inaccessible to direct browser changes. Title/description length, active room, positive finite GBP with no fractional pennies, and the existing £50 subsequent-bid increment are checked securely before completion. The first bid can equal the starting bid.

Before a file is uploaded, its permanent path is registered in `lot_images` against a persisted draft. A failed or closed tab therefore leaves an owned, recoverable submission rather than an unreferenced file. My Auctions provides **Resume submission** and **Discard draft**. Resume keeps completed files; a file that never arrived is shown as interrupted and can be removed/reselected. Discard asks for confirmation and removes files through the Storage API before deleting the draft and its image references. Guards refuse to remove a reference while its object exists, or discard a submitted lot/lot with bid history. Failed cleanup can be retried.

Unfinished drafts are intentionally retained until their owner resumes or discards them. There is no automatic retention/deletion job. Do not remove Storage metadata directly in SQL. Cross-request Storage/SQL races and physical object deletion must also be checked with real Supabase staging; local PostgreSQL tests emulate the metadata, and browser tests emulate the HTTP service.

## Realtime, authentication and Cloudflare

No new Realtime publication/channel setup is needed: the existing lots publication carries the WAITING transition and later lifecycle updates. Existing notification triggers continue to generate seller/watcher notifications from database transitions. No email/push/payout/verification system is added. The requested Trusted Sellers copy is displayed, but payout verification remains outside this feature's implementation.

No authentication, scheduler, deployment configuration, Cloudflare bindings or environment-variable changes are required. Existing signup/profile creation and confirmed-email requirements are reused.

## Validation and manual acceptance

Final local results (17 October 2026):

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, zero warnings |
| `npm test` | 72 passed |
| `npm run test:browser` | 21 passed |
| `npm run build` | Passed |
| `npm run build:worker` | Passed; `.open-next/worker.js` generated |
| Desktop/mobile visual inspection | Passed; 1440px desktop and 375px mobile screenshots inspected |

OpenNext emitted its Windows compatibility warning; the build still completed. A real staging Worker/Storage smoke test remains required. Test-only image URLs also emit the existing Next.js 16 future local-pattern warning; production configuration was not changed for that fixture warning.

Automated tests use only an in-memory PostgreSQL database and a localhost HTTP/browser fixture, never hosted credentials. Tests cover invalid and positive GBP, anonymous/unverified users, active room selection, idempotent retries, draft privacy and cross-user RLS, limits/metadata/missing photos, broad-policy isolation, immutable state, cleanup, real lifecycle sale/unsold behavior, JPEG/PNG/WebP decoding, corrupt/oversize files, previews/removal, multiple uploads, lost responses, partially interrupted upload cleanup, account listings/room queue/gallery and responsive 320/375/768/1440px layouts. Existing auction, authentication, presence, notification and cleanup regressions are included.

After applying 009 in staging:

1. Sign in as two separate verified sellers. Create a listing in each active room as needed, with several JPEG/PNG/WebP images and pounds/pence prices. Confirm the correct ownership, all images, queue position and absence of an immediately started browser auction.
2. As seller B and an anonymous visitor, try reading/deleting/replacing seller A's draft photo and invoking seller A's preparation/submission/discard RPCs. Expect denial. Submitted gallery photos should be viewable publicly, and uploads/deletes/overwrites must be denied after submission.
3. Interrupt the network after one successful file upload, close/reopen the page, resume via My Auctions, then discard another partial draft. Confirm physical objects disappear from Storage after discard and no unrelated rows/objects change.
4. Use two tabs for the same draft and exercise submit/remove/discard/retry races. Confirm one submitted lot, no deleted final photos and recoverable errors. Local single-connection PostgreSQL cannot prove hosted multi-transaction concurrency.
5. Let the existing scheduler advance the new listing: preview 30s, first-bid window 30s, first/later bids five seconds, highest valid bidder wins. Exercise a no-bid listing and verify seven-day eligibility in the same room. Confirm existing seller notifications still arrive.
6. Review desktop/mobile screenshots and repeat on the browsers/devices used by your sellers. Local automated browser coverage uses Chrome; physical mobile devices and other browsers need manual acceptance.

The earlier reviewed-seed cleanup scripts intentionally reject unknown deletion triggers. After applying 009, its new photo-reference guard may therefore require a fresh review of those scripts before any later cleanup attempt. They have not been edited or had their safety checks bypassed by this feature.

## Files changed for this request

- `src/app/sell/page.tsx`
- `src/app/my-auctions/page.tsx`
- `src/components/SellerListingForm.tsx` (new)
- `src/components/SellerDraftActions.tsx` (new)
- `src/components/AppHeader.tsx`
- `src/components/LotImageGallery.tsx`
- `src/lib/seller-validation.ts` (new)
- `src/lib/lot-photos.ts` (new)
- `src/lib/auction-data.ts`
- `src/lib/supabase/types.ts`
- `supabase/migrations/009_seller_submissions.sql` (new)
- `tests/seller-submissions.test.mjs` (new)
- `tests/helpers/storage-schema.mjs` (new)
- `tests/helpers/release-database.mjs`
- `tests/database.test.mjs`
- `tests/browser/seller.spec.ts` (new)
- `tests/browser/release.spec.ts`
- `tests/browser-fixture.mjs`
- `SELLER_SUBMISSIONS.md` (new)

The six pre-existing untracked SQL Editor cleanup files/tests were not changed by this request. No commit, push, production SQL or deployment has been performed.
