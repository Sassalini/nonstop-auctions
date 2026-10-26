# Storage image optimisation

## Findings and production limits

The supplied Supabase breakdown establishes Storage as the production priority (99.5–99.7% of egress). The five supplied daily Storage figures total approximately 7.06 GB using decimal MB/GB. No production metrics connection, object inventory, request log or credentials were available in this session. Therefore specific production hot paths, typical original sizes and actual CDN HIT rates have not been invented. Use `supabase/audits/storage_image_inventory.sql` (read-only, operator-run) to collect image IDs, original paths, sizes, MIME types, room/status and missing derivative flags. Pair that export with Storage GET paths and HIT/MISS counts from Logs Explorer for the same dates. Include request origin/user-agent to distinguish website visits from Storage-dashboard previews. Redact signed tokens and auth headers.

Confirmed code problems:

- `next.config.ts` deliberately disables Next image optimisation for Worker compatibility; `sizes`/CSS alone never resize files. Originals supplied the main image, thumbnails, room cards, Up Next, catalogue, watchlist, seller previews and buyer/seller history.
- Up to ten originals of up to 5 MiB each are accepted per listing. The reference test photograph is 2,891,942 bytes. Multiple originals were loaded as gallery thumbnails before a visitor explicitly inspected them.
- Signed URLs were generated during server rendering. Reissuing a token changes the URL/cache key. The previous audit already reduced polling and retained URLs within mounted images, but remounts/navigation still lost that retention. This follow-up removes signed-token URLs from stored-photo rendering entirely.
- The existing middleware applies private/no-store to application responses. During implementation this initially overrode the new image handler's cache policy; a scoped exception now lets photo handlers own their headers while middleware still refreshes authentication normally. This was not a cause of old direct-to-Supabase image downloads.
- Existing catalogue/history page bounds and local-only timers were retained. Further Realtime/database tuning is not the priority indicated by the production figures.

## Implemented pipeline

Future uploads keep the exact accepted original (JPEG/PNG/WebP, existing 5 MiB limit) and generate two WebP files in the browser, sequentially, with no paid transformation API:

| File | Longest edge | Quality | Intended use |
|---|---:|---:|---|
| Thumbnail | at most 400 px | 0.78 | room/auction cards, Up Next, catalogue, watchlist, seller preview and histories |
| Display | at most 1600 px | 0.86 | selected main photograph |
| Original | unchanged | unchanged | explicitly opened enlarged viewer |

Aspect ratio is preserved, images are not upscaled, and decoded images above 40 megapixels are rejected. Canvas/WebP support is checked; encoding failures leave the submission recoverable rather than publishing incomplete data. Bitmap/canvas resources and preview blob URLs are released. A 2000×3000 portrait is tested to become 267×400 and 1067×1600 while its original bytes remain identical. The display fixture was visually inspected; stage real jewellery/hallmarks, fine text, dark objects and colour-critical photographs before release. Display compression is lossy; inspection originals are not.

Paths are immutable: `original_path`, `original_path.thumb.webp`, `original_path.display.webp`. Original/variant objects are registered before upload, uploaded with `upsert:false` and `cacheControl:3600`, and recognised on retry. If an upload fails, only derivatives confirmed newly created by that attempt are removed; originals and pre-existing files are retained. Ambiguous lost responses and cleanup failures remain registered in the saved draft for safe retry/discard. Resuming a partial draft can explicitly download its original once to reconstruct missing variants. All three objects must be removed through the Storage API before draft/photo metadata can be discarded. Existing completed auctions, bidding, timers, queue positions, reference numbers and relisting logic are untouched.

## Delivery, caching and all surfaces

Stored photographs use stable same-origin URLs: `/api/lot-photos/<image UUID>/thumb`, `/display` and `/original`. No nonce/timestamp/token is added. The handler performs a security-invoker RPC under the caller's RLS context, then a private Storage download under that same context. There is no service key, public bucket, shared per-user cache or server-side paid image transform.

Publicly visible lot photos use `Cache-Control: private, max-age=300, must-revalidate` and a stable ETag based on the immutable object path. Conditional requests recheck access and can return 304 without downloading the Storage object. Draft/private/error responses are `private, no-store`; draft responses vary by cookie. Public-lot bytes are identical across sessions, so session-cookie changes do not invalidate their private browser cache. No Cloudflare shared cache of these responses is enabled. Previously public cached bytes can remain in a browser for up to five minutes after withdrawal; this is not an instant cache-revocation system.

The current visible main image remains prioritised. Card thumbnails and below-the-fold gallery/catalogue/history images are lazy-loaded. Catalogue pagination stays at 24 items. The enlarged viewer mounts the original image only on explicit opening; arrow navigation and focus/keyboard behaviour remain intact.

Legacy images without attached variants share a single `/original` URL across every surface. This avoids downloading the same fallback original separately as thumb/display/original. They retain their existing resolution and file size until reviewed backfilling is complete. External/local legacy images retain their existing URLs. Registered but missing derivative files fall back safely without caching that fallback; they should be investigated in staging rather than treated as successful optimisation.

