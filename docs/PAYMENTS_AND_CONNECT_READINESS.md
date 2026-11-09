# Payments, fulfilment and Stripe Connect readiness

## Audit at the start of the work

| Area | Existing implementation | Gap |
| --- | --- | --- |
| Auction results and history | The database records the winning bidder and sale amount in the completed auction flow. Won Auctions and Sold Auctions are private, paginated and use bounded image reads. Migration 015 creates one fulfilment order per eligible sold lot. | Orders had no fixed postage, selected method or price in minor units. Older results without an identifiable buyer, seller or sold attempt still need operator review. |
| Orders, addresses and tracking | Participants could manage an order, select an address snapshot, add carrier and tracking information, report an issue and confirm receipt. Seller-reported delivery and buyer confirmation had distinct timestamps. | The seller could see a confirmed address and mark dispatch before payment. Collection had one generic state and no seller handover confirmation. |
| Messaging and security | Private messages, blocks, reports, an owner-only address book, order participant RLS, and validated transaction RPCs were already present. | New financial writes needed a separate trusted boundary. The collection process needed a private route for exact arrangements. |
| Notifications | Win and sale events were deduplicated. Messages, address confirmation, dispatch, tracking and receipt already had in-app notifications. | Payment, refund, dispute and collection transitions had no notifications. |
| Stripe and payouts | Seller profiles held display information. Payment was constrained to `NOT_RECORDED`. | No Stripe dependency, Checkout, Connect mapping, onboarding, webhook or settlement reconciliation. |
| Refunds, cancellations and disputes | The application could record private issue reports. Auction cancellation and relisting already existed. | Post-sale cancellation, refund initiation, dispute response, payout and non-paying-winner policy require decisions and an operator process. Auction cancellation is a separate operation. |

## What is implemented

- Sellers choose delivery only, collection only, or both. Delivery is limited to the United Kingdom, with an optional postcode-area allowlist, fixed GBP postage, service, handling time and descriptive restrictions. Collection uses a public town or general area. Exact arrangements go through the paid order or private messaging after payment. Existing listings retain their existing terms. Drafts need the new terms when they are first published.
- A completed order freezes the winning price and listing terms. Only the winner can start checkout. Postgres verifies the selected method, saved address ownership and delivery area, and computes the total in pence. Delivery restrictions are displayed as seller instructions. Postcode checks do not establish that a street address is deliverable.
- New orders release the buyer's address snapshot to the seller after verified payment. The seller can record dispatch and update tracking. The buyer can confirm receipt. Collection runs through preparation, readiness, arrangement, seller handover and buyer confirmation. Both methods support issue reporting. Earlier orders retain their existing address sharing and tracking workflow, with payment marked as unrecorded.
- Checkout and fulfilment appear separately in the order. History loads a single bounded status lookup per page. The existing catalogue and auction Realtime payloads continue to carry the `shipping_info` summary. Structured listing terms, orders, addresses and payment data are outside Realtime.
- Stripe Checkout runs only with an explicit sandbox configuration and an operator-assigned UK test seller. Stripe collects card and onboarding information. Supabase holds private account IDs, payment attempts, provider event IDs and payment adjustments. It does not receive payment card or bank details.
- One database reservation per order and a stable Stripe idempotency key prevent concurrent creates from producing multiple payable sessions. A declined card can retry the existing session. A verified expiry releases the reservation. A successful order retains its reservation through refunds and disputes.
- Signed webhooks retrieve the current provider session in the connected account's scope and verify mode, currency, amount, identifiers and metadata. Processing deduplicates event IDs atomically with status, audit and notifications. Refunds are tracked by refund ID, including failed refunds. Dispute resolution and payment capture resist stale events. Success redirects only display a status prompt.

## Charge-model decision

