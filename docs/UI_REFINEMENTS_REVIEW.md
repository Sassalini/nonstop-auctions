# UI and navigation refinements

Implemented locally on 7 November 2026. No commit, push, deployment or production SQL execution was performed.

## Changes

- Removed the standalone Won Auctions header link and the Account text entry. My account keeps its existing dashboard destination. A small accessible chevron preserves the account dropdown and its destinations. Authentication, Sign out, notifications, search, watchlist and main navigation remain in place.
- Added shared account navigation in this order: Won Auctions, Sold Auctions, Messages, Delivery Addresses. Delivery Addresses sits on the right on wider screens; mobile uses two columns. Existing routes, conversation query strings, history pagination and sold-section anchors remain supported.
- Reused the existing Supabase address book and transaction actions. Addresses support adding, editing, deleting, multiple entries and a single default. The address query explicitly filters by the authenticated user in addition to existing RLS. Added delivery-instruction display, browser autofill, save feedback and network-error handling. Cancelling an edit now resets the default checkbox.
- Reduced footer padding and spacing, consolidated all six original PDF links into two columns and removed Sell an Item, My Auctions and the Marketplace heading. Policy documents and their URLs are unchanged.
- Extended each room photograph across the whole card, including its status area. Replaced the opaque status strip with a lightly translucent treatment; status mapping, badges, arrows, borders and hover behaviour remain intact.
- Converted the supplied gold gavel PNG to a five-size ICO at `src/app/favicon.ico` (16, 32, 48, 64 and 256 pixels). Next.js provides the favicon metadata automatically; no competing icon metadata was added. The header logo is unchanged.

## Files changed

| File | Purpose |
| --- | --- |
| `src/components/AccountMenu.tsx` | Simplified header entries; retained account dropdown. |
| `src/components/AccountNavigation.tsx` | New reusable account navigation. |
| `src/app/my-auctions/page.tsx` | Shared navigation above existing seller history/dashboard. |
| `src/app/won-auctions/page.tsx` | Shared navigation above existing buyer history. |
| `src/app/messages/page.tsx` | Shared navigation around existing messaging functionality. |
| `src/app/account/addresses/page.tsx` | Shared navigation and explicit authenticated-owner filter. |
| `src/components/AddressBook.tsx` | Address form feedback, autofill, default reset and saved instructions. |
| `src/components/AppFooter.tsx` | Compact footer retaining all six policy links. |
| `src/components/AuctionRoomCard.tsx` | Continuous photograph and translucent status area. |
| `src/app/favicon.ico` | Supplied favicon converted to ICO. |
| `tests/browser/account-ui-refinements.spec.ts` | New responsive UI, navigation, address persistence/privacy, policy and favicon checks. |
| `tests/browser-fixture.mjs` | Test address fixture now enforces ownership and a single default per user. |
| `tests/database.test.mjs` | Additional real PostgreSQL address ownership/default/edit/delete coverage. |
| `docs/UI_REFINEMENTS_REVIEW.md` | This review report. |

## Database and Supabase

No new migration or Supabase configuration change is required by this refinement. The account features reuse `supabase/migrations/015_transactions_and_messages.sql`, its `delivery_addresses` table, owner RLS policy and `transaction_action` RPC. If that earlier migration has not yet been applied to a target environment, it remains a prerequisite to be reviewed and applied manually. Its SQL was not changed or executed against a hosted project here.

Order-specific address snapshots remain separate. Existing database tests verify that editing or deleting a saved address does not alter confirmed order delivery details. Addresses are not stored in localStorage, added to public profiles/listings, or subscribed to through a new Realtime channel. Messaging, unread counts and notification handling retain their existing implementation.

Auction lifecycle, bidding, seller payouts, payment architecture, photo variants and egress optimisation code were not changed.

## Validation completed

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed. |
| `npm run lint` | Passed with zero warnings. |
| `npm test` | 113 tests passed. |
| `npm run test:database` | All 16 database tests passed, including address ownership, defaults and order snapshots. |
| `npm run test:browser` | All 52 browser tests passed. |
| Additional account-menu browser run | Both 320px and 1280px checks passed after adding explicit dropdown and My account navigation assertions. |
| `npm run build` | Passed. |
| `npm run build:cloudflare` | Passed; generated `.open-next/worker.js`. |
| Production favicon smoke check | Local production server returned HTTP 200 and `image/x-icon`; a single icon link appeared in page metadata. Source ICO, Next.js output and Cloudflare asset bytes matched. |
| `git diff --check` | Passed. |

New browser checks cover 320px, 390px, 768px and 1440px room/footer layouts, readable WAITING/PREVIEW statuses, photographs covering the status region, six unchanged PDF URLs with valid PDF responses, address editing/deletion/default selection, reload persistence, a separate browser session signed into the same account, and another account seeing no saved addresses. Account navigation, existing conversations and the My account button/dropdown were exercised. Mobile account, desktop footer and room-card screenshots were visually inspected.

The full regression suite also passed notification ownership/read state/reconnection checks, bidding/timer checks, Auto-play/manual navigation, completed-auction history and pagination, seller submission/relisting, bounded catalogue reads, idle egress, signed-image token rotation and stored image variants.

## Remaining limits

No unresolved implementation failures were found. The first restricted local runs encountered file/network permission errors; the checks and Cloudflare build passed with the required local access. OpenNext still prints its existing Windows compatibility advisory.

Validation used local HTTP fixtures and local PostgreSQL, not live user accounts or a hosted Supabase project. Cross-device persistence was exercised with isolated browser sessions backed by the fixture; actual address persistence and isolation were also tested against the existing PostgreSQL schema/RPC/RLS. Hosted Realtime authorization and concurrent multi-connection database behaviour remain staging checks described in `docs/MESSAGING_AND_FULFILMENT.md`. Production has not been deployed or tested.
