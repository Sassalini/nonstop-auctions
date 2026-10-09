import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';

const auditSQL = await readFile(new URL('../supabase/operations/check_migration_005.sql', import.meta.url), 'utf8');
const recoverySQL = await readFile(new URL('../supabase/operations/recover_migration_005.sql', import.meta.url), 'utf8');
const readAudit = async db => (await db.query(auditSQL)).rows;
function applied(rows) {
  assert.deepEqual(rows.filter(row => !['APPLIED','INFO','BASELINE_PRESENT'].includes(row.status)), []);
}
async function snapshot(db) {
  const result = {};
  for (const table of ['lots','bids','auction_rooms','lot_images','profiles','watchlist']) {
    result[table] = (await db.query(`select * from public.${table} order by id`)).rows;
  }
  result.users = (await db.query('select * from auth.users order by id')).rows;
  result.publications = (await db.query(`select * from pg_publication_tables order by pubname,schemaname,tablename`)).rows;
  return result;
}
async function withDatabase(options, fn) {
  const db = await releaseDatabase(options);
  try { await fn(db); } finally { await db.close(); }
}
async function recover(db) { await db.exec(recoverySQL); }
async function failRecovery(db, pattern) {
  await assert.rejects(recover(db), pattern);
  await db.exec('rollback');
}

test('005 catalogue audit matches the full migration and does not write data', () => withDatabase({}, async db => {
  const before = await snapshot(db);
  const rows = await readAudit(db);
  applied(rows);
  assert.equal(rows.filter(row => row.category === 'constraint').length, 4);
  assert.equal(rows.filter(row => row.category === 'function').length, 12);
  assert.equal(rows.filter(row => row.category === 'index').length, 2);
  assert.deepEqual(await snapshot(db), before);
}));

test('recovery handles the duplicate timings constraint on an otherwise old baseline', () => withDatabase({ release: false }, async db => {
  await db.exec(`alter table public.lots add constraint lots_release_timings_check check (
    preview_duration_seconds = 30 and first_bid_duration_seconds = 30
    and bid_extension_seconds = 5 and requeue_delay_days = 7);`);
  const rows = await readAudit(db);
  assert.equal(rows.find(r => r.item === 'public.lots.lots_release_timings_check').status, 'APPLIED');
  assert.equal(rows.find(r => r.item === 'public.lots.lots_finite_money_check').status, 'MISSING');
  assert.equal(rows.find(r => r.category === 'function' && r.item === 'public.place_bid(uuid,numeric)').status, 'DIFFERENT');
  const before = await snapshot(db);
  await recover(db); await recover(db);
  applied(await readAudit(db));
  assert.deepEqual(await snapshot(db), before);
}));

test('repeated recovery preserves bids, active deadlines, sold winners and all rows', () => withDatabase({}, async db => {
  await db.exec(`begin;
    insert into auth.users(id,email_confirmed_at) values ('00000000-0000-0000-0000-000000000102',now());
    select set_config('app.place_bid','true',true);
    insert into public.bids(lot_id,bidder_id,amount) values
      ('20000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000102',300),
      ('20000000-0000-0000-0000-000000000702','00000000-0000-0000-0000-000000000102',400);
    update public.lots set status = 'SOLD', current_bid = 300, bid_count = 1,
      highest_bidder_id = '00000000-0000-0000-0000-000000000102', winning_bid = 300,
      sold_at = now() - interval '1 day', ends_at = now() - interval '1 day'
      where id = '20000000-0000-0000-0000-000000000701';
    update public.lots set status = 'ACTIVE_BIDDING', current_bid = 400, bid_count = 1,
      highest_bidder_id = '00000000-0000-0000-0000-000000000102', ends_at = now() + interval '1 day'
      where id = '20000000-0000-0000-0000-000000000702';
    commit;`);
  const before = await snapshot(db);
  const constraintOids = (await db.query(`select oid from pg_constraint where conname like '%release_%' order by oid`)).rows;
  await recover(db); await recover(db);
  applied(await readAudit(db));
  assert.deepEqual(await snapshot(db), before);
  assert.deepEqual((await db.query(`select oid from pg_constraint where conname like '%release_%' order by oid`)).rows, constraintOids);
}));

test('partial policy/function/index/ACL changes are detected and restored', () => withDatabase({}, async db => {
  await db.exec(`drop policy "Users can read their own bids" on public.bids;
    drop policy "Users can create their own profile" on public.profiles;
    drop trigger on_auction_user_created on auth.users;
    drop function public.handle_new_auction_user();
    drop index public.watchlist_lot_id_idx;
    grant update on public.lots to authenticated;
    grant execute on function public.publish_lot(uuid) to anon with grant option;
    create or replace function public.place_bid(lot_id uuid, bid_amount numeric) returns public.lots
      language plpgsql security definer set search_path = '' as $$ begin return null; end; $$;`);
  const rows = await readAudit(db);
  for (const item of ['public.bids.Users can read their own bids','public.watchlist_lot_id_idx','public.handle_new_auction_user()']) {
    assert.ok(rows.some(r => r.item === item && r.status === 'MISSING'));
  }
  assert.ok(rows.some(r => r.category === 'function_acl' && r.item === 'public.publish_lot(uuid)' && r.status === 'DIFFERENT'));
  const before = await snapshot(db);
  await recover(db); applied(await readAudit(db));
  assert.deepEqual(await snapshot(db), before);
}));

