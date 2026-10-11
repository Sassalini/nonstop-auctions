import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';

const inventory = await readFile(new URL('../supabase/operations/test_lot_inventory.sql', import.meta.url), 'utf8');
const cleanup = await readFile(new URL('../supabase/operations/cleanup_reviewed_test_lots.sql', import.meta.url), 'utf8');
const seller = '00000000-0000-0000-0000-000000000101';
const realUser = '00000000-0000-0000-0000-000000000102';
const hall = '20000000-0000-0000-0000-000000000701';

function confirmed(ids) {
  return cleanup.replace("insert into cleanup_control values (true,0,'');", `insert into cleanup_control values (false,${ids.length},'DELETE REVIEWED TEST LOTS ONLY');`)
    .replace('create temporary table cleanup_preview', `insert into cleanup_approved_lots values ${ids.map(id => `('${id}')`).join(',')};\ncreate temporary table cleanup_preview`);
}
async function snapshot(db) {
  const result = {};
  for (const table of ['lots','bids','watchlist','lot_images','auction_rooms','profiles','notifications']) {
    if (!(await db.query('select to_regclass($1) as relation', [`public.${table}`])).rows[0].relation) continue;
    result[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  }
  result.users = (await db.query('select * from auth.users order by id')).rows;
  result.functions = (await db.query("select oid,prosrc from pg_proc where pronamespace='public'::regnamespace order by oid")).rows;
  return result;
}
async function withDb(fn, latest = true) {
  const db = await releaseDatabase({ throughMigration: latest ? 8 : 5 });
  try { await fn(db); } finally { await db.close(); }
}
const reportRows = async db => (await db.exec(inventory)).find(result => result.fields.some(field => field.name === 'section')).rows;

test('owner inventory is read-only and classifies all original seed lots with every room/status/dependency', () => withDb(async db => {
  const before = await snapshot(db);
  const rows = await reportRows(db);
  assert.equal(rows.filter(row => row.section === 'room_counts').length, 12);
  assert.ok(rows.filter(row => row.section === 'room_counts').every(row => row.details.lots === 5));
  const summary = rows.find(row => row.section === 'summary').details;
  assert.equal(summary.lots, 60); assert.equal(summary.unsold_returned, 12);
  assert.equal(summary.eligible_for_reviewed_cleanup, 60);
  assert.equal(rows.filter(row => row.section === 'image_dependency').length, 60);
  assert.deepEqual(await snapshot(db), before);
}));

test('default dry run changes no persistent rows or functions, even with all rooms populated', () => withDb(async db => {
  const before = await snapshot(db);
  const results = await db.exec(cleanup);
  const preview = results.find(result => result.fields.some(field => field.name === 'eligible')).rows;
  assert.equal(preview.length, 60); assert.ok(preview.every(row => row.eligible && !row.approved));
  const result = results.find(result => result.fields.some(field => field.name === 'deleted_lots')).rows[0];
  assert.deepEqual(result, { dry_run: true, deleted_lots: 0 });
  assert.deepEqual(await snapshot(db), before);
}));

test('reviewed seed cleanup clears all rooms and dependencies while preserving accounts, rooms, scheduler and functions', () => withDb(async db => {
  await db.exec("create schema cron; create table cron.job(jobid bigint,jobname text,schedule text,active boolean,command text); insert into cron.job values(1,'nonstop-auction-lifecycle','1 second',true,'select public.advance_all_auction_rooms();')");
  await db.query('insert into public.watchlist(user_id,lot_id) values($1,$2)', [seller,hall]);
  await db.query("insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run) values($1,$2,'SELLER_LIVE','Seed notice',now())", [seller,hall]);
  const before = await snapshot(db);
  const ids = before.lots.map(lot => lot.id);
  await db.exec(confirmed(ids));
  const after = await snapshot(db);
  for (const table of ['lots','bids','watchlist','lot_images','notifications']) assert.equal(after[table].length, 0);
  for (const table of ['auction_rooms','profiles','users','functions']) assert.deepEqual(after[table], before[table]);
  assert.equal((await db.query('select active from cron.job')).rows[0].active, true);
  await db.query('select public.advance_all_auction_rooms()');
  assert.equal((await db.query('select * from public.lots')).rows.length, 0);
}));

test('real sellers, edited seed identity, watchlists, notifications and bid/winner history are excluded', () => withDb(async db => {
  await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())', [realUser]);
  const first = hall;
  const second = '20000000-0000-0000-0000-000000000702';
  const third = '20000000-0000-0000-0000-000000000703';
  const fourth = '20000000-0000-0000-0000-000000000704';
  await db.query('insert into public.watchlist(user_id,lot_id) values($1,$2)', [realUser,first]);
  await db.query("insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run) values($1,$2,'WATCHED_LIVE','Private',now())", [realUser,second]);
  await db.query("update public.lots set title='Real catalogue edit' where id=$1", [third]);
  await db.exec("begin; select set_config('app.auction_lifecycle','true',true); select set_config('app.place_bid','true',true)");
  await db.query('insert into public.bids(lot_id,bidder_id,amount) values($1,$2,200)', [fourth,realUser]);
  await db.query("update public.lots set status='SOLD',highest_bidder_id=$2,winning_bid=200,current_bid=200,bid_count=1,sold_at=now() where id=$1", [fourth,realUser]);
  await db.exec('commit');
  const genuine = (await db.query("insert into public.lots(room_id,seller_id,title,starting_bid) values('10000000-0000-0000-0000-000000000007',$1,'Real user listing',20) returning id", [realUser])).rows[0].id;
  const rows = await reportRows(db);
  for (const id of [first,second,third,fourth,genuine]) {
    const lot = rows.find(row => row.section === 'lot' && row.record_id === id).details;
    assert.equal(lot.eligible_for_reviewed_cleanup, false); assert.ok(lot.review_reason.length);
  }
  const before = await snapshot(db);
  await assert.rejects(db.exec(confirmed([fourth])), /requires manual review/); await db.exec('rollback');
  assert.deepEqual(await snapshot(db), before);
  const eligible = rows.filter(row => row.section === 'lot' && row.details.eligible_for_reviewed_cleanup).map(row => row.record_id);
  await db.exec(confirmed(eligible));
  assert.equal((await db.query('select * from public.lots')).rows.length, 5);
  assert.deepEqual((await db.query('select * from public.bids order by id')).rows, before.bids);
  assert.deepEqual((await db.query('select * from auth.users order by id')).rows, before.users);
}));

