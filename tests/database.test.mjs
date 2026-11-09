import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { storageSchema } from './helpers/storage-schema.mjs';

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
  await db.exec(storageSchema);
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

test('no bid becomes UNSOLD immediately, moves to queue end, and advances the room', () => fixture(async () => {
  await openFirstWindow(); await expire();
  await db.query('select public.advance_room_lifecycle($1)', [room]);
  const unsold = await row();
  assert.equal(unsold.status, 'UNSOLD');
  assert.ok(new Date(unsold.next_eligible_at) <= new Date());
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
  // Legacy drafts remain readable/publishable; new browser inserts must use the secure RPC.
  const draft = (await db.query(`insert into public.lots (room_id,seller_id,title,starting_bid) values ($1,$2,'Draft test',10) returning id`, [room, seller])).rows[0].id;
  await assert.rejects(asUser(seller, () => db.query(`insert into public.lots (room_id,seller_id,title,starting_bid) values ($1,$2,'Bypass',10)`, [room, seller])), /permission denied/);
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

test('queue eligibility returns the same lot to the same room with a clean preview', () => fixture(async () => {
  await db.query(`select set_config('app.auction_lifecycle', 'true', true)`);
  await db.query(`update public.lots set status = 'UNSOLD', unsold_at = clock_timestamp(), next_eligible_at = clock_timestamp() + interval '1 day' where room_id = $1`, [room]);
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
async function transaction(user, action, payload={}) {
 return asUser(user, async()=> (await db.query('select public.transaction_action($1,$2::jsonb) as result',[action,JSON.stringify(payload)])).rows[0].result);
}
const delivery={recipient:'Buyer Name',line1:'10 Example Road',line2:'',city:'London',region:'',postcode:'SW1A 1AA',country:'United Kingdom',instructions:''};
async function soldOrder(){await openFirstWindow();await asUser(bidder,()=>db.query('select public.place_bid($1,$2)',[first,275]));await expire();await db.query('select public.advance_room_lifecycle($1)',[room]);return (await db.query('select * from public.fulfilment_orders where lot_id=$1',[first])).rows[0];}
test('private messaging verifies participants, deduplicates, notifies, blocks and rate limits',()=>fixture(async()=>{
 const cid=await transaction(bidder,'conversation',{lot:first});
 assert.equal(await transaction(bidder,'conversation',{lot:first}),cid);
 const key='30000000-0000-0000-0000-000000000001';
 const mid=await transaction(bidder,'send',{conversation:cid,body:'Is collection possible?',key});
 assert.equal(await transaction(bidder,'send',{conversation:cid,body:'retry',key}),mid);
 assert.equal((await db.query("select count(*)::int n from public.notifications where kind='NEW_MESSAGE' and user_id=$1",[seller])).rows[0].n,1);
 assert.equal((await asUser(other,()=>db.query('select * from public.private_messages'))).rows.length,0);
 assert.equal((await asUser(other,()=>db.query('select * from public.conversations'))).rows.length,0);
 await assert.rejects(transaction(other,'send',{conversation:cid,body:'intrusion',key:'30000000-0000-0000-0000-000000000002'}),/unavailable/);
 await assert.rejects(transaction(bidder,'send',{conversation:cid,body:'x'.repeat(2001),key}),/2000/);
 assert.equal(Number((await asUser(seller,()=>db.query('select public.unread_message_count() n'))).rows[0].n),1);
 await transaction(seller,'read',{conversation:cid});
 assert.equal(Number((await asUser(seller,()=>db.query('select public.unread_message_count() n'))).rows[0].n),0);
 await transaction(seller,'report_message',{conversation:cid,message:mid,reason:'Review this message'});
 await assert.rejects(transaction(bidder,'delete_message',{conversation:cid,message:mid}),/retained/);
 await transaction(seller,'block',{conversation:cid});
 await assert.rejects(transaction(bidder,'send',{conversation:cid,body:'blocked',key:'30000000-0000-0000-0000-000000000003'}),/blocked/);
 await transaction(seller,'unblock',{conversation:cid});
 for(let i=2;i<=10;i++)await transaction(bidder,'send',{conversation:cid,body:'Question '+i,key:`30000000-0000-0000-0000-${String(i).padStart(12,'0')}`});
 await assert.rejects(transaction(bidder,'send',{conversation:cid,body:'too many',key:'30000000-0000-0000-0000-000000000011'}),/limit/);
}));
test('sold results create one private order; address snapshots and state transitions protect fulfilment',()=>fixture(async()=>{
 const o=await soldOrder();assert.equal(o.buyer_id,bidder);assert.equal(o.seller_id,seller);assert.equal(o.payment_state,'NOT_RECORDED');
 assert.equal((await db.query('select count(*)::int n from public.fulfilment_orders where lot_id=$1',[first])).rows[0].n,1);
 const aid=await transaction(bidder,'save_address',{details:delivery,default:true});
 assert.equal((await asUser(seller,()=>db.query('select * from public.delivery_addresses'))).rows.length,0);
 assert.equal((await asUser(other,()=>db.query('select * from public.fulfilment_orders'))).rows.length,0);
 await assert.rejects(transaction(other,'select_address',{order:o.id,version:0,address:aid}),/unavailable/);
 await transaction(bidder,'select_address',{order:o.id,version:0,address:aid});
 await transaction(bidder,'save_address',{id:aid,details:{...delivery,line1:'New address'},default:true});
 const snapshot=(await asUser(seller,()=>db.query('select address_snapshot from public.fulfilment_orders where id=$1',[o.id]))).rows[0].address_snapshot;
 assert.equal(snapshot.line1,delivery.line1);
 await assert.rejects(transaction(bidder,'shipping',{order:o.id,version:1,state:'DISPATCHED'}),/not allowed/);
 await transaction(seller,'shipping',{order:o.id,version:1,state:'DISPATCHED',service:'Royal Mail',tracking:'ABC123',notes:'Posted'});
 await assert.rejects(transaction(seller,'shipping',{order:o.id,version:1,state:'DISPATCHED'}),/changed/);
 await assert.rejects(transaction(bidder,'select_address',{order:o.id,version:2,address:aid}),/cannot be changed/);
 await transaction(seller,'seller_delivery_report',{order:o.id,version:2});
 assert.equal((await db.query('select shipping_state from public.fulfilment_orders where id=$1',[o.id])).rows[0].shipping_state,'DISPATCHED');
 await assert.rejects(transaction(seller,'receipt',{order:o.id,version:3}),/cannot/);
 await transaction(bidder,'receipt',{order:o.id,version:3});
 await transaction(bidder,'report_order',{order:o.id,reason:'Delivery issue'});await transaction(bidder,'report_order',{order:o.id,reason:'retry'});
 assert.equal((await db.query('select count(*)::int n from public.transaction_reports where order_id=$1',[o.id])).rows[0].n,1);
 const final=(await db.query('select * from public.fulfilment_orders where id=$1',[o.id])).rows[0];assert.equal(final.shipping_state,'DELIVERED');assert.equal(final.payment_state,'NOT_RECORDED');
 assert.equal((await db.query('select count(*)::int n from public.fulfilment_events where order_id=$1',[o.id])).rows[0].n,5);
 await transaction(bidder,'delete_address',{id:aid});assert.ok(final.address_snapshot);
 assert.equal(Number((await row()).winning_bid),275);
 await assert.rejects(asUser(other,()=>db.query("update public.fulfilment_orders set shipping_state='DELIVERED'")),/permission denied/);
}));
test('blocking preserves active order communication but does not expose other address books',()=>fixture(async()=>{
 await soldOrder();const cid=await transaction(bidder,'conversation',{lot:first});await transaction(seller,'block',{conversation:cid});
 await transaction(bidder,'send',{conversation:cid,body:'Please arrange delivery',key:'40000000-0000-0000-0000-000000000001'});
 const aid=await transaction(other,'save_address',{details:delivery,default:true});
 await assert.rejects(transaction(bidder,'save_address',{id:aid,details:delivery}),/unavailable/);
 await assert.rejects(transaction(bidder,'save_address',{details:{...delivery,recipient:''}}),/required/);
}));

const deliveryTerms = { mode: 'delivery', postage_minor: 495, postcode_areas: ['SW'], service: 'Royal Mail',
  handling_days: 2, restrictions: 'Signature required' };
const collectionTerms = { mode: 'collection', collection_area: 'Central London' };
const bothTerms = { ...deliveryTerms, ...collectionTerms, mode: 'both' };
const account = 'acct_testSeller';
const setTerms = (user, lot, terms) => asUser(user, () =>
  db.query('select public.set_listing_fulfilment($1,$2)', [lot, terms]));

async function createStructuredDraft() {
  const testRoom = randomUUID();
  await db.query("insert into public.auction_rooms(id,name,slug) values($1,'Checkout room',$2)", [testRoom, testRoom]);
  const { id } = (await asUser(seller, () => db.query(
    "select * from public.save_seller_draft($1,$2,'Checkout lot','An auction lot for test checkout',125)",
    [randomUUID(), testRoom],
  ))).rows[0];
  const photo = (await asUser(seller, () => db.query(
    "select * from public.prepare_seller_photo_variants($1,$2,'png')", [id, randomUUID()],
  ))).rows[0];
  for (const [path, mimetype] of [[photo.storage_path, 'image/png'], [photo.thumbnail_path, 'image/webp'], [photo.display_path, 'image/webp']]) {
    await db.query("insert into storage.objects(bucket_id,name,metadata) values('lot-photos',$1,$2)", [path, { mimetype, size: 1024 }]);
  }
  return { id, testRoom };
}

async function structuredSale(terms) {
  const { id, testRoom } = await createStructuredDraft();
  await setTerms(seller, id, terms);
  await asUser(seller, () => db.query('select public.submit_seller_lot($1)', [id]));
  const advance = () => db.query('select public.advance_room_lifecycle($1)', [testRoom]);
  await advance();
  await expire(id);
  await advance();
  await asUser(bidder, () => db.query('select public.place_bid($1,$2)', [id, '125.10']));
  await expire(id);
  await advance();
  await db.query('insert into public.seller_stripe_test_accounts values ($1,$2)', [seller, account]);
  return (await db.query('select * from public.fulfilment_orders where lot_id=$1', [id])).rows[0];
}

const reserve = (order, method, address = null, user = bidder) => db.query(
  'select * from public.reserve_test_checkout($1,$2,$3,$4,$5)', [user, order.id, method, address, account],
).then(result => result.rows[0]);

const record = (attempt, kind, { event = randomUUID(), refund = null, adjustment = null, status = null, total = attempt.total_minor } = {}) =>
  db.query('select public.record_test_payment($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
    [event, attempt.id, account, `cs_test_${attempt.id}`, `pi_${attempt.id}`, total, kind, refund, adjustment, status]);

const currentOrder = order => db.query('select * from public.fulfilment_orders where id=$1', [order.id]).then(result => result.rows[0]);

test('all listing fulfilment modes are validated, published with public terms and locked before bids', () => fixture(async () => {
  for (const terms of [deliveryTerms, collectionTerms, bothTerms]) {
    const { id } = await createStructuredDraft();
    await assert.rejects(asUser(seller, () => db.query('select public.submit_seller_lot($1)', [id])), /Set delivery or collection/);
    await assert.rejects(setTerms(bidder, id, terms), /own draft/);
    await assert.rejects(setTerms(seller, id, { ...deliveryTerms, postage_minor: 1.01 }), /valid delivery/);
    await assert.rejects(setTerms(seller, id, { ...collectionTerms, collection_area: '10 Example Road SW1A 1AA' }), /general area/);
    await setTerms(seller, id, terms);
    await assert.rejects(asUser(seller, () => db.query("update public.lots set shipping_info='Changed' where id=$1", [id])), /structured fulfilment terms/);
    await asUser(seller, () => db.query('select public.submit_seller_lot($1)', [id]));
    const published = await row(id);
    const lookup = () => db.query('select details from public.listing_fulfilment_terms where lot_id=$1', [id]);
    assert.equal((await asUser(seller, lookup)).rows[0].details.mode, terms.mode);
    assert.equal((await asUser(bidder, lookup)).rows.length, 0);
    assert.match(published.shipping_info, terms.mode === 'collection' ? /Free collection/ : /£4.95/);
    await assert.rejects(setTerms(seller, id, collectionTerms), /own draft/);
    await denied(() => db.query("update public.lots set shipping_info='Changed' where id=$1", [id]), /Published fulfilment terms are fixed/);
  }
}));

test('winner-only checkout uses the frozen price and postcode, holds a private address, and deduplicates settlement', () => fixture(async () => {
  const order = await structuredSale(deliveryTerms);
  assert.equal(order.payment_state, 'UNPAID');
  assert.equal(Number(order.winning_minor), 12510);
  assert.deepEqual(order.terms_snapshot.postcode_areas, ['SW']);
  assert.deepEqual((await db.query("select kind from public.notifications where lot_id=$1 and user_id=$2 and kind like 'WON%'", [order.lot_id, bidder])).rows,
    [{ kind: 'WON_PAYMENT_REQUIRED' }]);
  assert.equal((await asUser(other, () => db.query('select * from public.fulfilment_orders where id=$1', [order.id]))).rows.length, 0);
  await assert.rejects(asUser(bidder, () => reserve(order, 'delivery')), /permission denied/);
  await assert.rejects(asUser(seller, () => db.query("update public.fulfilment_orders set payment_state='PAID'")), /permission denied/);
  await assert.rejects(asUser(seller, () => db.query('select * from public.seller_stripe_test_accounts')), /permission denied/);
  await assert.rejects(transaction(seller, 'shipping', { order: order.id, version: 0, state: 'DISPATCHED' }), /confirmed payment/);

  const address = await transaction(bidder, 'save_address', { details: delivery });
  const outside = await transaction(bidder, 'save_address', { details: { ...delivery, postcode: 'EH1 1AA' } });
  const stranger = await transaction(other, 'save_address', { details: delivery });
  await denied(() => reserve(order, 'delivery', address, other), /Order unavailable/);
  await denied(() => reserve(order, 'collection'), /method is not offered/);
  await denied(() => reserve(order, 'delivery', outside), /does not deliver/);
  await denied(() => reserve(order, 'delivery', stranger), /own saved address/);

  const attempt = await reserve(order, 'delivery', address);
  assert.equal(attempt.total_minor, 13005);
  assert.equal(attempt.id, (await reserve(order, 'delivery', address)).id);
  assert.equal((await currentOrder(order)).payment_state, 'PENDING');
  await assert.rejects(asUser(seller, () => db.query('select * from public.stripe_checkout_attempts')), /permission denied/);
  assert.equal((await asUser(seller, () => db.query('select address_snapshot from public.fulfilment_orders where id=$1', [order.id]))).rows[0].address_snapshot, null);
  await transaction(bidder, 'save_address', { id: address, details: { ...delivery, line1: 'Updated address' } });
  await assert.rejects(asUser(seller, () => record(attempt, 'paid')), /permission denied/);
  await denied(() => record(attempt, 'paid', { total: 100 }), /does not match/);
  await record(attempt, 'failed');
  assert.equal((await currentOrder(order)).payment_state, 'FAILED');
  assert.equal((await reserve(order, 'delivery')).id, attempt.id);
  await record(attempt, 'paid', { event: 'evt_paid_once' });
  await record(attempt, 'paid', { event: 'evt_paid_once' });
  await record(attempt, 'paid', { event: 'evt_second_paid_notice' });
  await record(attempt, 'failed');
  const paid = await currentOrder(order);
  assert.equal(paid.payment_state, 'PAID');
  assert.equal(paid.address_snapshot.line1, delivery.line1);
  assert.equal(paid.shipping_state, 'AWAITING_DISPATCH');
  assert.equal((await db.query("select count(*)::int n from public.notifications where lot_id=$1 and kind in ('PAYMENT_CONFIRMED','ORDER_PAID')", [order.lot_id])).rows[0].n, 2);
  await denied(() => reserve(order, 'delivery'), /not eligible/);
  await transaction(seller, 'shipping', { order: order.id, version: paid.version, state: 'DISPATCHED', service: 'Royal Mail', tracking: 'TRACK123' });
  assert.equal((await asUser(bidder, () => currentOrder(order))).tracking, 'TRACK123');
  await transaction(bidder, 'receipt', { order: order.id, version: paid.version + 1 });
  assert.equal((await currentOrder(order)).shipping_state, 'DELIVERED');
}));

test('expired checkout releases the reservation, collection needs both parties, and refunds and disputes survive event reordering', () => fixture(async () => {
  const order = await structuredSale(bothTerms);
  const address = await transaction(bidder, 'save_address', { details: delivery });
  const expired = await reserve(order, 'delivery', address);
  await denied(() => reserve(order, 'collection'), /existing checkout uses different details/);
  await record(expired, 'expired', { event: 'evt_expiry' });
  const attempt = await reserve(order, 'collection');
  assert.notEqual(attempt.id, expired.id);
  assert.equal(attempt.total_minor, 12510);
  assert.equal(attempt.postage_minor, 0);
  await record(expired, 'expired', { event: 'evt_expiry_repeat' });
  assert.equal((await currentOrder(order)).payment_state, 'PENDING');
  await denied(() => record(expired, 'paid'), /released session/);

  await record(attempt, 'paid');
  let view = await currentOrder(order);
  assert.equal(view.shipping_state, 'PREPARING_COLLECTION');
  assert.equal(view.address_snapshot, null);
  const action = (user, kind, props = {}) => transaction(user, kind, { order: order.id, version: view.version, ...props });
  await assert.rejects(action(bidder, 'collection_confirm'), /cannot be confirmed/);
  await action(seller, 'collection', { state: 'READY_FOR_COLLECTION' });
  view = await currentOrder(order);
  await action(seller, 'collection', { state: 'COLLECTION_ARRANGED', notes: 'Saturday 10am via private message' });
  view = await currentOrder(order);
  await action(seller, 'collection_confirm');
  view = await currentOrder(order);
  assert.equal(view.shipping_state, 'COLLECTION_ARRANGED');
  await action(bidder, 'collection_confirm');
  assert.equal((await currentOrder(order)).shipping_state, 'DELIVERED');

  await record(attempt, 'refund', { refund: 500, adjustment: 're_partial', status: 'SUCCEEDED' });
  await record(attempt, 'refund', { refund: 500, adjustment: 're_partial', status: 'PENDING' });
  assert.equal((await currentOrder(order)).refunded_minor, 500);
  assert.equal((await currentOrder(order)).payment_state, 'PARTIALLY_REFUNDED');
  await record(attempt, 'dispute', { adjustment: 'dp_order', status: 'OPEN' });
  assert.equal((await currentOrder(order)).payment_state, 'DISPUTED');
  await record(attempt, 'dispute', { adjustment: 'dp_order', status: 'RESOLVED' });
  await record(attempt, 'dispute', { adjustment: 'dp_order', status: 'OPEN' });
  assert.equal((await currentOrder(order)).payment_state, 'PARTIALLY_REFUNDED');
  await record(attempt, 'refund', { refund: 500, adjustment: 're_partial', status: 'FAILED' });
  await record(attempt, 'refund', { refund: 500, adjustment: 're_partial', status: 'SUCCEEDED' });
  assert.equal((await currentOrder(order)).refunded_minor, 0);
  await record(attempt, 'refund', { refund: 12510, adjustment: 're_full', status: 'SUCCEEDED' });
  await record(attempt, 'paid');
  assert.equal((await currentOrder(order)).payment_state, 'REFUNDED');
}));
test('saved addresses support multiple entries, exclusive defaults and private owner-only edits/deletes',()=>fixture(async()=>{
 const a=await transaction(bidder,'save_address',{details:delivery,default:true});
 const b=await transaction(bidder,'save_address',{details:{...delivery,recipient:'Second recipient'},default:false});
 const rows=()=>asUser(bidder,()=>db.query('select * from public.delivery_addresses order by created_at,id'));
 assert.equal((await rows()).rows.length,2);
 await transaction(bidder,'save_address',{id:b,details:{...delivery,recipient:'Updated recipient'},default:true});
 let saved=(await rows()).rows;
 assert.deepEqual(saved.filter(a=>a.is_default).map(a=>a.id),[b]);
 assert.equal(saved.find(a=>a.id===b).details.recipient,'Updated recipient');
 await assert.rejects(transaction(other,'save_address',{id:b,details:delivery,default:true}),/unavailable/);
 await transaction(other,'delete_address',{id:b});
 assert.equal((await rows()).rows.length,2);
 assert.equal((await asUser(other,()=>db.query('select * from public.delivery_addresses where id=$1',[b]))).rows.length,0);
 await assert.rejects(asUser(other,()=>db.query('update public.delivery_addresses set is_default=false where id=$1',[b])),/permission denied/);
 await assert.rejects(asUser(other,()=>db.query('delete from public.delivery_addresses where id=$1',[b])),/permission denied/);
 await transaction(bidder,'delete_address',{id:a});
 saved=(await rows()).rows;assert.equal(saved.length,1);assert.equal(saved[0].id,b);
}));

test('retention purges only old nontransaction, unreported messages and denies client execution',()=>fixture(async()=>{
 const cid=await transaction(bidder,'conversation',{lot:first});
 const mid=await transaction(bidder,'send',{conversation:cid,body:'Old question',key:'70000000-0000-0000-0000-000000000001'});
 await db.query("update public.private_messages set created_at=now()-interval '1 year' where id=$1",[mid]);
 await assert.rejects(asUser(bidder,()=>db.query("select public.purge_nontransaction_messages(now()-interval '60 days')")),/permission denied/);
 await db.query("select public.purge_nontransaction_messages(now()-interval '60 days')");
 assert.equal((await db.query('select * from public.private_messages where id=$1',[mid])).rows.length,0);
}));

