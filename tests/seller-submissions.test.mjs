import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';
import { storageSchema } from './helpers/storage-schema.mjs';
import { parseStartingBid } from '../src/lib/seller-validation.ts';

const seller = '00000000-0000-0000-0000-000000000104';
const buyer = '00000000-0000-0000-0000-000000000105';
let db;
before(async () => {
  db = await releaseDatabase({ throughMigration: 8 });
  const before = (await db.query('select * from public.lots order by id')).rows;
  await db.exec(storageSchema);
  await db.exec(await readFile(new URL('../supabase/migrations/009_seller_submissions.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query('select * from public.lots order by id')).rows.map(({ submission_key, ...lot }) => {
    assert.equal(submission_key, null); return lot;
  }), before);
  await db.query('insert into auth.users(id,email_confirmed_at) values ($1,now()),($2,now())', [seller, buyer]);
});
after(async () => { await db?.close(); });
async function asUser(id, fn, role = 'authenticated') {
  await db.exec('savepoint action');
  await db.query("select set_config('request.jwt.claim.sub',$1,true)", [id ?? '']);
  await db.exec(`set local role ${role}`);
  try { return await fn(); }
  catch (error) { await db.exec('rollback to savepoint action'); throw error; }
  finally { await db.exec('reset role; release savepoint action'); }
}
async function fixture(fn) {
  await db.exec('begin');
  try {
    const room = randomUUID();
    await db.query("insert into public.auction_rooms(id,name,slug) values ($1,'Seller test room',$2)", [room, room]);
    await fn(room);
  } finally { await db.exec('rollback'); }
}
async function save(room, { key = randomUUID(), amount = '25.50', title = 'Seller item', description = 'Detailed item description' } = {}) {
  return (await asUser(seller, () => db.query('select * from public.save_seller_draft($1,$2,$3,$4,$5)', [key, room, title, description, amount]))).rows[0];
}
async function prepare(lot, id = randomUUID()) {
  return (await asUser(seller, () => db.query("select * from public.prepare_seller_photo($1,$2,'png')", [lot.id, id]))).rows[0];
}
async function upload(image, user = seller, metadata = { mimetype: 'image/png', size: 100 }) {
  return asUser(user, () => db.query("insert into storage.objects(bucket_id,name,metadata) values ('lot-photos',$1,$2)", [image.storage_path, metadata]));
}
const submit = lot => asUser(seller, () => db.query('select * from public.submit_seller_lot($1)', [lot.id]));

test('client GBP parser accepts pence and rejects zero, negatives, exponent, non-finite and excess decimals', () => {
  for (const value of ['0', '-1', '1.001', 'NaN', 'Infinity', '1e2', '1,000', '', '1000000000000']) assert.equal(parseStartingBid(value), null, value);
  for (const value of ['0.01','25.50','1','999999999999.99']) assert.equal(parseStartingBid(value), Number(value));
});

test('new migration preserves history; anonymous/unverified sellers and direct inserts are rejected', () => fixture(async room => {
  await assert.rejects(asUser(null, () => db.query('select public.save_seller_draft($1,$2,$3,$4,10)', [randomUUID(),room,'Item','Description']), 'anon'), /permission denied/);
  await db.query('update auth.users set email_confirmed_at=null where id=$1', [seller]);
  await assert.rejects(save(room), /Confirm your email/);
  await db.query('update auth.users set email_confirmed_at=now() where id=$1', [seller]);
  await assert.rejects(asUser(seller, () => db.query("insert into public.lots(room_id,seller_id,title,starting_bid) values ($1,$2,'Bypass',10)",[room,seller])), /permission denied/);
}));

test('database validates GBP without rounding invalid input, descriptions and active room', () => fixture(async room => {
  for (const amount of ['0','-1','1.001','NaN','Infinity','1000000000000']) await assert.rejects(save(room, { amount }), /Starting bid/);
  await assert.rejects(save(room, { title: '  ' }), /Enter a title/);
  await assert.rejects(save(room, { description: ' ' }), /Enter a title/);
  await db.query('update public.auction_rooms set is_active=false where id=$1', [room]);
  await assert.rejects(save(room), /active auction room/);
}));

