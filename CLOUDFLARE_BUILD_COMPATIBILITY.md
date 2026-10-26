# Normal Cloudflare Worker build compatibility

## Result

Normal `npm run build:worker` now succeeds, using Next.js 15.5.28 and OpenNext Cloudflare 1.20.13. No unsupported-version flag, patched node_modules, framework migration, disabled check or custom bypass was added. The npm scripts remain unchanged.

## Cause and upstream fix

The old Cloudflare adapter 1.20.8 installed `@opennextjs/aws` 4.1.7. Its support-policy gate rejected Next.js 15 after the two-year anniversary of the major release (21 October 2024), producing the failure observed on this machine after 21 October 2026. This happened before Worker bundling; it was not a Supabase, bidding, Worker-binding or App Router application failure.

Cloudflare adapter 1.20.13 installs AWS adapter 4.1.12, whose support checker first accepts a known Next.js major if the second subsequent major is not listed. This fixes the premature Next.js 15 rejection. The official Next.js support page currently lists 15 as Maintenance LTS. The adapter's published peers also require Next.js >=15.5.28 <16 and Wrangler ^4.148.0, so the adapter patch alone with 15.5.27 would not satisfy its peer contract.

Sources: [Cloudflare adapter releases](https://github.com/opennextjs/opennextjs-cloudflare/releases), [AWS adapter 4.1.12 fix](https://github.com/opennextjs/opennextjs-aws/releases/tag/v4.1.12), [Next.js support policy](https://nextjs.org/support-policy). Installed checker code and npm registry peer metadata were also inspected locally.

## Versions and selection

| Package | Previously installed | Selected/resolved |
|---|---|---|
| next | 15.5.27 | 15.5.28 |
| eslint-config-next | 15.5.27 | 15.5.28 |
| @opennextjs/cloudflare | 1.20.8 | 1.20.13 |
| @opennextjs/aws (adapter dependency) | 4.1.7 | 4.1.12 |
| wrangler | 4.147.0 | 4.152.0 |
| react | 19.2.7 | 19.2.9 |
| react-dom | 19.2.7 | 19.2.9 |
| sharp (existing transitive dependency) | 0.35.4 | 0.35.5 |
| source-map-js (existing transitive dependency) | 1.2.1 | 1.2.2 |

Registry checks found 15.5.28 to be the latest stable Next.js 15.5 patch and 1.20.13 the latest stable Cloudflare adapter. Wrangler 4.148.0 is the minimum compatible version; current stable 4.152.0 was chosen after npm audit flagged the minimum version. React/React DOM 19.2.9 are the latest patches on the existing 19.2 line; 19.3.1 is available but that minor upgrade is unnecessary for this fix. Next.js 16 was not introduced. Matching React/DOM versions satisfy both Next.js and React DOM peers.

Manifest ranges now allow patches within the selected lines (`~`), preventing a routine install from drifting Next.js into a different minor line. package-lock.json records the exact resolved tree. The existing PostCSS override is preserved. `npm install` and targeted compatible transitive patch updates completed with no force/legacy-peer-deps flags; `npm ls --all` reports no peer problems. Platform-specific missing OPTIONAL binaries for other operating systems are normal.

## Validation

- `npm install`: passed; lockfile updated consistently.
- `npm run build`: passed twice as explicitly requested.
- `npm run build:worker`: passed normally, producing `.open-next/worker.js` and assets.
- `npm run lint`: passed, no warnings.
- `npm run typecheck`: passed.
- `npm test`: 108 passed, zero failed.
- `npm run test:browser`: 43 passed, zero failed.
- `wrangler deploy --dry-run`: passed locally; no upload or deployment. It read 71 static assets, resolved the existing ASSETS and WORKER_SELF_REFERENCE bindings, and estimated a 6,125.95 KiB Worker / 1,242.92 KiB gzip bundle.

OpenNext still emits its general Windows compatibility warning. That is separate from the resolved Next.js support-policy failure. The normal build and dry-run succeed on this Windows workspace. CI/production Cloudflare runtime behaviour still requires the usual post-review deployment/preview smoke check; no deployed Worker or production Supabase data was exercised here.

npm audit still reports 10 findings (5 high, 5 moderate), including inherited minifier/glob, CSS-tooling and Wrangler/Miniflare/Undici dependency chains. Latest stable direct tooling does not eliminate all of them. No major Tailwind migration, incompatible override, forced audit fix or adapter downgrade was applied. These findings remain a separate dependency-security review; do not interpret this compatibility fix as an audit-clean dependency tree.

## Cloudflare settings

No changes to `wrangler.jsonc`, `open-next.config.ts`, `next.config.ts`, environment variables or Worker bindings are required. They remain:

- Main: `.open-next/worker.js`; assets directory: `.open-next/assets`; binding: ASSETS.
- Service: WORKER_SELF_REFERENCE -> nonstop-auctions.
- Compatibility date: 2026-07-03.
- Flags: nodejs_compat and global_fetch_strictly_public.

Use the committed lockfile for reproducible installation (`npm ci`). The normal build command is `npm run build:worker`; existing preview/deploy scripts already invoke it normally. If an external Cloudflare dashboard/CI command was manually configured with the old bypass, remove that argument there too. This session cannot inspect that external setting. Wrangler requires Node >=22; verification used Node 24.21.0/npm 11.19.0. Keep a supported Node 22+ build environment. No service binding renaming, new paid services, database migrations or secrets changes are needed.

## Files changed in this fix

- package.json: selected compatible patch-line ranges.
- package-lock.json: corresponding direct/transitive resolutions and platform binaries.
- LOT_VIEWING_IMPROVEMENTS.md, SUPABASE_EGRESS_AUDIT.md, STORAGE_IMAGE_OPTIMISATION.md: replaced obsolete bypass instructions with the resolved normal-build status.
- This report.

Application UI, auction logic, scheduler, Supabase integrations, SQL migrations and policies were not edited. No commit, push or deployment was performed.
