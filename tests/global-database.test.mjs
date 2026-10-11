import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';

const seller = '00000000-0000-0000-0000-000000000101';
const watcher = '00000000-0000-0000-0000-000000000102';
const bidder = '00000000-0000-0000-0000-000000000103';
const stranger = '00000000-0000-0000-0000-000000000104';
const room = '10000000-0000-0000-0000-000000000007';
const lot = '20000000-0000-0000-0000-000000000701';
let db;

before(async () => {
  db = await releaseDatabase();
  const before = (await db.query('select * from public.lots order by id')).rows;
  const bidsBefore = (await db.query('select * from public.bids order by id')).rows;
  for (const file of ['007_lot_watchlist_counts.sql', '008_account_notifications.sql']) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  }
  assert.deepEqual((await db.query('select * from public.lots order by id')).rows, before);
  assert.deepEqual((await db.query('select * from public.bids order by id')).rows, bidsBefore);
  assert.equal((await db.query('select * from public.notifications')).rows.length, 0);
  for (const id of [watcher, bidder, stranger]) await db.query('insert into auth.users(id,email_confirmed_at) values ($1,now())', [id]);
});
after(async () => { await db?.close(); });

async function fixture(fn) {
  await db.exec(`begin; select set_config('app.auction_lifecycle','true',true);
    update public.lots set status = 'WAITING', ends_at = null, bid_count = 0,
      current_bid = starting_bid, highest_bidder_id = null, winning_bid = null,
      sold_at = null, unsold_at = null, next_eligible_at = clock_timestamp() + interval '10 days'
      where room_id = '${room}';
    update public.lots set next_eligible_at = clock_timestamp() - interval '1 day' where id = '${lot}';
    delete from public.notifications;
    select set_config('app.auction_lifecycle','false',true);`);
  await db.query('insert into public.watchlist(user_id,lot_id) values ($1,$2)', [watcher, lot]);
  try { await fn(); } finally { await db.exec('rollback'); }
}
async function asUser(id, fn, role = 'authenticated') {
  await db.exec('savepoint client_action');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? '']);
  await db.exec(`set local role ${role}`);
  try { return await fn(); }
  catch (error) { await db.exec('rollback to savepoint client_action'); throw error; }
  finally { await db.exec('reset role; release savepoint client_action'); }
}
async function backdate(seconds) {
  await db.exec("select set_config('app.auction_lifecycle','true',true)");
  await db.query("update public.lots set ends_at = clock_timestamp() - make_interval(secs => $1) where id = $2", [seconds, lot]);
  await db.exec("select set_config('app.auction_lifecycle','false',true)");
}
const advance = () => db.query('select public.advance_room_lifecycle($1)', [room]);
const events = async () => (await db.query('select user_id,kind from public.notifications order by user_id,kind')).rows;

test('watched and seller live events arise at bidding open, once, not during preview or first bid', () => fixture(async () => {
  await advance();
  assert.deepEqual(await events(), []);
  await backdate(1); await advance();
  assert.deepEqual(await events(), [{ user_id: seller, kind: 'SELLER_LIVE' }, { user_id: watcher, kind: 'WATCHED_LIVE' }]);
  await advance(); await advance();
  await asUser(bidder, () => db.query('select public.place_bid($1,300)', [lot]));
  await asUser(bidder, () => db.query('select public.place_bid($1,350)', [lot]));
  assert.equal((await events()).length, 2);
}));

test('authoritative sale notifies watchers, seller and actual winner without exposing buyer data', () => fixture(async () => {
  await advance(); await backdate(1); await advance();
  await asUser(bidder, () => db.query('select public.place_bid($1,300)', [lot]));
  await backdate(1); await advance(); await advance();
  assert.deepEqual(await events(), [
    { user_id: seller, kind: 'SELLER_LIVE' }, { user_id: seller, kind: 'SELLER_SOLD' },
    { user_id: watcher, kind: 'WATCHED_LIVE' }, { user_id: watcher, kind: 'WATCHED_SOLD' },
    { user_id: bidder, kind: 'WON' },
  ]);
  const own = await asUser(watcher, () => db.query('select * from public.notifications'));
  assert.ok(own.rows.every(row => row.user_id === watcher));
  assert.ok(own.rows.every(row => !JSON.stringify(row).includes(bidder)));
}));

