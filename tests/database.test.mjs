import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Actual PostgreSQL functions/triggers/RLS, with only Supabase's auth schema stubbed.
// PGlite is single-connection: multi-connection lock races still require staging.
let db;
const seller = '00000000-0000-0000-0000-000000000101';
const bidder = '00000000-0000-0000-0000-000000000102';
const other = '00000000-0000-0000-0000-000000000103';
const room = '10000000-0000-0000-0000-000000000007';
const first = '20000000-0000-0000-0000-000000000701';
const second = '20000000-0000-0000-0000-000000000702';
before(async () => {
  db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.users (instance_id uuid, id uuid primary key, aud text, role text,
      email text, encrypted_password text, email_confirmed_at timestamptz,
      raw_app_meta_data jsonb, raw_user_meta_data jsonb, is_super_admin boolean,
      created_at timestamptz, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable set search_path = ''
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema public, auth to anon, authenticated, service_role;
  `);
  const files = (await readdir(new URL('../supabase/migrations/', import.meta.url))).sort();
  for (const file of files) {
    if (file.startsWith('005')) {
      await db.exec(await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
      // Exercise the upgrade from the connected project's old test timings.
      await db.exec(`begin; select set_config('app.auction_lifecycle', 'true', true);
        update public.lots set preview_duration_seconds = 10, first_bid_duration_seconds = 10;
        commit;`);
    }
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  await db.query(`insert into auth.users (id, email_confirmed_at) values ($1, now()), ($2, now())`, [bidder, other]);
});
after(async () => { await db?.close(); });

async function fixture(fn) {
  await db.exec(`begin; select set_config('app.auction_lifecycle', 'true', true);
    delete from public.bids where lot_id in (select id from public.lots where room_id = '${room}');
    update public.lots set status = 'WAITING', ends_at = null, bid_count = 0,
      current_bid = starting_bid, highest_bidder_id = null, winning_bid = null,
      sold_at = null, unsold_at = null, next_eligible_at = now() - interval '1 day'
      where room_id = '${room}';
    select set_config('app.auction_lifecycle', 'false', true);`);
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function asUser(id, fn) {
  await db.exec('savepoint user_action');
  await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [id]);
  await db.exec('set local role authenticated');
  try { return await fn(); }
  catch (error) { await db.exec('rollback to savepoint user_action'); throw error; }
  finally { await db.exec('reset role; release savepoint user_action'); }
}
async function denied(fn, pattern) {
  await db.exec('savepoint expected_rejection');
  try { await assert.rejects(fn, pattern); }
  finally { await db.exec('rollback to savepoint expected_rejection; release savepoint expected_rejection'); }
}
async function row(id = first) {
  return (await db.query('select * from public.lots where id = $1', [id])).rows[0];
}
async function expire(id = first, seconds = 1) {
  await db.query(`select set_config('app.auction_lifecycle', 'true', true)`);
  await db.query(`update public.lots set ends_at = clock_timestamp() - $2 * interval '1 second' where id = $1`, [id, seconds]);
  await db.query(`select set_config('app.auction_lifecycle', 'false', true)`);
}
async function openFirstWindow() {
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  assert.equal((await row()).status, 'PREVIEW');
  await expire();
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  assert.equal((await row()).status, 'FIRST_BID_WINDOW');
}

test('migration chain upgrades seeded timings and pins every function search path', async () => {
  const bad = await db.query(`select id from public.lots where preview_duration_seconds <> 30 or first_bid_duration_seconds <> 30 or bid_extension_seconds <> 5 or requeue_delay_days <> 7`);
  assert.equal(bad.rows.length, 0);
  const functions = await db.query(`select proname, proconfig from pg_proc where pronamespace = 'public'::regnamespace and proname in ('place_bid','advance_room_lifecycle','set_lot_updated_at','prevent_direct_bid_insert','prevent_direct_lot_bid_state_update','publish_lot','advance_all_auction_rooms','handle_new_auction_user','start_next_lot_preview','start_next_lot_preview_at','advance_lot')`);
  assert.equal(functions.rows.length, 11);
  for (const f of functions.rows) assert.ok(f.proconfig.some(x => x.startsWith('search_path=')), f.proname);
});

test('preview rejects bids; first and later bids use a fresh five-second database deadline', () => fixture(async () => {
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  await assert.rejects(asUser(bidder, () => db.query('select public.place_bid($1, $2)', [first, 275])), /not open/);
  await expire();
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  await asUser(bidder, () => db.query('select public.place_bid($1, $2)', [first, 275]));
  const initial = await row();
  assert.equal(initial.status, 'ACTIVE_BIDDING');
  assert.equal(initial.bid_count, 1);
  assert.equal(initial.highest_bidder_id, bidder);
  const deadline = new Date(initial.ends_at).getTime();
  assert.ok(deadline - Date.now() > 3500 && deadline - Date.now() <= 5000);
  await assert.rejects(asUser(other, () => db.query('select public.place_bid($1, $2)', [first, 275])), /at least/);
  await asUser(other, () => db.query('select public.place_bid($1, $2)', [first, 325]));
  const next = await row();
  assert.equal(next.bid_count, 2);
  assert.equal(next.highest_bidder_id, other);
  assert.ok(new Date(next.ends_at).getTime() >= deadline);
}));

test('late bids reject and SOLD starts the next same-room preview', () => fixture(async () => {
  await openFirstWindow();
  await asUser(bidder, () => db.query('select public.place_bid($1, $2)', [first, 275]));
  await expire();
  await assert.rejects(asUser(other, () => db.query('select public.place_bid($1, $2)', [first, 325])), /ended/);
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  const sold = await row();
  assert.equal(sold.status, 'SOLD');
  assert.equal(Number(sold.winning_bid), 275);
  assert.equal(sold.highest_bidder_id, bidder);
  assert.equal((await row(second)).status, 'PREVIEW');
}));

test('no bid becomes UNSOLD for seven days, moves to queue end, and advances the room', () => fixture(async () => {
  await openFirstWindow(); await expire();
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  const unsold = await row();
  assert.equal(unsold.status, 'UNSOLD');
  assert.equal(new Date(unsold.next_eligible_at) - new Date(unsold.unsold_at), 7 * 86400000);
  assert.equal((await row(second)).status, 'PREVIEW');
  const max = (await db.query('select max(queue_position) as position from public.lots where room_id = $1', [room])).rows[0].position;
  assert.equal(unsold.queue_position, max);
}));

test('overdue recovery closes missed phases without reopening expired bid windows', () => fixture(async () => {
  await db.query('select public.advance_room_lifecycle($1)', [room]); await expire(first, 90);
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  assert.equal((await row()).status, 'UNSOLD');
  const active = await db.query(`select * from public.lots where room_id = $1 and status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING')`, [room]);
  assert.equal(active.rows.length, 1);
  assert.ok(new Date(active.rows[0].ends_at) > new Date());
}));