The handler uses Web APIs, Supabase SDK and Blob responses, compatible with OpenNext/Workers. Native Sharp runs only in the optional offline preparation script, never in the Worker. Image proxying adds an authorised lookup on an uncached request and one Worker delivery hop; validate real hosted latency/CPU under representative concurrency. Supabase-to-Worker photo bytes still count as Storage egress—the saving comes from smaller files and browser cache hits, not from hiding traffic behind Cloudflare.

## Measured before/after

`tests/browser/storage-images.spec.ts` uploads a real 1536×1024 fixture PNG twice, then replicates those stored objects across nine lots. Fresh 1440×1000 browser contexts are used for cold page cases, while catalogue/gallery/inspection/reload cases use the already visited room. It records actual Supabase fixture binary response bytes and object paths, not estimates from CSS dimensions. Header/TLS/compression overhead and Cloudflare-to-browser billing are excluded. Lazy-loaded off-screen images are not counted until requested.

The baseline temporarily reinstated original-only resolution/signing against the identical generated object set, then restored the working source. It retained the recent polling improvements and uses a fixed fixture signing token, making repeat-cache comparisons conservative. This is a controlled local benchmark, not a claim about typical production photographs or the entire billed 7.06 GB.

Original: **2,891,942 B**. Thumbnail: **20,154 B** (99.30% smaller). Display: **302,200 B** (89.55% smaller, same dimensions for this smaller-than-1600px source).

Upload payloads per photograph (actual File/Blob sizes; exclude multipart/header overhead):

| File | Before original-only upload | After |
|---|---:|---:|
| Original | 2,891,942 B | 2,891,942 B, unchanged |
| Thumbnail | none | 20,154 B |
| Display | none | 302,200 B |
| Total uploaded/stored | 2,891,942 B | 3,214,296 B |

Keeping the original adds 11.15% upload/storage payload for this source; it does not reduce incoming upload bytes. The large saving is repeated outgoing delivery.

| Case | Before GETs | Before bytes | After GETs | After bytes |
|---|---:|---:|---:|---:|
| Cold homepage | 7 | 20,243,594 | 8 | 443,278 |
| Cold room | 7 | 20,243,594 | 8 | 443,278 |
| Switch rooms (additional bytes) | 2 | 5,783,884 | 3 | 342,508 |
| Account/watchlist/sales viewport | 2 | 5,783,884 | 2 | 40,308 |
| Purchase-history viewport | 2 | 5,783,884 | 2 | 40,308 |
| Open catalogue (additional bytes) | 1 | 2,891,942 | 1 | 20,154 |
| Select next photograph (additional) | 0 | 0 | 1 | 302,200 |
| Open enlarged viewer (additional) | 0 | 0 | 1 | 2,891,942 |
| Warm room reload | 0 | 0 | 0 | 0 |

Cold homepage/room Storage bytes fell **97.81%** in this fixture. New delivery requests both a small thumbnail and medium display where appropriate, so GET count need not decrease to save bytes. Previously, selecting another image or opening inspection often added zero bytes because the original had already been downloaded as a thumbnail; now that large transfer happens only on deliberate inspection. Warm reload measured zero new Storage object downloads. Browser tests also verify effective cache headers, 304 revalidation, anonymous denial of private drafts, a single shared legacy original path, and partial-derivative cleanup before draft recovery.

Raw evidence: `audit-results/storage-images/before.json` and `after.json`, with clean fixture object paths and per-request bytes. Sample WebP outputs are in the same folder. No production originals were downloaded or changed.

## Manual schema/deployment steps

Review `supabase/migrations/014_photo_variants.sql`, apply manually after 013 in staging, and validate before any release. **Application code requires migration 014 before deployment.** No production migration has been executed. This continuation does not modify migration 014 or add a redundant migration: its existing additive schema already supports the requested sizes and safe cleanup. If 014 is already applied, do not rerun it.

The migration adds nullable derivative paths, deterministic/immutable-path guards, a variant-aware prepare RPC, a publication completeness check, an RLS-invoker delivery lookup and an operator-only attachment RPC. Existing ownership, lot visibility and no-overwrite rules remain: the existing Storage permission checks are extended to cover the two registered derivative paths under the same predicates. Anonymous users gain no private draft access. The operator-only RPC cannot be invoked by browser roles. The bucket remains private, and its existing WebP support and file-size limits are unchanged. Original pointers/objects and auction rows are not backfilled or rewritten by this migration.

No paid Supabase image transformation setting, Cloudflare image-resizing service, new subscription or dependency was added. The existing Sharp dependency shipped with Next is used for offline preparation only. Cloudflare cache rules must honour the handler's private/no-store headers; do not add a Cache Everything rule for this API. Check PostgREST schema refresh after manual migration and exercise the built Worker preview in staging.

## Safe existing-image backfill (proposal; not executed)