test('unknown cascade paths, delete triggers, stale IDs and missing confirmation abort the whole cleanup', () => withDb(async db => {
  await db.exec('create table public.external_history(id uuid primary key,lot_id uuid references public.lots(id) on delete cascade)');
  await assert.rejects(db.exec(confirmed([hall])), /Unreviewed foreign-key/); await db.exec('rollback');
  await db.exec('drop table public.external_history');
  await db.exec("create function public.unreviewed_delete() returns trigger language plpgsql as $$ begin return old; end $$; create trigger unreviewed_delete after delete on public.lots for each row execute function public.unreviewed_delete()");
  await assert.rejects(db.exec(confirmed([hall])), /Unreviewed DELETE trigger/); await db.exec('rollback');
  await db.exec('drop trigger unreviewed_delete on public.lots; drop function public.unreviewed_delete()');
  await assert.rejects(db.exec(confirmed(['90000000-0000-0000-0000-000000000001'])), /missing, has changed/); await db.exec('rollback');
  await assert.rejects(db.exec(cleanup.replace('(true,0,', '(false,0,')), /Explicit confirmation/); await db.exec('rollback');
  assert.equal((await db.query('select count(*) as count from public.lots')).rows[0].count, 60);
}));

test('report and cleanup support older installations without notifications', () => withDb(async db => {
  assert.equal((await reportRows(db)).find(row => row.section === 'summary').details.notifications_table_present, false);
  await db.exec(confirmed([hall]));
  assert.equal((await db.query('select count(*) as count from public.lots')).rows[0].count, 59);
}, false));
