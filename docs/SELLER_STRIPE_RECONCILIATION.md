# Seller Stripe reconciliation investigation — 18 November 2026

## Finding and access limits

The **exact hosted incident cause is not yet verified**. No private Stripe test key,
Supabase service-role key, sandbox database binding, or authenticated seller session
is available in this workspace. Only public Supabase configuration is present.
No hosted database or Stripe records were read or modified, and no connected account
was created. Do not interpret fixture accounts in tests as this seller's account.

Assuming the deployed code matches this checkout, the quoted page description proves
that, **at render time**, the mapping lookup returned no `seller_stripe_test_accounts`
row and a `seller_stripe_test_provisioning` row existed. It does **not** prove that
Stripe creation succeeded or failed, that the account is restricted, or that a lock
is stuck. A concurrent request could change the mapping after that render.

The code has a deliberate unresolved-outcome stop: after one hour it will recover an
existing account but never submit another account-creation request. An interrupted
request **before** creating anything and a lost response **after** creating an
account can leave indistinguishable database state. A failed initial API request
followed by a retry after one hour is another reproducible path. These are verified
local reproductions, **not a determination of this seller's incident**.

Current hosted mapping ID, reservation age, Stripe account existence, requirements,
restrictions, prior database-write failures, and concurrent API calls remain unknown.
An operator must complete the read-only inspection below to resolve those questions.

## Original message and all triggering conditions

Call chain:

1. `src/app/account/seller-payments/page.tsx` renders `SellerPaymentsPage`.
   `sellerPaymentStatus(null, true)` in `src/lib/seller-payment-status.ts` supplied
   the quoted heading and description for **any** saved reservation without a mapping.
2. `src/components/SellerOnboardingButton.tsx` calls the server action
   `openSellerTestOnboarding()` in `src/app/checkout-actions.ts` and displays its error.
3. The action verifies the Supabase session via `auth.getUser()` and calls
   `getOrCreateSellerTestAccount()` in `src/lib/seller-stripe-onboarding.ts`.
   It returns `SellerSetupRecoveryRequired.message`; other exceptions get a generic
   retry message with provider details suppressed.

In the original code, this **exact reconciliation message** was reachable through:

| Original condition | Database / API evidence | New support code |
| --- | --- | --- |
| Reservation belongs to a different platform | No mapping; reserve RPC compares `platform_account` with the platform returned by the active Stripe key and raises `Seller setup requires reconciliation` | `platform_mismatch` |
| Invalid reserve RPC response | Neither `stripe_account` nor an intent `id` is returned; this is an RPC/deployment anomaly rather than a defined normal row state | `invalid_reservation` |
| Account model or ownership metadata mismatch | Country not GB, wrong/missing intent metadata, fees payer not `account`, losses responsibility not `stripe`, or dashboard not `full` | `account_mismatch` |
| Multiple accounts claim one intent | Complete or partial account listing contains two distinct IDs with the same reservation metadata | `ambiguous_accounts` |
| Recovery cannot finish safely | Ten pages of 100 reached with `has_more`, or a page says more but supplies no cursor | `incomplete_scan` |
| Expired unresolved attempt | No mapped/bound account; `clock_timestamp() >= created_at + interval '1 hour'`; a complete recovery scan finds no match | `expired_unresolved` |

Within the first hour, a creation exception followed by a complete scan finding no
account originally raised `Stripe setup could not be confirmed`, which produced
the **generic retry message**, not the reconciliation message. Database bind errors,
unique-constraint conflicts, missing/inaccessible Stripe accounts, Stripe list
failures, balance failures, and most database errors likewise produced generic
failures. A Stripe restriction by itself did not trigger this reconciliation error.

The patch also checks `controller.requirement_collection === 'stripe'` and validates
existing automatic mappings on the page, action, and refresh route. Wrong metadata,
an intent/account disagreement, a platform disagreement, or generated metadata with
no intent for that seller now blocks resumption without replacing the mapping.
Legacy operator mappings without generated intent metadata remain authoritative and
are retrieved under the configured Stripe key; their external ownership still
depends on the original operator having verified it correctly.