test('non-finite amounts, fractional pennies, self-bids, unverified users and inactive rooms reject', () => fixture(async () => {
  await openFirstWindow();
  for (const amount of ['NaN', 'Infinity', '-Infinity', '0', '-1', '275.001', '1000000000000']) {
    await assert.rejects(asUser(bidder, () => db.query('select public.place_bid($1, $2::numeric)', [first, amount])), /finite positive/);
  }
  await assert.rejects(asUser(seller, () => db.query('select public.place_bid($1, 275)', [first])), /own lot/);
  await db.query('update auth.users set email_confirmed_at = null where id = $1', [bidder]);
  await assert.rejects(asUser(bidder, () => db.query('select public.place_bid($1, 275)', [first])), /Confirm your email/);
  await db.query('update auth.users set email_confirmed_at = now() where id = $1', [bidder]);
  await db.query('update public.auction_rooms set is_active = false where id = $1', [room]);
  await assert.rejects(asUser(bidder, () => db.query('select public.place_bid($1, 275)', [first])), /unavailable/);
  await denied(() => db.query('select public.advance_room_lifecycle($1)', [room]), /unavailable/);
}));

test('RLS grants own draft access and rejects direct bid/state/timing writes or other sellers', () => fixture(async () => {
  const draft = (await asUser(seller, () => db.query(`insert into public.lots (room_id,seller_id,title,starting_bid) values ($1,$2,'Draft test',10) returning id`, [room, seller]))).rows[0].id;
  assert.equal((await asUser(seller, () => db.query('select id from public.lots where id = $1', [draft]))).rows.length, 1);
  assert.equal((await asUser(bidder, () => db.query('select id from public.lots where id = $1', [draft]))).rows.length, 0);
  await assert.rejects(asUser(seller, () => db.query(`update public.lots set bid_extension_seconds = 500 where id = $1`, [draft])), /permission denied/);
  await assert.rejects(asUser(seller, () => db.query(`update public.lots set status = 'WAITING' where id = $1`, [draft])), /permission denied/);
  await assert.rejects(asUser(bidder, () => db.query('select public.publish_lot($1)', [draft])), /not found/);
  await assert.rejects(asUser(bidder, () => db.query(`insert into public.bids (lot_id,bidder_id,amount) values ($1,$2,500)`, [first, bidder])), /permission denied/);
  await assert.rejects(asUser(bidder, () => db.query('select public.start_next_lot_preview($1)', [room])), /permission denied/);
  await assert.rejects(asUser(bidder, () => db.query('select public.advance_all_auction_rooms()')), /permission denied/);
  await asUser(seller, () => db.query('select public.publish_lot($1)', [draft]));
  assert.equal((await row(draft)).status, 'WAITING');
}));