test('recovery validates a matching NOT VALID constraint without replacing it', () => withDatabase({}, async db => {
  await db.exec(`alter table public.lots drop constraint lots_release_timings_check;
    alter table public.lots add constraint lots_release_timings_check check (
    preview_duration_seconds = 30 and first_bid_duration_seconds = 30
    and bid_extension_seconds = 5 and requeue_delay_days = 7) not valid;`);
  const before = await snapshot(db);
  await recover(db); applied(await readAudit(db));
  assert.deepEqual(await snapshot(db), before);
}));

test('wrong same-name constraints and indexes abort without dropping them', () => withDatabase({}, async db => {
  await db.exec(`alter table public.lots drop constraint lots_release_timings_check;
    alter table public.lots add constraint lots_release_timings_check check (preview_duration_seconds > 0);`);
  const before = await snapshot(db);
  await failRecovery(db, /constraint .*different definition/);
  assert.deepEqual(await snapshot(db), before);
  assert.match((await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'lots_release_timings_check'`)).rows[0].def, /> 0/);
  await db.exec(`alter table public.lots drop constraint lots_release_timings_check;
    drop index public.lots_highest_bidder_id_idx;
    create index lots_highest_bidder_id_idx on public.lots(seller_id);`);
  await failRecovery(db, /index .*incompatible or invalid/);
  assert.deepEqual(await snapshot(db), before);
}));

test('unknown RLS policies and missing baseline columns require manual review', () => withDatabase({}, async db => {
  await db.exec(`create policy "custom production policy" on public.lots for select using (true);`);
  assert.ok((await readAudit(db)).some(r => r.status === 'UNEXPECTED'));
  await failRecovery(db, /Unexpected auction RLS policy/);
  assert.equal((await db.query(`select policyname from pg_policies where policyname = 'custom production policy'`)).rows.length, 1);
  await db.exec(`drop policy "custom production policy" on public.lots;
    create function public.custom_profile_trigger() returns trigger language plpgsql as $$ begin return new; end; $$;
    create trigger custom_profile_trigger before insert on public.profiles for each row execute function public.custom_profile_trigger();`);
  assert.ok((await readAudit(db)).some(r => r.category === 'trigger' && r.status === 'UNEXPECTED'));
  await failRecovery(db, /Unexpected auction trigger/);
  assert.equal((await db.query(`select tgname from pg_trigger where tgname = 'custom_profile_trigger'`)).rows.length, 1);
  await db.exec(`drop trigger custom_profile_trigger on public.profiles;
    alter table public.lots drop column shipping_info;`);
  await failRecovery(db, /baseline column public.lots.shipping_info/);
  assert.equal((await db.query(`select attname from pg_attribute where attrelid = 'public.lots'::regclass and attname = 'shipping_info' and not attisdropped`)).rows.length, 0);
}));

test('invalid data rolls back all recovery changes and remains available for review', () => withDatabase({}, async db => {
  await db.exec(`alter table public.bids drop constraint bids_finite_money_check;
    begin; select set_config('app.place_bid','true',true);
    insert into public.bids(lot_id,bidder_id,amount) values
      ('20000000-0000-0000-0000-000000000701','00000000-0000-0000-0000-000000000101','NaN');
    commit;`);
  const before = await snapshot(db);
  await failRecovery(db, /bids_finite_money_check.*violated/);
  assert.deepEqual(await snapshot(db), before);
  assert.equal((await db.query(`select conname from pg_constraint where conname = 'bids_finite_money_check'`)).rows.length, 0);
}));

test('old inactive timings normalize; old running timings stop without changing deadlines', () => withDatabase({ release: false }, async db => {
  await db.exec(`begin; select set_config('app.auction_lifecycle','true',true);
    update public.lots set status = 'WAITING', ends_at = null,
      preview_duration_seconds = 10, first_bid_duration_seconds = 10;
    commit;`);
  await recover(db); applied(await readAudit(db));
  await db.exec(`alter table public.lots drop constraint lots_release_timings_check;
    begin; select set_config('app.auction_lifecycle','true',true);
    update public.lots set status = 'PREVIEW', preview_duration_seconds = 10, ends_at = now() + interval '1 day'
      where id = '20000000-0000-0000-0000-000000000701'; commit;`);
  const before = await snapshot(db);
  await failRecovery(db, /running lot has legacy timings/);
  assert.deepEqual(await snapshot(db), before);
}));

test('Realtime absence is reported separately and is not changed by 005 recovery', () => withDatabase({}, async db => {
  await db.exec(`alter publication supabase_realtime drop table public.lots;`);
  assert.ok((await readAudit(db)).some(r => r.category === 'realtime' && r.status === 'BASELINE_MISSING'));
  await recover(db);
  assert.equal((await db.query(`select * from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'lots'`)).rows.length, 0);
}));

test('profile backfill is reported and only missing profiles are inserted', () => withDatabase({}, async db => {
  await db.exec(`drop trigger on_auction_user_created on auth.users;
    insert into auth.users(id,raw_user_meta_data) values ('00000000-0000-0000-0000-000000000102','{"display_name":"Recovered bidder"}');`);
  const before = await snapshot(db);
  assert.equal((await readAudit(db)).find(r => r.item === 'missing user profiles').actual, 1);
  await recover(db); applied(await readAudit(db));
  const after = await snapshot(db);
  assert.equal(after.profiles.length, before.profiles.length + 1);
  assert.equal(after.profiles.find(p => p.id.endsWith('102')).display_name, 'Recovered bidder');
  after.profiles = after.profiles.filter(p => !p.id.endsWith('102'));
  assert.deepEqual(after, before);
}));
