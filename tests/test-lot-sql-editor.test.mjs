import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';

const directory = new URL('../supabase/operations/', import.meta.url);
const original = await readFile(new URL('cleanup_reviewed_test_lots.sql', directory), 'utf8');
const editor = await readFile(new URL('cleanup_reviewed_test_lots_sql_editor.sql', directory), 'utf8');
const review = await readFile(new URL('test_lot_review_list.sql', directory), 'utf8');
const verification = await readFile(new URL('verify_reviewed_test_lot_cleanup.sql', directory), 'utf8');
const hall = '20000000-0000-0000-0000-000000000701';
const realUser = '00000000-0000-0000-0000-000000000102';

function input(ids, { dryRun = true, count = ids.length, phrase = '' } = {}) {
  return editor.replace('  true,                 -- dry_run:', `  ${dryRun},                 -- dry_run:`)
    .replace('  0,                    -- expected_count:', `  ${count},                    -- expected_count:`)
    .replace("  '',                   -- confirmation:", `  '${phrase}',                   -- confirmation:`)
    .replace('$reviewed_ids$\n[]\n', `$reviewed_ids$\n${JSON.stringify(ids)}\n`);
}
function verify(ids, count = ids.length) {
  return verification.replace('expected_count integer := 0;', `expected_count integer := ${count};`)
    .replace('$reviewed_ids$\n[]\n', `$reviewed_ids$\n${JSON.stringify(ids)}\n`);
}
function grid(results) { return results.find(result => result.fields.some(field => field.name === 'row_type')).rows; }
async function snapshot(db) {
  const result = {};
  for (const table of ['lots','bids','watchlist','notifications','lot_images','profiles','auction_rooms']) {
    if ((await db.query('select to_regclass($1) as relation', [`public.${table}`])).rows[0].relation)
      result[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  }
  result.users = (await db.query('select * from auth.users order by id')).rows;
  return result;
}
async function withDb(fn, throughMigration = 8) {
  const db = await releaseDatabase({ throughMigration });
  try { await fn(db); } finally { await db.close(); }
}

test('SQL Editor version preserves the entire original locking/eligibility/deletion body verbatim', () => {
  const marker = '-- EXCLUSIVE blocks SELECT FOR UPDATE';
  const body = script => script.slice(script.indexOf(marker), script.indexOf('end;\n$$;', script.indexOf(marker)) + 'end;\n$$;'.length);
  assert.equal(body(editor), body(original));
});

test('read-only export produces 60 reviewable rows and a copyable eligible JSON list without changing data', () => withDb(async db => {
  const before = await snapshot(db);
  const rows = grid(await db.exec(review));
  const summary = rows.find(row => row.row_type === 'summary');
  assert.equal(summary.total_lots, 60); assert.equal(summary.eligible_count, 60);
  const ids = JSON.parse(summary.eligible_id_json);
  assert.equal(ids.length, 60); assert.equal(new Set(ids).size, 60);
  assert.equal(rows.filter(row => row.row_type === 'lot' && row.eligible).length, 60);
  assert.deepEqual(await snapshot(db), before);
}));

test('blank input and a populated dry run delete nothing, with a single usable summary grid', () => withDb(async db => {
  const before = await snapshot(db);
  const empty = grid(await db.exec(editor))[0].details;
  assert.equal(empty.dry_run, true); assert.equal(empty.deleted_lots, 0); assert.equal(empty.reviewed_count, 0);
  assert.equal(empty.ids_and_count_valid, false);
  const ids = before.lots.map(lot => lot.id);
  const rows = grid(await db.exec(input(ids)));
  const summary = rows[0].details;
  assert.equal(rows.length, 61);
  assert.equal(summary.reviewed_count, 60); assert.equal(summary.reviewed_eligible, 60);
  assert.equal(summary.ids_and_count_valid, true); assert.equal(summary.confirmation_matches, false);
  assert.equal(summary.deleted_lots, 0);
  assert.deepEqual(await snapshot(db), before);
}));

test('explicit confirmation and matching count delete only reviewed IDs; verifier checks the identical set', () => withDb(async db => {
  await assert.rejects(db.exec(input([hall], { dryRun: false })), /Explicit confirmation/); await db.exec('rollback');
  await assert.rejects(db.exec(input([hall], { dryRun: false, count: 2, phrase: 'DELETE REVIEWED TEST LOTS ONLY' })), /Explicit confirmation/); await db.exec('rollback');
  const before = await snapshot(db);
  const result = grid(await db.exec(input([hall], { dryRun: false, phrase: 'DELETE REVIEWED TEST LOTS ONLY' })))[0].details;
  assert.equal(result.deleted_lots, 1); assert.equal(result.reviewed_count, 1);
  const checked = grid(await db.exec(verify([hall])))[0].details;
  assert.equal(checked.all_approved_lots_removed, true); assert.equal(checked.approved_lots_remaining, 0);
  assert.equal(checked.images_remaining, 0); assert.equal(checked.notifications_remaining, 0);
  const after = await snapshot(db);
  assert.equal(after.lots.length, 59);
  for (const table of ['auction_rooms','profiles','users','bids']) assert.deepEqual(after[table], before[table]);
}));

test('all 60 reviewed IDs can be removed locally with the full source safeguards retained', () => withDb(async db => {
  const ids = JSON.parse(grid(await db.exec(review))[0].eligible_id_json);
  const result = grid(await db.exec(input(ids, { dryRun: false, phrase: 'DELETE REVIEWED TEST LOTS ONLY' })))[0].details;
  assert.equal(result.deleted_lots, 60);
  assert.equal(grid(await db.exec(verify(ids)))[0].details.all_approved_lots_removed, true);
  assert.equal((await db.query('select count(*) as count from public.auction_rooms')).rows[0].count, 12);
}));

test('export excludes real-account activity; editor rejects unsafe, unknown, duplicate and changed IDs', () => withDb(async db => {
  await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [realUser]);
  await db.query('insert into public.watchlist(user_id,lot_id) values($1,$2)', [realUser,hall]);
  const rows = grid(await db.exec(review));
  assert.equal(rows[0].eligible_count, 59);
  assert.ok(!JSON.parse(rows[0].eligible_id_json).includes(hall));
  assert.ok(rows.find(row => row.lot_id === hall).review_reason.includes('non-seed'));
  const before = await snapshot(db);
  await assert.rejects(db.exec(input([hall], { dryRun: false, phrase: 'DELETE REVIEWED TEST LOTS ONLY' })), /requires manual review/); await db.exec('rollback');
  const unknown = '90000000-0000-0000-0000-000000000001';
  const missing = grid(await db.exec(input([unknown])))[0].details;
  assert.equal(missing.missing_reviewed_ids, 1); assert.equal(missing.ids_and_count_valid, false);
  await assert.rejects(db.exec(input([unknown], { dryRun: false, phrase: 'DELETE REVIEWED TEST LOTS ONLY' })), /missing, has changed/); await db.exec('rollback');
  await assert.rejects(db.exec(input([hall,hall])), /duplicate key/); await db.exec('rollback');
  assert.deepEqual(await snapshot(db), before);
}));

test('verification refuses an empty/mismatched list and reports lots still present after only a dry run', () => withDb(async db => {
  await assert.rejects(db.exec(verification), /nonempty reviewed/); await db.exec('rollback');
  await assert.rejects(db.exec(verify([hall], 60)), /matching expected count/); await db.exec('rollback');
  const before = await snapshot(db);
  const result = grid(await db.exec(verify([hall])))[0].details;
  assert.equal(result.all_approved_lots_removed, false); assert.equal(result.approved_lots_remaining, 1);
  assert.deepEqual(await snapshot(db), before);
}));

test('SQL Editor and verifier also support an installation without notifications', () => withDb(async db => {
  await db.exec(input([hall], { dryRun: false, phrase: 'DELETE REVIEWED TEST LOTS ONLY' }));
  assert.equal(grid(await db.exec(verify([hall])))[0].details.all_approved_lots_removed, true);
}, 5));