test('idempotent drafts have trusted ownership and untouched lifecycle defaults; completion requires uploaded images', () => fixture(async room => {
  const key = randomUUID(); const lot = await save(room, { key });
  assert.equal((await save(room, { key })).id, lot.id);
  assert.equal(lot.seller_id, seller); assert.equal(lot.room_id, room); assert.equal(lot.status, 'DRAFT');
  assert.equal(lot.current_bid, '0'); assert.equal(lot.minimum_increment, '50');
  assert.equal(lot.ends_at, null); assert.equal(lot.highest_bidder_id, null); assert.equal(lot.queue_position, 0);
  await assert.rejects(submit(lot), /valid photos/);
  await assert.rejects(asUser(seller, () => db.query('select public.publish_lot($1)', [lot.id])), /valid photos/);
  const image = await prepare(lot);
  await assert.rejects(submit(lot), /valid photos/);
  await upload(image, seller, { mimetype: 'text/html', size: 100 });
  await assert.rejects(submit(lot), /valid photos/);
  await db.query('update storage.objects set metadata=$2 where name=$1', [image.storage_path, { mimetype:'image/png',size:5242881 }]);
  await assert.rejects(submit(lot), /valid photos/);
  await db.query('update storage.objects set metadata=$2 where name=$1', [image.storage_path, { mimetype:'image/png',size:100 }]);
  await asUser(seller, () => db.query('update public.lots set minimum_increment=1 where id=$1', [lot.id]));
  await assert.rejects(submit(lot), /details are invalid/);
  await asUser(seller, () => db.query('update public.lots set minimum_increment=50 where id=$1', [lot.id]));
  const published = (await submit(lot)).rows[0];
  assert.equal(published.status, 'WAITING'); assert.equal(published.queue_position, 1); assert.equal(published.ends_at, null);
  assert.deepEqual((await submit(lot)).rows[0], published);
  assert.equal((await save(room, { key })).id, lot.id);
  assert.equal((await asUser(null, () => db.query('select * from storage.objects'), 'anon')).rows.length, 1);
}));

test('draft files stay private and registered; broad pre-existing policies cannot allow other sellers or overwrites', () => fixture(async room => {
  await db.exec(`create policy broad_legacy_storage on storage.objects for all to anon,authenticated using(true) with check(true);`);
  // New restrictive policies leave unrelated buckets' pre-existing permissions alone.
  await db.exec("insert into storage.buckets(id,name) values ('unrelated','unrelated')");
  await asUser(null, () => db.exec("insert into storage.objects(bucket_id,name) values ('unrelated','other-file'); delete from storage.objects where bucket_id='unrelated'"), 'anon');
  const lot = await save(room); const image = await prepare(lot);
  await assert.rejects(upload({ storage_path: `${seller}/${lot.id}/${randomUUID()}.png` }), /row-level security/);
  await assert.rejects(upload(image, buyer), /row-level security/);
  await upload(image);
  assert.equal((await asUser(buyer, () => db.query('select * from storage.objects'))).rows.length, 0);
  assert.equal((await asUser(null, () => db.query('select * from storage.objects'), 'anon')).rows.length, 0);
  assert.equal((await asUser(buyer, () => db.query('delete from storage.objects returning *'))).rows.length, 0);
  assert.equal((await asUser(seller, () => db.query("update storage.objects set name='overwrite' returning *"))).rows.length, 0);
  await assert.rejects(asUser(buyer, () => db.query('select public.submit_seller_lot($1)', [lot.id])), /not found/);
  await assert.rejects(asUser(buyer, () => db.query('select public.prepare_seller_photo($1,$2,\'png\')', [lot.id,randomUUID()])), /own unfinished/);
  assert.equal((await asUser(buyer, () => db.query('select * from public.lots where id=$1', [lot.id]))).rows.length, 0);
}));

