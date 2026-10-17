# Using the reviewed test-lot cleanup in Supabase SQL Editor

Nothing was deleted because the original script deliberately starts with:

```sql
insert into cleanup_control values (true,0,'');
```

The values are, in order, `dry_run`, `expected_count`, `confirmation`. Its
`cleanup_approved_lots(lot_id)` table is empty: the example INSERT is commented
out. Running the inventory does not automatically approve its eligible rows.

This guide and the new scripts were prepared locally. No SQL was run against
production. The original operation scripts, website UI, security rules and
auction lifecycle have not been changed.

## 1. Review eligibility and obtain the UUIDs

Run the entire `test_lot_review_list.sql` as the database owner in SQL Editor.
This is the same read-only inventory/assessment with a more convenient output.
It returns a summary row and one row per lot, including excluded lots.

- `summary.total_lots` is the number of all lots, not the approved count.
- `summary.eligible_count` is the number satisfying all existing cleanup checks.
- Review the lot rows: room, title, UUID, `eligible`, `review_reason`, bid/winner
  evidence and non-seed account dependencies. Use the full original inventory
  when inspecting individual bids, watchlists, notifications, images or accounts.
- Only after reviewing the eligible rows, copy the summary cell
  `eligible_id_json`. It is a valid JSON array of their exact UUIDs.
- If all 60 are eligible and reviewed, the array has 60 IDs. If fewer qualify,
  do not force 60 or add excluded IDs: approve only the reviewed eligible subset.
  Do not infer eligibility from a UUID prefix, room name or seller UUID alone.

If using the original `test_lot_inventory.sql` output instead, select rows where
`section = 'lot'` and `details.eligible_for_reviewed_cleanup = true`; their
`record_id` values are the lot UUIDs. The `summary` row also reports the eligible
and manual-review counts. Copy only the lot UUIDs, not dependency record IDs.

The original inventory's custom setting is transaction-local and cleared by its
COMMIT. A separate later query cannot recover that result from the setting;
rerun the new review-list script rather than relying on a previous SQL session.

## 2. Populate the SQL Editor cleanup input

Open `cleanup_reviewed_test_lots_sql_editor.sql`. Edit only the marked input
block near the top. Its four fields are:

| Field | First reviewed dry run | Actual application |
| --- | --- | --- |
| `dry_run` | `true` | `false` |
| `expected_count` | Number of reviewed UUIDs | Same number |
| `confirmation` | `''` | `'DELETE REVIEWED TEST LOTS ONLY'` |
| `reviewed_lot_ids` | Reviewed UUID JSON array | Identical reviewed array |

Replace the `[]` between the `$reviewed_ids$` delimiters with the copied array.
Leave both delimiters and `::jsonb` intact. This is the block for 60 reviewed
eligible lots, before inserting the UUID list:

```sql
insert into cleanup_editor_input values (
  true,
  60,
  '',
  $reviewed_ids$
[]
  $reviewed_ids$::jsonb
);
```

The empty brackets are a placeholder, not an approval. Replace them before
running. The array must contain UUID strings in double quotes, separated by
commas, as provided by `eligible_id_json`. Keep that reviewed list in your saved
SQL text for both application and verification.

The input is copied into temporary `cleanup_control` and
`cleanup_approved_lots` tables, and cannot insert/update production lots or
accounts. Duplicate/invalid IDs fail rather than being silently corrected.
These temporary tables are dropped at COMMIT; approvals do not persist in the
database or carry between SQL Editor runs.

Run the **entire script, including BEGIN and COMMIT**, not only selected lines.

## 3. Run and interpret the dry run

Keep `dry_run=true` and run the entire populated SQL Editor script. One grid
contains a summary row followed by each entered UUID. For 60 eligible approvals:

| Summary field | Expected |
| --- | --- |
| `dry_run` | `true` |
| `deleted_lots` | `0` |
| `expected_count` | `60` |
| `reviewed_count` | `60` |
| `reviewed_eligible` | `60` |
| `missing_reviewed_ids` | `0` |
| `ineligible_reviewed_ids` | `0` |
| `ids_and_count_valid` | `true` |
| `confirmation_matches` | `false` is normal when the phrase is blank |

Each `reviewed_lot` row must show `eligible=true`, `missing=false`, an empty
`review_reason`, and the intended room/title. `total_eligible_in_inventory` can
be larger than your reviewed subset; it is not a deletion target list.
If the count is zero, no IDs were pasted. Missing or ineligible IDs mean stop
and review; do not disable checks or force application.

In the original script the equivalent outputs are `cleanup_preview`
(`lot_id`, `eligible`, `approved`, `details`) and `cleanup_result`
(`dry_run`, `deleted_lots`). Default unapproved rows show `approved=false`.
The new version combines the useful summary and selected rows in one grid.

Dry run performs no persistent deletes. It does briefly take the same locks and
recheck the same database evidence as application. COMMIT during a dry run does
not enable deletion: it releases the locks and drops the temporary tables.

## 4. Enable actual deletion, only after approving the dry-run results

Take a database backup. In the same populated input block, replace these lines:

```sql
  true,
  60,
  '',
```

with:

```sql
  false,
  60,
  'DELETE REVIEWED TEST LOTS ONLY',
```

Leave the reviewed UUID array unchanged. If approving a different number, use
that exact number instead of 60. Then manually run the entire script once.

