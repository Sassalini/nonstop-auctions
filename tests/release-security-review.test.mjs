import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';

const seller = '00000000-0000-0000-0000-000000000101';
const other = '00000000-0000-0000-0000-000000000102';
const room = '10000000-0000-0000-0000-000000000007';
const first = '20000000-0000-0000-0000-000000000701';

async function asRole(db, role, id, fn) {
  await db.exec('savepoint client_action');
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id ?? '']);
  await db.exec(`set local role ${role}`);
  try { return await fn(); }
  catch (error) { await db.exec('rollback to savepoint client_action'); throw error; }
  finally { await db.exec('reset role; release savepoint client_action'); }
}

test('owner policies restrict draft/image edits, profile updates and watchlists', async () => {
  const db = await releaseDatabase();
  try {
    await db.query('insert into auth.users (id, email_confirmed_at) values ($1, now())', [other]);
    await db.exec('begin');
    const draft = (await asRole(db, 'authenticated', seller, () => db.query(
      `insert into public.lots (room_id, seller_id, title, starting_bid) values ($1,$2,'Review draft',10) returning id`,
      [room, seller]))).rows[0].id;
    const image = (await asRole(db, 'authenticated', seller, () => db.query(
      `insert into public.lot_images (lot_id, image_url) values ($1,'https://example.com/review.jpg') returning id`, [draft]))).rows[0].id;
    assert.equal((await asRole(db, 'authenticated', seller, () => db.query(
      `update public.lots set title = 'Own edit' where id = $1 returning id`, [draft]))).rows.length, 1);
    assert.equal((await asRole(db, 'authenticated', seller, () => db.query(
      `update public.lot_images set alt_text = 'Own image edit' where id = $1 returning id`, [image]))).rows.length, 1);
    assert.equal((await asRole(db, 'authenticated', other, () => db.query(
      `select id from public.lots where id = $1`, [draft]))).rows.length, 0);
    assert.equal((await asRole(db, 'authenticated', other, () => db.query(
      `update public.lots set title = 'Attack' where id = $1 returning id`, [draft]))).rows.length, 0);
    assert.equal((await asRole(db, 'authenticated', other, () => db.query(
      `delete from public.lot_images where id = $1 returning id`, [image]))).rows.length, 0);
    await assert.rejects(asRole(db, 'authenticated', other, () => db.query(
      `insert into public.lot_images (lot_id, image_url) values ($1,'https://example.com/attack.jpg')`, [draft])), /row-level security/);
    await assert.rejects(asRole(db, 'authenticated', seller, () => db.query(
      `update public.lot_images set lot_id = $1 where id = $2`, [first, image])), /permission denied/);
    await asRole(db, 'authenticated', seller, () => db.query('select public.publish_lot($1)', [draft]));
    assert.equal((await asRole(db, 'authenticated', seller, () => db.query(
      `update public.lots set title = 'Published edit' where id = $1 returning id`, [draft]))).rows.length, 0);
    assert.equal((await asRole(db, 'authenticated', seller, () => db.query(
      `delete from public.lot_images where id = $1 returning id`, [image]))).rows.length, 0);
    await assert.rejects(asRole(db, 'authenticated', seller, () => db.query(
      `update public.lots set ends_at = now(), current_bid = 1 where id = $1`, [draft])), /permission denied/);
    await assert.rejects(asRole(db, 'authenticated', other, () => db.query(
      `insert into public.watchlist (user_id, lot_id) values ($1,$2)`, [seller, first])), /row-level security/);
    await asRole(db, 'authenticated', seller, () => db.query(
      `insert into public.watchlist (user_id, lot_id) values ($1,$2)`, [seller, first]));
    assert.equal((await asRole(db, 'authenticated', other, () => db.query(
      `select id from public.watchlist where user_id = $1`, [seller]))).rows.length, 0);
    assert.equal((await asRole(db, 'authenticated', other, () => db.query(
      `delete from public.watchlist where user_id = $1 returning id`, [seller]))).rows.length, 0);
    assert.equal((await asRole(db, 'authenticated', other, () => db.query(
      `update public.profiles set display_name = 'Attack' where id = $1 returning id`, [seller]))).rows.length, 0);
    assert.equal((await asRole(db, 'authenticated', seller, () => db.query(
      `update public.profiles set display_name = 'Own profile' where id = $1 returning id`, [seller]))).rows.length, 1);
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('migration 005 allows anonymous lifecycle mutations; proposal removes client execution', async () => {
  const db = await releaseDatabase();
  try {
    await db.exec(`begin; select set_config('app.auction_lifecycle', 'true', true)`);
    await db.query(`update public.lots set ends_at = clock_timestamp() - interval '90 seconds' where id = $1`, [first]);
    await db.query(`select set_config('app.auction_lifecycle', 'false', true)`);
    await asRole(db, 'anon', null, () => db.query('select public.advance_room_lifecycle($1)', [room]));
    assert.equal((await db.query('select status from public.lots where id = $1', [first])).rows[0].status, 'UNSOLD');
    await db.exec('rollback');
    // Apply the draft only to this disposable in-memory database.
    await db.exec(await readFile(new URL('../supabase/proposals/006_restrict_lifecycle_execution.sql', import.meta.url), 'utf8'));
    for (const role of ['anon', 'authenticated']) {
      const access = await db.query(`select has_function_privilege($1, 'public.advance_room_lifecycle(uuid)', 'EXECUTE') as allowed`, [role]);
      assert.equal(access.rows[0].allowed, false);
    }
    await db.exec('begin');
    await assert.rejects(asRole(db, 'anon', null, () => db.query('select public.advance_room_lifecycle($1)', [room])), /permission denied/);
    await assert.rejects(asRole(db, 'authenticated', seller, () => db.query('select public.advance_room_lifecycle($1)', [room])), /permission denied/);
    await asRole(db, 'service_role', null, () => db.query('select public.advance_all_auction_rooms()'));
    assert.equal((await db.query(`select has_function_privilege('authenticated', 'public.place_bid(uuid,numeric)', 'EXECUTE') as allowed`)).rows[0].allowed, true);
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('public catalogue exposes stable identity columns despite private bid history', async () => {
  const db = await releaseDatabase();
  try {
    const access = await db.query(`select has_column_privilege('anon', 'public.lots', 'highest_bidder_id', 'SELECT') as highest,
      has_column_privilege('anon', 'public.lots', 'seller_id', 'SELECT') as seller`);
    assert.deepEqual(access.rows[0], { highest: true, seller: true });
    await db.exec('begin');
    await assert.rejects(asRole(db, 'anon', null, () => db.query('select * from public.bids limit 1')), /permission denied/);
    await db.exec('rollback');
  } finally { await db.close(); }
});

test('hosted security inventory is one read-only result grid', async () => {
  const db = await releaseDatabase();
  try {
    // Storage catalogue stub only; hosted Storage permissions are not simulated.
    await db.exec(`create schema storage; create table storage.buckets (
      id text primary key, public boolean, file_size_limit bigint, allowed_mime_types text[]
    )`);
    await db.exec('begin read only');
    const results = await db.exec(await readFile(new URL('../supabase/operations/release_security_inventory.sql', import.meta.url), 'utf8'));
    assert.equal(results.length, 1);
    assert.equal(results[0].rows.filter(row => row.category === 'policy').length, 15);
    assert.equal(results[0].rows.filter(row => row.category === 'function_access').length, 8);
    assert.ok(results[0].rows.find(row => row.category === 'unsold_summary'));
    await db.exec('rollback');
  } finally { await db.close(); }
});
