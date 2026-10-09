import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';

const summary = await readFile(new URL('../supabase/operations/release_preflight_summary.sql', import.meta.url), 'utf8');

test('preflight returns one combined table and executes in a read-only transaction', async () => {
  const db = await releaseDatabase();
  try {
    await db.exec('begin read only');
    const results = await db.exec(summary);
    assert.equal(results.length, 1);
    assert.deepEqual(results[0].fields.map(field => field.name), ['check_name', 'status', 'details']);
    assert.equal(results[0].rows.length, 12);
    for (const row of results[0].rows) {
      assert.equal(row.status, row.check_name === 'Public-schema RLS policies' ? 'WARN' : 'PASS', row.details);
      assert.ok(row.details.length > 0);
    }
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('preflight detects data and catalogue failures without invoking lifecycle functions', async () => {
  const db = await releaseDatabase({ release: false });
  try {
    // Corrupt only this disposable local database to exercise diagnostic failures.
    await db.exec(`
      alter table public.lots disable trigger user;
      alter table public.bids disable trigger user;
      drop index public.lots_one_active_per_room_idx;
      update public.lots set status = 'PREVIEW', ends_at = null,
        starting_bid = 'NaN'::numeric, preview_duration_seconds = 10;
      insert into public.bids (lot_id, bidder_id, amount)
        select id, seller_id, 'NaN'::numeric from public.lots limit 1;
    `);
    const rows = (await db.query(summary)).rows;
    for (const name of ['Invalid monetary values', 'Invalid bid amounts',
      'Duplicate current lots per room', 'Missing deadlines',
      'Auction timing values: 30 / 30 / 5 / 7', 'Function search_path settings']) {
      assert.equal(rows.find(row => row.check_name === name).status, 'FAIL', name);
    }
    await db.exec(`
      alter table public.lots alter column preview_duration_seconds set default 10;
      alter table public.lots disable row level security;
      alter publication supabase_realtime drop table public.lots;
    `);
    const changed = (await db.query(summary)).rows;
    for (const name of ['Auction timing column defaults: 30 / 30 / 5 / 7',
      'Public-schema RLS coverage', 'public.lots realtime publication membership']) {
      assert.equal(changed.find(row => row.check_name === name).status, 'FAIL', name);
    }
    assert.ok(changed.find(row => row.check_name === 'Function search_path settings').details.includes('MISSING FUNCTION'));
  } finally { await db.close(); }
});