Success should show `dry_run=false` and `deleted_lots=60` for 60 approved IDs.
The final COMMIT is the actual deletion commit. The per-ID rows describe the
evidence captured immediately before deletion; they are not post-cleanup reads.

The script revalidates after acquiring locks; the dry run is not a permanent
eligibility guarantee. Any missing, changed, ineligible or unreviewed record
causes the entire cleanup to abort. Do not rerun a successful apply blindly:
already-deleted IDs correctly fail the missing-ID check. If SQL Editor reports
an aborted transaction, run `ROLLBACK;` before trying a corrected script again.

## 5. Using the original script instead

All three controls and the explicit list must be populated within the original
transaction. For a dry run with 60 reviewed IDs, change its control line to:

```sql
insert into cleanup_control values (true,60,'');
```

Immediately after creating `cleanup_approved_lots`, insert all reviewed IDs:

```sql
-- EXAMPLE syntax only: use your complete reviewed list, not just these two IDs.
insert into cleanup_approved_lots(lot_id) values
  ('20000000-0000-0000-0000-000000000701'),
  ('20000000-0000-0000-0000-000000000702');
```

If only those two were approved, the expected count would be 2, not 60. For
application after a successful 60-ID dry run, the original control line becomes:

```sql
insert into cleanup_control values (false,60,'DELETE REVIEWED TEST LOTS ONLY');
```

Leave the original safety body unchanged. The SQL Editor version is easier
because its reviewed list can be pasted directly as JSON instead.

## 6. Verify that the identical reviewed set was removed

Open `verify_reviewed_test_lot_cleanup.sql`. Set `expected_count integer := 60;`
(or your actual approved number), and paste the identical reviewed UUID array
between its `$reviewed_ids$` delimiters. Run the entire read-only script.

Expect the summary to show your reviewed count, `approved_lots_remaining=0`,
`all_approved_lots_removed=true`, and zero remaining bid/watchlist/image/
notification records linked to those approved IDs. An empty or mismatched list
is rejected so an empty selection cannot produce a misleading success.

Also rerun the owner inventory. To inspect rooms and their remaining lots:

```sql
select r.id, r.name, r.slug,
       count(l.id) as lots_remaining,
       count(l.id) filter (where l.status='UNSOLD') as unsold_returned_remaining
from public.auction_rooms r
left join public.lots l on l.room_id=r.id
group by r.id, r.name, r.slug
order by r.name;
```

Every room should still exist. Zero total lots is expected only if there were
no unrelated/genuine lots; do not delete genuine rows just to make totals zero.

## 7. Protections verified

The SQL Editor wrapper retains the original locking, eligibility and deletion
body verbatim. It only changes input/output presentation. Existing checks:

- Require exact original seed identities/catalogue and verified seed account.
- Reject real/unknown sellers, edited data, unrecognised images, non-seed
  watchlist/notification activity, any bid rows/bid counts, winning records or
  sale results. Bidding/winner history is never authorized for deletion.
- Reject unknown foreign-key cascade paths, DELETE triggers or DELETE rules.
- Lock rooms first, then lots/dependencies, and share-lock the seed identity
  during checks; scheduler/lifecycle writes wait until transaction end.
- Require a nonempty exact ID list, matching expected count and exact phrase
  for application; mismatch rolls back every deletion.
- Delete only approved lots and known seed-only dependencies. No Auth/profile/
  room deletion, database reset, seed execution or TRUNCATE CASCADE.

Local verification: 14 SQL tests passed across the original cleanup and new
editor/export/verifier scripts, including dry runs, all 60 IDs, unsafe/duplicate/
missing IDs, real accounts/dependencies, rollback and older schemas without
notifications. No production data was read or changed during this work.

## 8. Optional scheduler pause/resume

Normally no pause is required because the cleanup's locks prevent interference.
If lock contention requires a brief maintenance pause, inspect the existing job
first and record its job ID, active flag, schedule and command:

```sql
select jobid, jobname, schedule, command, active
from cron.job
where jobname='nonstop-auction-lifecycle';
```

Proceed only if this returns the single expected job. If it is already inactive,
do not resume it later without knowing why. If no job is returned, or more than
one appears, stop and review; an external scheduler may need its own controls.

For the one expected, originally active job, pause future scheduling:

```sql
select cron.alter_job(jobid, active := false)
from cron.job
where jobname='nonstop-auction-lifecycle' and active;
```

Perform the reviewed cleanup and verification promptly. Restore the same job
only if you paused it and its ID matches what you recorded:

```sql
select cron.alter_job(jobid, active := true)
from cron.job
where jobname='nonstop-auction-lifecycle' and not active;
```

This keeps the job, command and schedule. Do not use `cron.unschedule` to pause:
it removes the job. `cron.alter_job(..., active := false)` is the documented
deactivation interface: [pg_cron documentation](https://github.com/citusdata/pg_cron#altering-a-cron-job).

Pausing future Cron scheduling does not guarantee an already-running call has
stopped and does not stop browser/server recovery calls. Auction deadlines also
continue to pass. Keep all cleanup locks/checks; do not cancel sessions, change
deadlines or alter lifecycle functions. After resuming, verify the job is active
and inspect recent runs:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname='nonstop-auction-lifecycle';

select jobid, status, start_time, end_time, return_message
from cron.job_run_details
where jobid in (
  select jobid from cron.job where jobname='nonstop-auction-lifecycle'
)
order by start_time desc
limit 10;
```

These are instructions for manual execution only. No scheduler settings were
changed while preparing this guide.