test('photo limits, secure lifecycle fields, reference deletion guard and draft cleanup', () => fixture(async room => {
  const lot = await save(room); const image = await prepare(lot);
  for (let n=1;n<10;n++) await prepare(lot);
  await assert.rejects(prepare(lot), /up to 10/);
  await upload(image);
  await assert.rejects(asUser(seller, () => db.query('select public.remove_seller_photo($1)', [image.id])), /through Storage/);
  await assert.rejects(asUser(seller, () => db.query('select public.discard_seller_draft($1)', [lot.id])), /Remove uploaded/);
  for (const column of ['status','current_bid','highest_bidder_id','ends_at','queue_position','submission_key']) {
    await assert.rejects(asUser(seller, () => db.query(`update public.lots set ${column}=${column} where id=$1`, [lot.id])), /permission denied/);
  }
  // Emulates Storage API's metadata removal AFTER deleting the physical object in real Supabase.
  await asUser(seller, () => db.query('delete from storage.objects where name=$1', [image.storage_path]));
  await asUser(seller, () => db.query('select public.remove_seller_photo($1)', [image.id]));
  await asUser(seller, () => db.query('select public.remove_seller_photo($1)', [image.id]));
  await asUser(seller, () => db.query('select public.discard_seller_draft($1)', [lot.id]));
  assert.equal((await db.query('select id from public.lots where id=$1',[lot.id])).rows.length, 0);
  assert.equal((await db.query('select id from public.lot_images where lot_id=$1',[lot.id])).rows.length, 0);
}));

test('new no-reserve listings follow 30/30/5 timings, sell to highest bidder, then unsold lots requeue seven days in the same room', () => fixture(async room => {
  const lot = await save(room); const image = await prepare(lot); await upload(image); await submit(lot);
  const second = await save(room); const secondImage = await prepare(second); await upload(secondImage); await submit(second);
  const get = async id => (await db.query('select * from public.lots where id=$1',[id])).rows[0];
  const expire = async id => {
    await db.exec("select set_config('app.auction_lifecycle','true',true)");
    await db.query("update public.lots set ends_at=clock_timestamp()-interval '0.01 seconds' where id=$1",[id]);
    await db.exec("select set_config('app.auction_lifecycle','false',true)");
    await db.query('select public.advance_room_lifecycle($1)',[room]);
  };
  await db.query('select public.advance_room_lifecycle($1)',[room]);
  assert.equal((await get(lot.id)).status,'PREVIEW');
  assert.equal((await get(lot.id)).preview_duration_seconds,30);
  await expire(lot.id); assert.equal((await get(lot.id)).status,'FIRST_BID_WINDOW');
  assert.equal((await get(lot.id)).first_bid_duration_seconds,30);
  await asUser(buyer, () => db.query('select public.place_bid($1,25.50)',[lot.id]));
  const active = await get(lot.id); assert.equal(active.status,'ACTIVE_BIDDING'); assert.equal(active.bid_extension_seconds,5);
  assert.ok(Date.parse(active.ends_at)-Date.now() <= 5000);
  await assert.rejects(asUser(buyer, () => db.query('select public.place_bid($1,25.51)',[lot.id])), /at least/);
  await asUser(buyer, () => db.query('select public.place_bid($1,75.50)',[lot.id]));
  await expire(lot.id);
  const sold = await get(lot.id); assert.equal(sold.status,'SOLD'); assert.equal(sold.winning_bid,'75.50'); assert.equal(sold.highest_bidder_id,buyer);
  assert.equal((await get(second.id)).status,'PREVIEW');
  await expire(second.id); await expire(second.id);
  const unsold = await get(second.id); assert.equal(unsold.status,'UNSOLD'); assert.equal(unsold.room_id,room);
  assert.equal(Date.parse(unsold.next_eligible_at)-Date.parse(unsold.unsold_at),7*86400000);
  await assert.rejects(asUser(seller, () => db.query("delete from storage.objects where name=$1 returning *",[image.storage_path])).then(result => { if (!result.rows.length) throw new Error('protected'); }), /protected/);
}));
