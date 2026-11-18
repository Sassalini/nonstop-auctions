# Automatic seller Stripe sandbox onboarding

For the reconciliation investigation and migration 020 follow-up, see
[Seller Stripe reconciliation](SELLER_STRIPE_RECONCILIATION.md). It supersedes the
retry and mapping-verification behavior below: continuations recover before
replaying creation, and existing automatic mappings are verified before resuming.

## Account and charge model

The existing buyer Checkout creates direct card charges in the seller's connected-account scope (`stripeAccount`); it does not use destination charges or platform transfers. Automatic provisioning uses the existing Accounts v1 API and explicit Standard-equivalent controller properties:

- `country: GB`, `card_payments.requested: true`.
- Full Stripe Dashboard; Stripe collects verification requirements.
- The connected account pays Stripe fees; Stripe bears connected-account payment losses.
- No transfer capability request, application fee, bank account attachment, payout creation, payout schedule change, or live-mode setup is added.

This is compatible with the existing direct-charge Checkout. Existing mappings, including accounts with another supported controller configuration, are reused rather than converted or replaced. Accounts v2 and Express liability are outside this change. References: [controller properties and Standard equivalence](https://docs.stripe.com/connect/migrate-to-controller-properties), [Accounts API](https://docs.stripe.com/api/accounts/create), [hosted onboarding and return/refresh handling](https://docs.stripe.com/connect/standard-accounts).

## Apply after review

1. Use the isolated Supabase staging project whose URL is configured by both `NEXT_PUBLIC_SUPABASE_URL` at build time and `STRIPE_TEST_SUPABASE_URL` at runtime. Confirm migration 018 and all predecessors are applied.
2. Review `supabase/migrations/019_seller_stripe_test_provisioning.sql`. Apply that one forward-only migration through your normal reviewed Supabase migration process **before** releasing this application code. Do not rerun or modify migration 017. No SQL has been applied to a hosted project by this implementation.
3. Migration 019 creates a private provisioning-intent table and two service-role-only RPCs. It does not update/delete existing mappings or financial rows. Both intent and mapping tables retain RLS, no browser grants/policies, and no Realtime publication. Service-role callers can read intents but can write them and insert mappings only through the RPCs; they cannot directly reset attempts with normal API table grants.
4. Confirm existing Stripe test environment settings remain available to the active Worker: `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_TEST_CHECKOUT_ENABLED=true`, `STRIPE_TEST_APP_ORIGIN`, `STRIPE_TEST_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, plus the public Supabase build variables. No new environment variable is required. Keep private values server-only and out of build logs or client code. The existing shared guard still requires a webhook secret for onboarding.
5. Review and release through the usual process. This work does not commit, push, upload, or deploy. Rollback of application code does not require deleting intents or mappings; leave migration 019 in place.

## Stripe Dashboard requirements

- Use a Stripe **sandbox/test** platform, complete Connect platform setup and onboarding branding (business name, brand colour, icon), and support UK connected accounts with full Dashboard access and direct card charges. Dashboard restrictions can prevent API account creation until the platform configuration is complete.
- The server key must belong to that sandbox and support platform balance retrieval, platform/connected account reads and listing, connected-account creation, and Account Link creation. Existing buyer Checkout permissions must remain. The application requires the `sk_test_` prefix and additionally verifies `balance.livemode === false` before provisioning/onboarding. A live key is rejected.
- Keep the existing sandbox **connected-account** webhook destination at `/api/stripe/webhook`, its signing secret, and payment-event subscriptions described in `PAYMENTS_AND_CONNECT_READINESS.md`. Seller status is retrieved directly from Stripe on every page request, so `account.updated` is not required for this feature; existing webhook reconciliation remains unchanged.
- Set the trusted HTTPS application origin. Stripe returns to `/account/seller-payments`; expired/single-use links return to `/account/seller-payments/refresh`. Both routes require the seller's authenticated application session. Local loopback HTTP is supported for fixtures.
- Use synthetic test identities and Stripe's test verification data. This code never calls a payouts API or enables live payments. Stripe may report simulated payout eligibility after sandbox verification; that is distinct from moving real money.

## Provisioning and recovery

Only the server action provisions, after Supabase `auth.getUser()` verifies the session. Seller and account IDs are never accepted from the client. The server first checks the private mapping and reuses it. On a new setup, the reservation RPC locks the seller's profile and records one durable random intent scoped to the Stripe platform account. Concurrent requests obtain the same intent; Stripe account creation uses the stable key `nonstop-test-seller-v1-<intent UUID>` and immutable parameters. The binding RPC locks in the same order, validates intent/platform/account identity, and inserts one mapping atomically. It never overwrites a different mapping.

Do not change the v1 creation parameters or key format for existing intents in a future release. Introduce an explicitly versioned path if changing account models.

Stripe v1 can prune idempotency keys after 24 hours. The database allows create/retry calls only during the first **one hour** of the intent, leaving a conservative margin. A continuation first searches connected accounts for the intent metadata `nonstop_test_provisioning`, including after a failed binding. It reuses a uniquely verified account without another create request. If a complete scan finds nothing within the window, it rechecks database eligibility before replaying the original key and unchanged parameters. A timeout, lost Stripe response, or cached provider failure also triggers recovery. Outside the window, only recovery is allowed; the system never treats a missing search result as permission to create another account. Migration 020 distinguishes the sole new-reservation request, which can skip the initial recovery scan. [Stripe idempotency retention](https://docs.stripe.com/api/idempotent_requests).

Recovery scans up to ten pages of 100 connected accounts. It verifies account country/controller properties and rejects ambiguous matches or incomplete scans. If one match is found in a complete scan, it binds that account. If the account cannot be confirmed, the seller receives a reconciliation message and no new account is created. Missing/inaccessible existing mapped accounts also remain mapped and do not trigger replacement.

For an operator reconciliation:

1. Inspect the private intent ID, seller, platform account, and creation timestamp in the staging database. Verify that the runtime key still belongs to the recorded sandbox platform. Do not reset/delete the intent or change its creation timestamp.
2. In the same Stripe sandbox, inspect API request logs and connected accounts for the exact intent metadata and stable idempotency key. Check all pages if the automatic 1,000-account bound was reached. Do not identify an account by email alone or guess an account ID.
3. If exactly one account is verified to belong to this intent and to match the configured model, an authorized operator can invoke `bind_seller_stripe_test_account` with the recorded seller, reservation, platform and verified account IDs. This only inserts the missing mapping; a different existing mapping is rejected. Review this action before executing it.
4. If the creation outcome remains uncertain, leave the intent blocked and investigate with Stripe. Do not issue another create or manually provision a replacement. If no account was ever created but the safe window has expired, a separately reviewed recovery process is required; there is deliberately no seller-accessible reset button.

Account Links are single-use and generated fresh per action/refresh. The authenticated GET refresh route only reads an existing mapping and creates a new link; it never provisions an account. Errors return to the seller page with a safe retry prompt. Return URLs never mark setup complete: the seller page retrieves actual capabilities, charges/payout eligibility, and outstanding requirements and shows Not set up, Setup in progress, Additional verification required, Ready to receive payments, or Restricted or unavailable.

## Validation

Tests use synthetic Stripe/Supabase fixtures and local PGlite PostgreSQL only. No real Stripe accounts or hosted financial rows are created by these tests. PGlite verifies migration SQL, ACL/RLS, immutable mappings and retry state; it has one connection, so it cannot prove real multi-connection Postgres lock scheduling. Browser tests exercise concurrent requests against the local provider fixtures and actual Next.js server action/refresh route.

Before a reviewed release, perform a real sandbox smoke test with migration 019 applied: two simultaneous setup requests, one account/mapping, hosted verification and return, incomplete verification, expired-link refresh, and the existing signed-webhook buyer Checkout flow. That external acceptance check remains pending; local mocks cannot establish Dashboard permissions or Stripe approval of the platform configuration.

Local results:

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed |
| `npm test` | 137 passed, zero failures; includes 20 new onboarding/action/security/recovery cases |
| `npm run test:database` | 20 passed, zero failures; existing auction/payment/fulfilment migrations also run through 019 |
| Full browser suite, checkout disabled | 55 passed, seven sandbox-mode skips |
| Seller onboarding browser suite, `TEST_STRIPE_CHECKOUT=1` | Four passed, zero failures |
| Existing transaction browser cases, `TEST_STRIPE_CHECKOUT=1` | Six passed, two checkout-disabled-mode skips; includes the three sandbox Checkout/webhook settlement/expiry cases skipped by the default run |
| Normal `npm run build` | Passed |
| Normal `npm run build:worker` | Passed; generated `.open-next/worker.js` |

PowerShell execution policy blocks `npm.ps1` on this workstation; checks used `npm.cmd` without altering scripts. Browser development and the OpenNext esbuild config loader needed an approved run outside the filesystem sandbox. No unsupported-version flags, framework/config changes, deployments, or live provider requests were used. OpenNext retains its general Windows compatibility warning. The default browser run also emits the existing Next.js 16 image-localPatterns advisory.

## Changed files

| Area | Files |
| --- | --- |
| Migration | `supabase/migrations/019_seller_stripe_test_provisioning.sql` |
| Provisioning and status | `src/lib/seller-stripe-onboarding.ts`, `src/lib/seller-payment-status.ts` |
| Existing server integration | `src/app/checkout-actions.ts`, `src/lib/stripe-test.ts`, `src/lib/supabase/types.ts` |
| Seller UI and refresh | `src/app/account/seller-payments/page.tsx`, `src/app/account/seller-payments/refresh/route.ts`, `src/components/SellerOnboardingButton.tsx` |
| Tests | `tests/seller-stripe-provisioning.test.mjs`, `tests/seller-stripe-actions.test.mjs`, `tests/helpers/load-server-module.mjs`, `tests/browser/seller-payments.spec.ts`, `tests/browser-fixture.mjs` |
| Documentation | `docs/SELLER_STRIPE_TEST_ONBOARDING.md`, `docs/PAYMENTS_AND_CONNECT_READINESS.md` |

Migration 017, environment files, dependency versions, buyer Checkout behavior, webhook processing, auction results, and delivery management were not changed. Tracked audit reports regenerated by browser tests were restored to their original content.
