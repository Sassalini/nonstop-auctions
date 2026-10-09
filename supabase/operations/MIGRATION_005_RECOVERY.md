# Check and recover migration 005

Run these files in Supabase SQL Editor as `postgres`, against the intended project. They are separate operations scripts; the original migration 005 is unchanged. Nothing is automatically deployed or executed remotely.

The duplicate-constraint error proves that named constraint exists, not that the whole migration is complete. The original file contains `BEGIN`/`COMMIT`; an error in a whole-file transactional run rolls back that run. Earlier successful runs or separately executed fragments may still exist.

## Start with the read-only check

Run **`check_migration_005.sql`**. It returns one result grid with `category`, `item`, `status`, `expected`, and `actual`:

| Status | Meaning |
| --- | --- |
| `APPLIED` | Matches migration 005's reference state, including a validated constraint where applicable. |
| `MISSING` | An expected object/setting or user profile is absent. |
| `DIFFERENT` | The object exists but differs, or legacy timings remain. Review both JSON columns. |
| `UNEXPECTED` | An additional policy or public auction-table trigger needs manual review. It will not be removed automatically. |
| `INFO` | Migration 005 adds **no columns**. Baseline column checks concern migrations 001–004. |
| `BASELINE_PRESENT` / `BASELINE_MISSING` | Realtime membership comes from migration 004, **not 005**. |

The check covers all four new constraints: `lots_release_timings_check`, `lots_finite_money_check`, `bids_finite_money_check`, and `lots_release_result_check`. It checks their definitions and validation status, all twelve affected functions, policies, effective table/column/function privileges (including grant options and inherited/PUBLIC access), RLS enablement, profile/legacy-timing counts, the profile trigger and existing protection triggers, and both new indexes (`lots_highest_bidder_id_idx`, `watchlist_lot_id_idx`).

Function bodies are compared using fingerprints alongside ownership, language, security mode, argument names, return types, volatility and settings. PostgreSQL formatting changes or intentionally customized bodies/expressions can produce `DIFFERENT`; this does not automatically prove a vulnerability. Four existing functions were only given pinned search paths by 005; their reference bodies come from migrations 001–004. The recovery also leaves those bodies alone.

This is an audit of the actual database state, not proof of a migration-history entry. It does not test bid concurrency, hosted Auth, Realtime delivery or Cron execution. It assumes the project's existing tables and Supabase roles; a missing baseline should be investigated rather than recreated blindly.

Run **`release_preflight.sql`** separately for historical monetary/result errors, missing deadlines and duplicate current lots. Review every result. Do not proceed if invalid records need investigation.

## Decide whether recovery is needed

- If all migration-related rows are `APPLIED`, **do not run migration 005 again**. No recovery is needed. Proceed to the remaining release checks.
- If expected objects/permissions are missing or old, and the differences are understood, use **`recover_migration_005.sql`**, the idempotent version of 005.
- If constraints/indexes/triggers have conflicting definitions, baseline columns/functions are missing, ownership is unexpected, or custom policies/triggers are present, resolve the specific mismatch first. Recovery deliberately aborts instead of dropping such objects, changing columns or deleting records.
- A missing Realtime publication/table membership is a separate migration-004 baseline issue. Recovery reports but does not change it; do not rerun migration 004 over the release functions.

## Run recovery only when needed

1. Take a backup. Pause bidding and **every** scheduler advancing these rooms. Pausing traffic does not freeze existing database deadlines.
2. Run the **whole** `recover_migration_005.sql` file in one SQL Editor execution as `postgres`. It wraps its changes in a transaction, takes table locks, and uses a five-second lock timeout and two-minute statement timeout. A lock timeout means retry during a quieter maintenance window, not bypass the guards.
3. If it errors, the transaction's changes are rolled back. If a persistent connection is left in an aborted transaction, run `ROLLBACK;`. Do not continue selected fragments after a failure.
4. Run `check_migration_005.sql` and `release_preflight.sql` again. Inspect any remaining differences before reopening bidding or enabling a scheduler. Verify Supabase Advisors and staging acceptance checks too.

Recovery adds only missing constraints and validates matching unvalidated ones. It leaves matching constraints/indexes in place, creates missing indexes, uses `CREATE OR REPLACE FUNCTION` for the eight release function bodies, and reapplies the fourteen release policy definitions and their intended grants/revokes. Known policy definitions are dropped/recreated **inside the transaction**; this does not delete table records. The unchanged baseline auction-room policy is checked and preserved. The profile trigger is created only if missing, and expected triggers/RLS are enabled.

Only two types of data changes occur: inactive lots with legacy durations are normalized to **30/30/5/7** (their `updated_at` trigger also runs), and missing profiles are inserted for existing Auth users without overwriting existing profiles. A running lot with nonstandard timings causes an abort rather than a deadline change. Existing auction states, deadlines, bids, winners, queue positions and catalogue content are preserved. Invalid money/results cause failure for manual review; they are not erased or silently repaired.

Neither script installs extensions, creates Cron jobs, changes Realtime publications, adds columns, drops tables/columns, or removes production rows. Scheduler activation remains a separate release action after verification.

## Local verification

Recovery tests run real PostgreSQL SQL through PGlite with a minimal Supabase Auth schema. They cover a fully applied database, the exact duplicate-timings-constraint situation on an otherwise old baseline, partial functions/policies/grants/indexes, matching unvalidated constraints, repeated execution, preservation of active/sold auction data, invalid-data rollback, conflicting object definitions, legacy timings, and unchanged Realtime membership. These are local tests, not a certification of the hosted project.

For maintainers: `node scripts/build-migration-005-recovery.mjs` regenerates the two SQL files from the unchanged migration and a local reference database. It never uses hosted credentials. Review generated changes before use. Run `npm test` and `npm run lint` after regeneration.