test('unsold notifies watchers once; a later auction run produces new events', () => fixture(async () => {
  await advance(); await backdate(1); await advance();
  await backdate(1); await advance(); await advance();
  assert.ok((await events()).some(row => row.kind === 'WATCHED_UNSOLD'));
  assert.equal((await events()).length, 3);
  await db.exec("select set_config('app.auction_lifecycle','true',true)");
  await db.query("update public.lots set next_eligible_at = clock_timestamp() - interval '1 day' where id = $1", [lot]);
  await db.exec("select set_config('app.auction_lifecycle','false',true)");
  await advance(); await backdate(1); await advance();
  assert.equal((await events()).filter(row => row.kind === 'WATCHED_LIVE').length, 2);
}));

test('notifications enforce owner read/update, read_at-only grants and no client generation', () => fixture(async () => {
  await advance(); await backdate(1); await advance();
  const id = (await db.query('select id from public.notifications where user_id=$1', [watcher])).rows[0].id;
  assert.equal((await asUser(stranger, () => db.query('select * from public.notifications'))).rows.length, 0);
  assert.equal((await asUser(stranger, () => db.query('update public.notifications set read_at=now() where id=$1 returning id', [id]))).rows.length, 0);
  assert.equal((await asUser(watcher, () => db.query('update public.notifications set read_at=now() where id=$1 returning id', [id]))).rows.length, 1);
  await assert.rejects(asUser(watcher, () => db.query("update public.notifications set user_id=$1 where id=$2", [stranger, id])), /permission denied/);
  await assert.rejects(asUser(watcher, () => db.query("update public.notifications set kind='WON' where id=$1", [id])), /permission denied/);
  await assert.rejects(asUser(watcher, () => db.query("insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run) values ($1,$2,'WON','Fake',now())", [watcher, lot])), /permission denied/);
  await assert.rejects(asUser(watcher, () => db.query('delete from public.notifications')), /permission denied/);
  await assert.rejects(asUser(null, () => db.query('select * from public.notifications'), 'anon'), /permission denied/);
  assert.equal((await db.query("select has_function_privilege('authenticated','public.notify_lot_transition()','EXECUTE') as allowed")).rows[0].allowed, false);
}));

test('watchlist aggregate is accurate and public without revealing records or private drafts', () => fixture(async () => {
  await db.query('insert into public.watchlist(user_id,lot_id) values ($1,$2)', [bidder, lot]);
  const counts = await asUser(null, () => db.query('select public.lot_watchlist_count($1) as count', [lot]), 'anon');
  assert.equal(Number(counts.rows[0].count), 2);
  await assert.rejects(asUser(null, () => db.query('select * from public.watchlist'), 'anon'), /permission denied/);
  assert.equal((await asUser(watcher, () => db.query('select * from public.watchlist'))).rows.length, 1);
  const draft = (await asUser(seller, () => db.query("insert into public.lots(room_id,seller_id,title,starting_bid) values ($1,$2,'Private draft',10) returning id", [room, seller]))).rows[0].id;
  await db.query('insert into public.watchlist(user_id,lot_id) values ($1,$2)', [seller, draft]);
  assert.equal(Number((await asUser(null, () => db.query('select public.lot_watchlist_count($1) as count', [draft]), 'anon')).rows[0].count), 0);
  await db.query('update public.auction_rooms set is_active=false where id=$1', [room]);
  assert.equal(Number((await asUser(null, () => db.query('select public.lot_watchlist_count($1) as count', [lot]), 'anon')).rows[0].count), 0);
}));

test('new notification and room publications retain existing lot realtime membership', async () => {
  const rows = (await db.query("select tablename from pg_publication_tables where pubname='supabase_realtime'")).rows;
  for (const table of ['lots', 'notifications', 'auction_rooms']) assert.ok(rows.some(row => row.tablename === table));
});