test('anonymous visitors cannot see drafts or bid identities and new users get profiles', () => fixture(async () => {
  assert.equal((await db.query('select id from public.profiles where id = $1', [bidder])).rows.length, 1);
  await db.exec('set local role anon');
  try {
    await denied(() => db.query('select * from public.bids'), /permission denied/);
    await denied(() => db.query('select public.place_bid($1, 275)', [first]), /permission denied/);
  } finally { await db.exec('reset role'); }
}));

test('seven-day eligibility returns the same lot to the same room with a clean preview', () => fixture(async () => {
  await db.query(`select set_config('app.auction_lifecycle', 'true', true)`);
  await db.query(`update public.lots set status = 'UNSOLD', next_eligible_at = clock_timestamp() + interval '1 day' where room_id = $1`, [room]);
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  assert.equal((await row()).status, 'UNSOLD');
  await db.query(`update public.lots set next_eligible_at = clock_timestamp() - interval '1 second' where id = $1`, [first]);
  await db.query(`select set_config('app.auction_lifecycle', 'false', true)`);
  await db.query('select public.advance_all_auction_rooms()');
  const returned = await row();
  assert.equal(returned.status, 'PREVIEW');
  assert.equal(returned.room_id, room);
  assert.equal(returned.bid_count, 0);
  assert.equal(returned.highest_bidder_id, null);
  assert.equal(returned.winning_bid, null);
}));

test('database uniqueness prevents a second current lot in a room', () => fixture(async () => {
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  await db.query(`select set_config('app.auction_lifecycle', 'true', true)`);
  await denied(() => db.query(`update public.lots set status = 'PREVIEW', ends_at = now() + interval '30 seconds' where id = $1`, [second]), /unique/);
}));

test('the repository SQL integration scenario passes after release migration', async () => {
  await db.exec(await readFile(new URL('../supabase/tests/auction_lifecycle_integration.sql', import.meta.url), 'utf8'));
});
