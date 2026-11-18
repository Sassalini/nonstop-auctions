# Seller Payments self-service review

This records the earlier self-service change. The subsequent
[reconciliation investigation](SELLER_STRIPE_RECONCILIATION.md) prepares migration
020, additional mapping verification, and recovery before creation retries. Its
current release/recovery instructions supersede the historical findings below.

## Repository findings

Automatic seller provisioning was already present before this change. `openSellerTestOnboarding()` authenticates with Supabase `auth.getUser()` and calls `getOrCreateSellerTestAccount()` using only the verified session's seller ID. It reuses `seller_stripe_test_accounts`, including operator-created mappings. No seller or connected-account identifier is accepted from the browser.

Migration 017 introduced the private mapping table and sandbox checkout. Migration 018 added won-order checkout support. Existing migration 019 provides a separate durable creation intent and service-role-only reserve/bind RPCs. The profile lock, unique seller/account constraints, immutable Stripe creation parameters, and stable idempotency key prevent duplicate accounts under retries and concurrent requests. Lost responses and failed mapping writes are reconciled using reservation metadata; uncertain attempts outside the one-hour create window cannot create replacements. The intent table is recovery state, not another seller mapping.

The existing checkout creates direct card charges using `stripeAccount`, without destination charges or platform transfers. Provisioning already requests GB accounts with full Stripe Dashboard access, Stripe requirement collection, connected-account fees, Stripe payment-loss responsibility, and `card_payments`. This matches the established model; the creation parameters and idempotency-key version were preserved. See [Stripe controller properties](https://docs.stripe.com/connect/migrate-to-controller-properties) and [direct charges](https://docs.stripe.com/connect/direct-charges?platform=web&ui=stripe-hosted).

Existing Account Links are generated server-side for the authenticated seller, restricted to HTTPS `connect.stripe.com`, and redirected through Stripe-hosted onboarding. The refresh GET only refreshes links for existing mappings; it never provisions accounts. The dynamic seller page retrieves the account directly from Stripe on each request, including returns from onboarding. A return URL never marks onboarding complete, consistent with [Stripe's return and refresh guidance](https://docs.stripe.com/connect/standard-accounts#handle-the-user-returning-to-your-platform).

## Changes

- Added **Seller Payments** to My Account tabs and the header account menu, using one shared navigation definition. The seller page includes the same tabs with an active-page indicator.
- Kept the existing **Set Up Seller Payments** action for new sellers and **Continue Stripe onboarding** for incomplete setups. Added a short explanation of Stripe's information collection and resumable setup.
- Aligned the seller states with the requested labels: **Not set up**, **Setup in progress**, **Verification required**, **Ready to accept payments**, and **Restricted**. A temporary configuration/provider error uses **Status unavailable**, so it does not misrepresent an account as restricted or permit replacement.
- Preserved the checkout readiness gate: GB, submitted details, `charges_enabled`, `payouts_enabled`, active `card_payments`, and no disabling reason. Added explicit regression coverage for each gate. No `transfers` capability is required for this direct-charge model.
- Won Auctions now explains that the order checks payment availability and uses **View payment options** before a checkout exists. The existing order page shows the verified reason when the seller is unmapped or not ready, and hides the payment action. No per-lot Stripe lookups were added to auction history.

No auction logic, checkout actions, webhook handlers, order state transitions, fulfilment logic, environment configuration, dependencies, or migration files were changed. Sandbox key and API-mode checks remain in place. No live charges or payouts were enabled.

## Migration and remaining setup

No new migration is needed, and no applied migration was edited. Confirm existing migration `019_seller_stripe_test_provisioning.sql` has been applied to the isolated sandbox Supabase project before releasing this UI. If it has not, review and apply that existing migration through the normal migration process. This session did not inspect hosted migration history or execute hosted SQL.

No new environment variable is required. Existing Cloudflare settings must refer to the same Stripe sandbox and isolated Supabase project: `STRIPE_TEST_SECRET_KEY`, `STRIPE_TEST_WEBHOOK_SECRET`, `STRIPE_TEST_CHECKOUT_ENABLED=true`, `STRIPE_TEST_APP_ORIGIN`, `STRIPE_TEST_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and public Supabase build variables. Preserve the connected-account webhook destination and subscriptions. Stripe Connect sandbox branding, UK account support, and account/link creation permissions must be configured as described in `SELLER_STRIPE_TEST_ONBOARDING.md`.

The local `.env.local` does not contain the private Stripe sandbox or service-role credentials. Therefore seller/browser tests use synthetic local Supabase and Stripe HTTP fixtures. They exercise application redirects and actual SDK requests, but intercept the Stripe-hosted screens. Real Stripe-hosted verification and the deployed Cloudflare bindings remain to be smoke-tested in the configured sandbox with a brand-new seller, an existing partially onboarded seller, and a fully onboarded test seller. No real seller identity or banking data was used.

## Validation

| Check | Result |
| --- | --- |
| `npm.cmd run typecheck` | Passed |
| `npm.cmd run lint` | Passed, zero warnings |
| `npm.cmd test` | 138 passed; zero failed or skipped |
| Selected browser suites with `TEST_STRIPE_CHECKOUT=1` | 24 passed; 2 payment-disabled cases skipped |
| Payment-disabled browser cases with `TEST_STRIPE_CHECKOUT=0` | Both previously skipped cases passed; 26 distinct browser cases passed overall |
| `npm.cmd run build` | Passed normally |
| `npm.cmd run build:worker` | Passed normally; generated `.open-next/worker.js` |

The browser run covers seller payments, account navigation/address management at mobile and desktop sizes, completed auctions, and transaction flows. Seller fixtures cover new setup, existing incomplete/additional-verification/ready mappings, concurrency, expired links, provider and bind failures, restrictions, temporary status failures, and account isolation. Transaction fixtures cover seller payment availability, direct-charge checkout, webhook settlement, expiry/retry, saved addresses, and delivery/collection. Database tests exercise migrations in local PGlite, including preservation of old mappings, private ownership/grants, idempotency, and recovery.

Browser development and the OpenNext config loader initially hit filesystem sandbox restrictions. Approved local runs outside that sandbox permit Wrangler's development registry/log writes and esbuild's parent-directory reads. OpenNext retains its Windows compatibility warning; browser development emits the existing Next.js image `localPatterns` advisory. No scripts or adapter settings were changed to bypass checks.

## Files changed in this change

| File | Purpose |
| --- | --- |
| `src/components/AccountNavigation.tsx` | Shared account tabs with Seller Payments |
| `src/components/AccountMenu.tsx` | Header menu uses the shared account links |
| `src/app/account/seller-payments/page.tsx` | Account navigation, explanatory copy, accurate unavailable state |
| `src/lib/seller-payment-status.ts` | Requested state labels and charge-model comment |
| `src/components/CompletedAuctions.tsx` | Buyer payment-availability guidance and link wording |
| `tests/browser-fixture.mjs` | Existing-seller and status-failure fixtures |
| `tests/browser/seller-payments.spec.ts` | Existing seller, lookup failure, navigation, and ownership coverage |
| `tests/browser/account-ui-refinements.spec.ts` | Shared navigation and responsive Seller Payments access |
| `tests/browser/transactions.spec.ts` | Won Auctions to seller-unavailable checkout coverage |
| `tests/seller-stripe-provisioning.test.mjs` | State labels and direct-card readiness matrix |
| `docs/PAYMENTS_AND_CONNECT_READINESS.md` | Updated self-service entry point |
| `docs/SELLER_PAYMENTS_SELF_SERVICE.md` | Findings, changed-file inventory, validation, and setup requirements |

No commit, push, upload, deployment, production SQL execution, or live-mode activation was performed.
