# Read-only test-lot inventory

Observed **12 October 2026, 00:04 BST**, using only the existing publishable/anon
key and read-only catalogue queries. No lifecycle RPC, cleanup, seed, account
change or scheduler change was executed against Supabase.

| Room | Public lots | UNSOLD / Returned |
| --- | ---: | ---: |
| The Jewellery Room | 5 | 5 |
| The Watch Room | 5 | 5 |
| The Art Room | 5 | 5 |
| The Collectibles Room | 5 | 5 |
| The Design Room | 5 | 5 |
| The Wine Room | 5 | 5 |
| The Grand Hall | 5 | 5 |
| The Antiques Room | 5 | 5 |
| The Library Room | 5 | 5 |
| The Dining Room | 5 | 5 |
| The Music Room | 5 | 5 |
| The Technology Room | 5 | 5 |
| **Total** | **60** | **60** |

Status counts in the visible catalogue: **UNSOLD = 60**; no other public status
was present at this observation. The catalogue showed:

- 60 lots carrying the original `20000000-0000-0000-0000-…` seed markers and
  seller UUID `00000000-0000-0000-0000-000000000101`.
- Zero lots reporting a positive `bid_count`.
- Zero lots with a public highest-bidder or winning-bid result.
- Zero public lots owned by a different seller UUID.

These observations identify **likely seed listings, not approved deletion
targets**. RLS hides drafts/inactive-room lots and private bids, watchlists,
notifications and Auth identity. The public count cannot establish that there
are no private bid records, account activity, genuine drafts, or changes to the
seed seller's identity. No lot is authorized for deletion by this report alone.

## Why Returned listings remain visible

`RETURNED` is not a separate database status in the current schema. The UI labels
`UNSOLD` as “Returned”/“No bids — returned to queue.” The lifecycle moves an unsold
lot to the end of its room's queue and sets `next_eligible_at` seven days later.
The Up Next query intentionally includes UNSOLD and renders its unavailable-until
date. Those rows are retained until reviewed cleanup; reaching a terminal state
does not delete a listing. This requeue rule is unchanged.

## Required private owner report before cleanup

Run `supabase/operations/test_lot_inventory.sql` in Supabase SQL Editor as the
database owner. It runs inside a read-only transaction and returns one table
with sections for all rooms (including empty/inactive rooms), every lot status,
all lots, seller identity checks, bids, watchlists, optional notifications,
images, foreign keys, DELETE triggers/rules, lifecycle functions and matching
Cron jobs. It works whether notifications migration 008 has been applied or not.

For each lot, `eligible_for_reviewed_cleanup` is true only when all of these hold:

- Exact original seed lot ID, room ID/slug, title, description, estimates,
  starting price, condition and shipping text match the source manifest.
- Seller Auth UUID/email/metadata and profile display name match the known seed
  account. Other accounts are treated as real or unverified.
- No bid rows, positive bid count, winning bidder, winning amount or sale result.
- Status and current amount are consistent with an unbid seed listing.
- No watchlist/notification record belongs to a non-seed account.
- Any associated image records match the seed identity and known image metadata.

Any failed condition receives a `review_reason` and is excluded. Bid/winner
history is always excluded, even if someone believes the bids were test bids.
Such records need a separate human decision; this cleanup script cannot be used
to override those protections. Unknown cascade paths, DELETE triggers or DELETE
rules cause the entire cleanup to stop for manual review.

The full owner result contains private account/dependency information. Review it
in the SQL Editor; the public snapshot committed here contains no private bid,
watchlist, notification or real-account details.

## Manual cleanup sequence

1. Review the owner inventory and take a database backup before applying deletion.
2. Open `cleanup_reviewed_test_lots.sql`. Keep the default `dry_run=true` first.
3. Enter only reviewed eligible UUIDs in `cleanup_approved_lots`. Do not add a
   query selecting every lot, a UUID-prefix filter or an unchecked seller filter.
4. Run that dry run and review the selected IDs, eligibility and dependencies.
   `deleted_lots` must be zero. It does not change persistent rows.
5. In the same reviewed script, set the control row to `false`, the exact number
   of approved IDs, and the phrase `DELETE REVIEWED TEST LOTS ONLY`. Run manually
   only when you approve those deletions. Any ineligible/missing/changed identity
   aborts the entire transaction. A repeat attempt after successful deletion
   refuses the now-missing IDs instead of deleting other listings.
6. Run the read-only inventory again. Expect zero lots only if all old listings
   were eligible and approved. Flagged/unreviewed/genuine records remain intact.
7. Verify all room cards remain and empty rooms show “No auctions currently
   available.” Check the scheduler's existing job is still active/succeeding.

The cleanup acquires EXCLUSIVE table locks, room-first, then lot/dependency locks.
These block scheduler/lifecycle/bidding writes while ordinary reads remain
available. Existing transactions finish before locks are acquired; subsequent
writers wait until commit/rollback. A five-second lock timeout and 30-second
statement timeout stop a busy cleanup safely. Only the seed account/profile rows
receive shared identity locks. No job is disabled, removed or recreated, and
all lifecycle functions remain unchanged. Keep the transaction short: database
deadlines continue to pass normally while writers briefly wait.

Only approved, eligible lots and their known seed-only watchlist/notification/
image records are deleted. Rooms and their metadata, real lots and bid history,
accounts, profiles, Auth records, functions and scheduler jobs are preserved.
No database reset, seed execution or TRUNCATE CASCADE is part of this procedure.
The scripts do not delete storage objects: current seed images are URLs/local
assets. Unrecognised uploads are excluded for manual review; shared room/background
assets remain intact.

The generation helper reads the seed's exact identity manifest without executing
it. It creates operation scripts only; they are outside `migrations/` and are not
part of automatic deployment. The optional public inventory helper performs only
SELECT/GET requests and can refresh the limited public snapshot.