1. Export the read-only inventory and top Storage GET paths/cache statuses. Prioritise the largest frequently requested originals. Use a small reviewed staging sample first.
2. Reuse already-held originals where possible. Otherwise download each selected original once through an authorised operator session into a protected local folder. Downloads themselves consume egress; plan a bounded batch and billing headroom. Do not export/share service credentials or signed URLs.
3. Create a manifest with `image_id` and `storage_path`. Run `node scripts/prepare-photo-variants.mjs manifest.json originals-folder NEW-output-folder` for a dry run. It performs local encoding/size/hash checks but writes nothing. Review quality, sizes, dimensions and available Storage capacity.
4. Add `--write` only after review to write WebPs and `review-manifest.json` into a separate local output folder. Repeat runs verify and skip byte-identical files, generate missing files, and refuse differing outputs, source traversal, symlink escapes and original replacement. Use a new output folder for a changed manifest/profile; do not overwrite previously prepared 384/1920px derivatives with the new profile. It records original SHA-256 hashes; originals remain unchanged. Offline and browser WebP encoders can produce different bytes, so review the actual generated outputs.
5. An authorised operator uploads just the two derivatives to their reviewed deterministic paths in the existing private bucket, with MIME image/webp, cacheControl 3600 and overwrite disabled. Verify hashes/metadata. If a path already exists with different bytes, stop for review; do not overwrite it. Unattached derivatives are not publicly readable.
6. Only after both derivatives are uploaded and verified, an operator invokes `register_existing_photo_variants(image_id)` for the reviewed IDs. It validates both object records and attaches only derivative pointers. It cannot modify an original pointer or auction state. Retain the manifest and verify samples through thumb/display/original endpoints.
7. Expand gradually, recheck daily Storage egress and review errors. There is no automated deletion or rollback-by-overwrite. Keep originals. If a derivative is wrong, stop the batch and review a versioned corrective migration; pointers and objects are deliberately immutable.

## Free-plan outlook

These measured savings make low-traffic operation substantially more plausible **after existing hot originals are backfilled**. Future-upload compression alone will not shrink the current oversized catalogue. As arithmetic using this fixture, 1,000 comparable cold homepage loads transfer about 443 MB of Storage images, plus approximately 289 MB for 100 explicit full-size inspections. Other page visits, different photo sizes, cache misses, operator downloads and inspection frequency must be added. This is not a production forecast or a guarantee against the 5 GB uncached allowance.

Keep a margin and compare the same project/billing dates after release: uncached Storage bytes, GET paths and cache-status split, alongside visits and inspection openings. Variants add stored bytes (about 11.1% extra for this source), so check Storage capacity separately. The daily figures provided cannot identify the per-object mix; the inventory and access-log join is still required to predict the real monthly saving.

## Files changed in this follow-up

This continuation updates the 400/1600px profile, failed-upload derivative cleanup, idempotent offline preparation, missing-variant inventory, room-switch measurements and associated tests. The complete pending image-pipeline implementation is listed below.

- `src/lib/photo-variants.ts`: browser encoding; `src/components/SellerListingForm.tsx`: previews, upload/recovery; `SellerDraftActions.tsx`: three-object cleanup; `src/app/sell/page.tsx`: interrupted-original detection on resume.
- `src/lib/lot-photos.ts`, `auction-data.ts`, `completed-auctions.ts`, `lot-columns.ts`, `supabase/types.ts`: stable size-aware URLs and metadata across all surfaces, including bounded history lookups.
- `src/components/LotImageGallery.tsx`, `LotPhoto.tsx`: correct photograph sizes, lazy loading, original-on-inspection and stable legacy handling.
- `src/app/api/lot-photos/[imageId]/[size]/route.ts`, `src/middleware.ts`: authorised delivery and effective private caching.
- `supabase/migrations/014_photo_variants.sql`, `supabase/audits/storage_image_inventory.sql`, `scripts/prepare-photo-variants.mjs`: proposed schema, inventory and offline-only backfill preparation.
- `tests/photo-variants.test.mjs`, `photo-variant-offline.test.mjs`, `tests/browser/storage-images.spec.ts`, `tests/browser/seller.spec.ts`, `tests/browser-fixture.mjs`: security, cleanup, scaling, original preservation, recovery, cache and transfer measurements.
- This report and the local evidence files. Earlier egress-audit changes remain in the working tree and have not been committed or discarded.

## Validation

Updated lint, TypeScript, all 108 Node/database tests and all 43 browser tests passed. The browser suite includes partial-draft recovery, legacy fallback, public/private cache rules, original-byte preservation, portrait scaling and existing auction regressions. Next.js production build passed. The historical support-policy build gate is resolved by the dependency update documented in [CLOUDFLARE_BUILD_COMPATIBILITY.md](CLOUDFLARE_BUILD_COMPATIBILITY.md). Normal `npm run build:worker` now succeeds without a bypass. PGlite/HTTP protocol fixtures do not replace staging Supabase Storage RLS, Cloudflare runtime or Safari/iOS testing. No production configuration, objects, migration, commit, push or deployment was changed.