## Recorded database state

Migration 017's `seller_stripe_test_accounts` has exactly:

- `seller_id`: primary key, references `profiles.id`.
- `stripe_account`: non-null, unique, `acct_...` format.

Migration 019's separate private `seller_stripe_test_provisioning` has:

- `seller_id`: primary key, references `profiles.id`.
- `id`: unique durable reservation UUID.
- `platform_account`: Stripe platform account ID for this reservation.
- `created_at`: original timestamp; never renewed by reserve/retry.
- `stripe_account`: nullable, unique account ID populated in the binding transaction.

There are **no pending/failed status columns**, failure logs, attempt counters, or
lease-expiry columns. A null intent account means **outcome unknown**, not “creation
failed.” Mapping insertion and intent binding happen in one PostgreSQL transaction;
a failed transaction rolls both back. Stripe creation is outside that transaction,
so an account can exist without either account ID having been saved.

Profile and intent row locks serialize the short reserve/bind transactions. They
are released at transaction end and are not held across Stripe calls. The one-hour
deadline is a creation safety window, **not an expiring or renewable lock**.

## Read-only operator inspection

1. Select the isolated Supabase project configured by **both** the deployed build's
   `NEXT_PUBLIC_SUPABASE_URL` and runtime `STRIPE_TEST_SUPABASE_URL`. Verify the
   running Worker version and settings privately; do not paste keys or JWTs into
   logs, source, SQL, or the investigation report.
2. Obtain the seller's verified auth user UUID in a private operator context.
   Run `supabase/operations/inspect_seller_stripe_onboarding.sql`, replacing its one
   sample UUID. Run its schema check first. The remaining statements use a read-only
   transaction, select only internal reconciliation fields, and inspect deployed
   RPC definitions without invoking them. Do **not** call `reserve_*` to diagnose:
   it can insert an intent. Check migration history separately if needed:

   ```sql
   select version from supabase_migrations.schema_migrations
   where version in ('017','018','019','020') order by version;
   ```

   If migration history is unavailable or versions are recorded differently, use
   the schema/function inspection, not an assumption that the migration is absent.
3. In Stripe Dashboard, select the **intended sandbox and platform**, rather than
   relying on a test-mode label or `sk_test_` prefix alone. Different sandboxes can
   both be in test mode. Compare its platform account ID with `reserved_platform`.
   Using the same deployed key in a secure operator tool, `GET /v1/balance` must
   show `livemode=false`, and `GET /v1/account` must identify that platform.
4. In Dashboard's API request logs (Workbench / Developers, depending on Dashboard
   layout), set the time range to include `reserved_at` and all retries. Filter
   account-creation requests (`POST /v1/accounts`). Inspect the exact request header
   `Idempotency-Key: nonstop-test-seller-v1-<reservation UUID>` and request metadata
   `nonstop_test_provisioning=<reservation UUID>`. Record privately the request ID,
   timestamp, status/error **code**, and returned account ID. Do not export request
   bodies, identity fields, keys, or full account JSON.
5. Compare every matching request's key and parameters. Overlapping timestamps or
   `idempotency_key_in_use` errors establish concurrent API requests; a single
   database intent alone does not establish concurrency. Repeated calls using the
   same key and parameters should resolve to one account. Different keys for one
   seller require an ownership investigation before binding anything.
6. In Connect's connected-account list, open `mapped_account` or
   `provisioned_account` if present. If neither is saved, inspect connected-account
   metadata for the reservation UUID. Dashboard text search may not search custom
   metadata: use read-only `GET /v1/accounts?limit=100` with `starting_after` through
   **all** pages if needed. Never interpret a partial listing as proof of absence.
   Keep full responses private; record only IDs and relevant boolean/status fields.
