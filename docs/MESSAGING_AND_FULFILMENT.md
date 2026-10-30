# Messaging and fulfilment implementation

## Deployment review

Apply `supabase/migrations/015_transactions_and_messages.sql` manually after 014, following review and a database backup. No production SQL was executed by this implementation. The migration backfills one order per existing SOLD lot with an identifiable buyer and seller, references the existing SOLD auction attempt, and installs an additive trigger for future completed sales. It does not update lots, bids, winners, sale prices or auction lifecycle functions. Review legacy SOLD records missing a buyer, seller or matching attempt separately; never invent their identities or prices.

Verify `private_messages` is in `supabase_realtime` and authenticated Postgres Changes is enabled in the project. Subscriptions use the signed-in JWT and SELECT RLS participant checks; channel names are not an authorization boundary. No public broadcast channels are used. Only INSERT is subscribed to, with a bounded, debounced history reload. Do not add addresses, orders or reports to Realtime publication. Test with real staging JWTs and three isolated accounts before launch; the local PostgreSQL tests do not exercise the hosted Realtime authorization service or multi-connection lock races.

## Routes and data boundaries

- `/messages`: paginated conversation list, unread count, paginated 30-message history, active-thread Realtime, report/block/unblock and limited message deletion.
- `/account/addresses`: private 20-entry address book, add/edit/delete/default.
- `/orders/[lotId]`: buyer/seller-only order, address snapshot confirmation/correction before dispatch, courier/tracking/notes, collection, dispatch, seller delivery report, buyer receipt and issue reporting.
- Won Auctions and Sold Auctions link to the same order route; listings offer Contact seller.

RLS SELECT policies: address_owner, order_participants, event_participants, conversation_participants, message_participants, block_owner, report_owner. Direct client mutation grants are absent. `transaction_action` verifies relationships using auth.uid(), locks account mutations and orders, enforces version checks, validates input and writes audit events and notifications in the same transaction. Ten messages/minute, 200/day, 20 new buyer conversations/hour and 20 reports/day limit abuse. Duplicate message requests share a caller-generated idempotency UUID. A repeated unchanged order update is a no-op. All definer functions pin search_path and revoke default PUBLIC execution.

No personal email is returned. Notifications contain event labels/listing context, never message bodies or delivery details. Order pages and message pages are dynamic authenticated routes. Tracking URLs are generated from fixed Royal Mail, UPS or FedEx HTTPS origins with escaped reference values; arbitrary user-entered URLs are never used as links.

## Retention, reports and operator actions

Users may remove saved addresses without changing order snapshots. Their own non-transaction, unreported messages may be tombstoned. Transaction messages and reported evidence cannot be removed through the client. `purge_nontransaction_messages(cutoff)` is service-role/operator only, requires an explicit cutoff at least 30 days old, and preserves every transaction conversation and reported message. It is not scheduled automatically. Decide and document the business retention period before using this tool; 30 days is a safety floor, not a published retention promise.

Reports persist privately in transaction_reports for manual review by trusted operators. No new moderation dashboard, automatic refund, external alert or dispute adjudication is included. Operators must establish a review process before launch. Cancellation is reserved for trusted operator intervention; clients cannot set CANCELLED or payment status. Account deletion is deliberately restricted by retained transaction references: process verified erasure requests manually, assess required transaction/evidence retention and anonymise eligible personal fields through a reviewed operator procedure. Do not blindly cascade-delete transaction history.

Blocks stop non-transaction contact; unresolved order participants can still communicate to fulfil or resolve the sale. Delivered/cancelled transactions do not bypass blocks. Text-only messages; no attachments, external courier APIs, payment APIs or paid dependencies.

## Policy review (documents preserved)

The supplied Privacy Policy PDF has one page with no readable policy text (its content stream paints a white background and one whitespace glyph). Replace it with the intended approved document before launching personal-data features. The privacy notice needs to explain private messages, address books, order-specific sharing with sellers, reports/moderation access, retention/erasure and hosting/processors.

Seller Policy sections 6 and 10 discuss delivery responsibility, tracking and responding to buyers. The new service/tracking fields and buyer communication support those described activities. Review the accuracy of seller address use restrictions, abusive messaging, address correction and collection procedures.

Terms sections 6 and 8 discuss delivery details and dispute evidence including messages. Review how reports are handled and explain the distinction between seller-reported delivery, buyer receipt and independent carrier evidence. Terms and Seller Policy describe Stripe payments, verification, fees and payouts; these remain unimplemented here. Terms also retain a business/service-address placeholder and reference a `/returns` process. These operational/policy gaps require owner review; no legal wording or PDF was changed.

## Payment and delivery limitations

Payment state is constrained to NOT_RECORDED. Dispatch never proves payment. Carrier links provide navigation only: no carrier evidence, tracking webhook, delivery verification, refunds, escrow, payout, shipping labels or automated dispute resolution. Only buyer confirmation sets DELIVERED. Seller delivery reports have a separate timestamp and do not set DELIVERED. Existing auction results remain authoritative for winner and sale price.

## Changed files for this feature

- `supabase/migrations/015_transactions_and_messages.sql`
- `src/lib/transactions.ts`, `src/lib/transaction-account.ts`, `src/lib/supabase/types.ts`
- `src/app/transaction-actions.ts`, `src/app/messages/page.tsx`, `src/app/account/addresses/page.tsx`, `src/app/orders/[lotId]/page.tsx`, `src/app/lots/[lotId]/page.tsx`
- `src/components/TransactionControls.tsx`, `AddressBook.tsx`, `MessageThread.tsx`, `OrderManagement.tsx`, `AccountMenu.tsx`, `AccountNotifications.tsx`, `CompletedAuctions.tsx`
- `tests/database.test.mjs`, `tests/browser-fixture.mjs`, `tests/browser/transactions.spec.ts`
- This handover document. Prior footer and PDF asset changes remain in the workspace.

## Validation results

- Lint and TypeScript checks passed.
- Full automated suite: 112 passed; final database suite: 15 passed, including buyer/seller/third-account RLS, idempotency, rate limiting, notifications, snapshots, dispatch locks, receipt, audit events and operator-only retention.
- Full browser suite initially: 41 passed, 4 failed due to account-header width. After the responsive header correction, all 19 affected browser checks passed. The other 26 browser checks had passed in the full run, including auction flow and image/egress checks.
- Extended buyer-to-seller handover tests passed at 390px and 1280px: address save/confirmation, text message, seller shipping/tracking, buyer tracking link and receipt confirmation. Their first run exposed an overly strict test label selector; switching to the shipping combobox role resolved it.
- Next.js and OpenNext production builds passed. OpenNext reports its existing Windows compatibility warning; no deployment occurred.
- Hosted Supabase Realtime authorization, concurrent transactions across separate database connections and a production smoke test remain staging checks, not locally verified claims.