Stripe charge type determines where the charge sits and which balance funds refunds and chargebacks. Merchant of record follows the actual buyer-facing contract and responsibilities. Confirm the seller identity on the listing, Checkout, receipts, support and statement descriptor with Stripe before selecting a model. [Stripe charge models](https://docs.stripe.com/connect/charges) · [Stripe merchant of record](https://docs.stripe.com/connect/merchant-of-record)

| Model | Funds flow and operational implications | Fit for Nonstop Auctions |
| --- | --- | --- |
| Direct charges | The connected seller owns the charge and receives the funds in its Stripe balance. Refunds debit that account. Fee payer, dispute fees and negative-balance exposure depend on the approved account configuration. Settlement follows the seller's configured payout schedule. | Provisional recommendation for one seller per lot if each seller is the merchant of record, owns customer recourse and can fulfil on its own. The test harness exercises this model only in the sandbox. |
| Destination charges | The platform owns the charge and Stripe moves the seller's share to its connected balance with the charge. Stripe debits the platform for fees, refunds and disputes. The platform must handle transfer reversal where appropriate. The settlement merchant setting affects the buyer-facing presentation. | Revisit if the platform owns payment support and seller allocation is immediate. A transfer to a Stripe balance and a payout to a bank account are separate. |
| Separate charges and transfers | The platform owns the charge and explicitly controls transfers. The platform funds refunds and disputes and must reconcile transfers and reversals separately. | Consider if the platform needs to allocate funds later or to multiple parties. Confirm with Stripe and UK advisers whether the proposed delay and funds flow are supported before designing a release policy. |

## Local and staging setup

1. Use an isolated Supabase staging project with synthetic users and auctions. Review and apply migrations 016 and 017 after 015 in order. Review existing sold records with missing counterparties or attempts separately. Keep the deployed application and migrations in sync before accepting new seller submissions. Keep the existing participant-scoped messages publication from 015 and keep payment and address tables outside Realtime.
2. In a **Stripe sandbox**, complete the platform's Connect setup and branding. Provision a UK test connected account per staging seller using an account configuration that supports direct card charges and Account Links. Request the card payments capability and complete the test payout and verification requirements. Provision the account in the sandbox Dashboard or via an approved operator workflow. Associate its `acct_…` ID with the seller's Supabase profile UUID in `public.seller_stripe_test_accounts` using a trusted staging database operator. Verify the mapping before onboarding. Keep mappings private and avoid changing them during payment testing.
3. Set the following variables in the staging environment. For local Next.js use an ignored local environment file. For Workers preview use private variables or secrets and the relevant build variables. Use a dedicated test key. Checkout and onboarding start disabled.

| Variable | Value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Staging Supabase project URL and public key |
| `STRIPE_TEST_SUPABASE_URL` | Exact matching staging URL as a second explicit configuration check |
| `SUPABASE_SERVICE_ROLE_KEY` | Private staging service-role key used only by server-side payment code |
| `STRIPE_TEST_SECRET_KEY` | Stripe sandbox secret with the `sk_test_` prefix |
| `STRIPE_TEST_WEBHOOK_SECRET` | Signing secret for the sandbox connected-account endpoint or local Stripe CLI listener |
| `STRIPE_TEST_APP_ORIGIN` | Trusted staging HTTPS origin. Local HTTP loopback is also supported. |
| `STRIPE_TEST_CHECKOUT_ENABLED` | Set to `true` only for the isolated test environment after webhook setup |

4. In Stripe Workbench, add a sandbox **Connected accounts** snapshot event destination at `/api/stripe/webhook` on the staging HTTPS origin. Use the snapshot API version supported by the installed SDK. For local testing, Stripe CLI can forward Connect events with `stripe listen --forward-connect-to http://127.0.0.1:3000/api/stripe/webhook`. Put the listener's signing secret in the local environment for that process. [Connect webhooks](https://docs.stripe.com/connect/webhooks) · [Stripe CLI webhook testing](https://docs.stripe.com/webhooks#local-listener)

   - `checkout.session.completed`
   - `checkout.session.expired`
   - `payment_intent.payment_failed`, `payment_intent.succeeded`
   - `refund.created`, `refund.updated`, `refund.failed`
   - `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`

5. Sign in as the mapped seller and open **My Auctions → Seller payment setup**. Continue to Stripe's hosted onboarding and return to the seller page. If the link expires, use the button again to get a fresh link. The page and checkout check the Stripe account's actual verification status, card payments capability and charge and payout eligibility. They do not trust a return redirect as proof of readiness. [Stripe-hosted onboarding](https://docs.stripe.com/connect/hosted-onboarding)
6. Test with a fresh staging listing and three isolated accounts. Verify the actual hosted Checkout redirect, Stripe Connect scoping, card decline and retry, 3-D Secure, expiry, simultaneous requests, valid and forged webhook delivery, refund and dispute events, and buyer and seller views on the deployed Worker. Test delivery and collection separately. Test-mode orders use the same participant screens as other orders, so never attach test checkout to a database with real transactions.

The integration uses the official Stripe SDK with fetch and Web Crypto. It restricts the sandbox to card Checkout in GBP. The local sandbox accepts totals from £0.30 through £999,999.99. That ceiling is an application test limit. Stripe's limits vary with settlement currency and network. [Stripe currency limits](https://docs.stripe.com/currencies#minimum-and-maximum-charge-amounts)

### Recovery

- A checkout session expires two hours after reservation. An unknown create can be retried with the original key during the first hour. A known open session is reused. An unresolved create after that window fails closed. Browser refreshes and success redirects do not release reservations or settle orders.
- If a buyer returns after a payment or expiration and the order still shows pending, check the connected-account event in Stripe Workbench and redeliver it. A webhook 503 requires investigation or retry. Compare the attempt, session and PaymentIntent IDs, account scope and amounts before resolving an error. Never clear a reservation on a timer or because a buyer reports abandonment.
- If there is no session ID and no webhook, reconcile the attempt with Stripe in the original connected account and creation window using its `nonstop_test_attempt` metadata and Stripe request logs. Only a reviewed operator procedure may release a reservation after proving there is no payable session. A manual release tool is outside this change.
- Turning off the checkout switch prevents new sessions and onboarding. Keep the signing configuration available until outstanding sandbox attempts have reconciled. It is possible to receive signed Stripe events after the switch is turned off.

## Before any live activation

Approve the merchant of record and seller-account model, Stripe fee payer, seller commission or buyer fee, seller transfer and payout timing, responsibility for negative balances and disputes, payment deadlines, non-paying-winner treatment, cancellation, returns and refund process, and the evidence and liability standards for delivery and collection. The application adds no fees or taxes and issues no transfers, payouts, refunds or dispute responses.

Confirm UK consumer-rights and tax treatment for trader and private sellers, used and new goods, domestic and cross-border transactions, and the marketplace operator's obligations with advisers. Review the policy PDFs and privacy notice flagged in the existing messaging and fulfilment audit. Confirm retention of orders, payment evidence and addresses before handling live transactions. [GOV.UK distance selling](https://www.gov.uk/online-and-distance-selling-for-businesses) · [GOV.UK marketplace VAT](https://www.gov.uk/guidance/charging-vat-when-goods-are-sold-if-youre-an-online-marketplace-operator) · [GOV.UK returns and refunds](https://www.gov.uk/accepting-returns-and-giving-refunds)

## Change inventory

- Database migrations `016_listing_and_order_fulfilment.sql` and `017_stripe_test_checkout.sql`. Previously applied migrations are preserved.
- Seller listings `src/app/sell/page.tsx`, `src/components/SellerListingForm.tsx` and `src/components/ListingFulfilmentFields.tsx`.
- Orders and notices `src/app/orders/[lotId]/page.tsx`, `src/app/account/addresses/page.tsx`, `src/components/OrderManagement.tsx`, `src/components/OrderCheckout.tsx`, `src/components/CompletedAuctions.tsx`, `src/components/AccountNotifications.tsx`, `src/lib/completed-auctions.ts` and `src/lib/transactions.ts`.
- Stripe and seller account `src/lib/stripe-test.ts`, `src/lib/supabase/types.ts`, `src/app/checkout-actions.ts`, `src/app/api/stripe/webhook/route.ts`, `src/app/account/seller-payments/page.tsx`, `src/components/SellerOnboardingButton.tsx` and `src/app/my-auctions/page.tsx`.
- Configuration `.env.example`, `.dev.vars.example`, `package.json` and `package-lock.json`.
- Tests `tests/database.test.mjs`, `tests/browser-fixture.mjs`, `tests/helpers/stripe-fetch-fixture.mjs`, `tests/browser/seller.spec.ts`, `tests/browser/seller-relisting.spec.ts`, `tests/browser/storage-images.spec.ts` and `tests/browser/transactions.spec.ts`.

## Verification scope

- TypeScript, lint, Next.js production build and OpenNext Worker build passed. The automated suite passed all 116 tests, including 19 database and RLS tests.
- The full browser run passed 55 tests. The enabled checkout fixture passed separately, and all 14 affected seller and image checks passed after the final change to keep structured terms outside the live auction payload.
- Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:database`, `npm run test:browser`, `npm run build` and `npm run build:cloudflare`.
- The regular Playwright suite keeps payment actions disabled and checks the checkout breakdown at mobile and desktop widths. Set `TEST_STRIPE_CHECKOUT=1` and run `npm run test:browser -- tests/browser/transactions.spec.ts -g "sandbox checkout opens"` for the local enabled checkout test. It uses an intercepted Stripe API, synthetic credentials and a Stripe SDK-signed fixture event.
- PostgreSQL integration tests apply the migration chain locally and exercise permissions, checkout reservations, capture, failure, expiry, refund reordering, disputes and both fulfilment methods. Hosted Supabase with real JWTs, concurrent database connections and Stripe-hosted test payments on the staging Worker remain separate acceptance checks.