7. Read the candidate with `GET /v1/accounts/<account ID>` under the intended
   sandbox platform key. Verify the metadata reservation, GB country, full dashboard,
   Stripe requirement collection, account fees, and Stripe losses responsibility.
   Confirm no other seller mapping/reservation claims it:

   ```sql
   begin transaction read only;
   select seller_id, stripe_account
   from public.seller_stripe_test_accounts
   where stripe_account = 'acct_REPLACE_WITH_VERIFIED_ACCOUNT';
   select seller_id, id, platform_account, stripe_account, created_at
   from public.seller_stripe_test_provisioning
   where stripe_account = 'acct_REPLACE_WITH_VERIFIED_ACCOUNT';
   commit;
   ```

   Do not use names/email as proof of ownership. A 404 can mean wrong sandbox,
   disconnected/deleted account, or lack of access; it does not authorize replacement.
8. Inspect only readiness fields: `details_submitted`, `charges_enabled`,
   `payouts_enabled`, `capabilities.card_payments`, and `requirements` due/past-due/
   pending-verification field names and `disabled_reason`. Do not copy verification
   documents, banking data, or personal values. Requirements can explain incomplete
   onboarding without explaining a missing database binding.
9. Inspect Cloudflare and Supabase logs around matching request times for request
   termination/timeouts and bind RPC/database errors. A successful Stripe create
   plus no mapping establishes an unbound Stripe result; distinguish an interrupted
   Worker from a failed bind using those logs. The current schema alone cannot
   distinguish these causes. Record safe reason codes, not raw provider exceptions.

## Reviewed recovery decision

**Exactly one verified original account:** preserve that identity and its onboarding
and verification state. If the correct mapping already exists, correct configuration
or account-access problems instead of rewriting it. If the mapping is missing, the
existing service-only binding RPC can bind the original account even after the
one-hour window. An operator can review this concrete template after substituting
the four **verified** values; it is a database mutation and was **not executed**:

```sql
begin;
select public.bind_seller_stripe_test_account(
 p_seller      => '00000000-0000-0000-0000-000000000000'::uuid,
 p_reservation => '00000000-0000-0000-0000-000000000000'::uuid,
 p_platform    => 'acct_REPLACE_WITH_VERIFIED_PLATFORM',
 p_account     => 'acct_REPLACE_WITH_VERIFIED_ORIGINAL_ACCOUNT'
);
-- Inspect the returned ID and mapping in this transaction.
-- COMMIT only after the reviewed values and result agree; otherwise ROLLBACK.
rollback;
```

The template deliberately rolls back by default. The RPC validates the seller,
reservation, platform, and any existing binding, refuses replacements, and writes
the mapping and intent account atomically. It does **not** query Stripe; the operator
must establish Stripe ownership first. Repeating a valid binding is safe. If the
existing mapping differs, leave it blocked and investigate; do not delete it.

After an approved binding, read back both rows, then let the authenticated seller
continue to a fresh Account Link. Returning from Stripe never sets readiness in the
database: the page fetches Stripe's current capabilities and requirements.

**No account found, original window still open:** after a complete inspection,
retrying the original request with the **same key and unchanged v1 parameters** is
the supported recovery. Stripe can cache 500 responses, so repeated cached failures
still require investigation. Validation failures and concurrent-request conflicts
need not cache an execution result. Do not change the key to bypass them.

**No account found, window expired:** remain blocked. Stripe can prune v1 keys once
they are at least 24 hours old; replaying a pruned key is a new request. Even a
two-hour-old attempt remains outside this application's conservative policy. Do not
edit `created_at`, delete the reservation, or generate a new key. An operator must
resolve the original execution through complete logs and, if needed, Stripe Support
before designing any separately reviewed recovery. This patch adds no reset path.

**Ownership ambiguous / multiple matches / incomplete history:** remain blocked.
Identify the original platform, exact intent, matching request result, and sole
account owner before any bind. Metadata can be edited by privileged users, so use
request history as corroboration where ownership is in doubt.

See [Stripe's v1 idempotency rules](https://docs.stripe.com/api/idempotent_requests)
for retention, cached 500s, validation failures, and concurrent execution behavior;
[account listing](https://docs.stripe.com/api/accounts/list) for pagination; and
[hosted onboarding](https://docs.stripe.com/connect/standard-accounts) for link refresh
and return handling. The application retains the existing Accounts v1/controller
model and immutable creation parameters.

## Local reliability changes prepared for review

- `src/lib/seller-stripe-onboarding.ts`: specific safe support codes; recovery before
  replay on continuation; refreshed database eligibility after a recovery scan;
  existing automatic mapping ownership/platform checks; fail closed on ambiguous,
  incomplete, mismatched, or expired unresolved state.
- `src/app/account/seller-payments/page.tsx`: uses the shared read-only mapping
  verifier on every status read/return and hides onboarding for a verified mismatch.
- `src/app/account/seller-payments/refresh/route.ts`: verifies ownership before
  generating a new Account Link. GET still never creates an account or binds rows.
- `src/lib/seller-payment-status.ts`: a saved request is described as a request,
  without claiming that a Stripe account has already been created.
- Migration `020_seller_stripe_reservation_origin.sql`: adds only the reserve RPC
  response flag `new_reservation`. The seller profile lock ensures only the
  transaction that inserts the intent returns true. Existing callers ignore the
  added field. Existing rows, schema columns, timestamps, keys, bindings, and the
  one-hour window stay intact. Migration 019 is unchanged.
- New code with only migration 019 safely falls back to scanning before creation.
  Apply 020 through the normal reviewed migration process before release for the
  efficient fresh-seller path. An incomplete recovery scan still blocks a pending
  seller and requires an operator; no match is never permission to reset an intent.
- No secrets or account details were added to logs. Existing SDK timeout and network
  retry settings remain; repeated requests share the durable key. A conflicting
  simultaneous Stripe request can still return a safe retry error until the first
  result becomes visible. There is no background completion guarantee after a Worker
  dies: the next authenticated continuation or reviewed operator binding recovers it.

## Validation

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed; zero warnings |
| `npm.cmd test` | 150 passed; zero failures/skips |
| `npm.cmd run test:database` | Passed; full migration chain including 020 |
| Seller provisioning/action tests | 33 passed within the full suite; includes read-only SQL inspection and migration preservation |
| `TEST_STRIPE_CHECKOUT=1 npx.cmd playwright test tests/browser/seller-payments.spec.ts` | 12 passed |
| `npm.cmd run build` | Passed; also rebuilt successfully by OpenNext after the final code adjustment |
| `npm.cmd run build:worker` | Passed; OpenNext server bundle and `.open-next/worker.js` generated |
| `git diff --check` | Passed |

All provider creation/link operations in these checks use synthetic local fixtures.
No Stripe account was created on an external system, and no hosted SQL was executed.
The browser run used workspace-local `XDG_CONFIG_HOME`, `WRANGLER_LOG_PATH`, and
`MINIFLARE_REGISTRY_PATH` to avoid writes outside the workspace. All assertions
passed; the fixture's remaining Windows child processes required explicit local
cleanup before Playwright exited successfully. The first OpenNext attempt was
blocked by esbuild's parent-directory traversal under the filesystem sandbox; the
approved local build outside that restriction passed. No deployment was run.

The tests cover fresh/incomplete onboarding, interrupted creation or binding,
lost responses, retries of the original key, concurrent requests, elapsed windows,
ambiguous/incomplete scans, correct account ownership, Account Link expiry/provider
errors, restrictions, and server-side re-fetch after hosted-onboarding return.

Local PGlite is single-connection PostgreSQL and cannot prove real multi-session
lock scheduling. Browser concurrency uses the HTTP fixture, rather than hosted
PostgreSQL. Stripe-hosted screens are intercepted; real verification screens, the
actual seller's records, and deployed Worker behavior require operator inspection.
No commit, push, upload, deployment, or hosted mutation is authorized or performed.
