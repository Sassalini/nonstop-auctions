import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';
import { parseRelistingLimit } from '../src/lib/seller-validation.ts';
const seller='00000000-0000-0000-0000-000000000101';
const buyer=randomUUID(), watcher=randomUUID(), laterWatcher=randomUUID(), stranger=randomUUID();
let db;
let legacyRetry, legacyRoom;
const settingsColumns=['relist_unlimited','max_auto_relistings','auto_relistings_used','completed_attempts','final_unsold_at','removal_requested_at','removed_at','pending_relist_unlimited','pending_max_auto_relistings'];
before(async()=>{
 db=await releaseDatabase({throughMigration:11});
 for(const id of [buyer,watcher,laterWatcher,stranger])await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[id]);
 const room=randomUUID(),lot=randomUUID();
 await db.query("insert into public.auction_rooms(id,name,slug) values($1,'Legacy room',$2)",[room,room]);
 await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,current_bid,bid_count,status,highest_bidder_id,winning_bid,sold_at) values($1,$2,$3,'Preserved sale',100,125,1,'SOLD',$4,125,now())",[lot,room,seller,buyer]);
 await db.query("insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run,read_at) values($1,$2,'SELLER_LIVE','Preserved sale',now()-interval '1 day',now()),($1,$2,'SELLER_LIVE','Preserved sale',now(),null)",[seller,lot]);
 legacyRoom=room;legacyRetry=randomUUID();
 await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,status,unsold_at,preview_starts_at,bidding_starts_at,queue_position) values($1,$2,$3,'Legacy retry',100,'UNSOLD',now(),now()-interval '60 seconds',now()-interval '30 seconds',5)",[legacyRetry,room,seller]);
 await db.query("insert into public.auction_attempts(lot_id,preview_started_at,completed_at,outcome) values($1,now()-interval '60 seconds',now(),'UNSOLD')",[legacyRetry]);
 await db.query("insert into public.notifications(user_id,lot_id,kind,lot_title,auction_run,read_at) values($1,$2,'SELLER_LIVE','Legacy retry',now()-interval '30 seconds',now())",[seller,legacyRetry]);
 const soldBefore=(await db.query("select * from public.lots where status='SOLD' order by id")).rows;
 const notificationsBefore=(await db.query('select * from public.notifications order by id')).rows;
 await db.exec(await readFile(new URL('../supabase/migrations/012_seller_relisting_and_notification_events.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query("select * from public.lots where status='SOLD' order by id")).rows.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>!settingsColumns.includes(key)))),soldBefore);
 assert.deepEqual((await db.query('select * from public.notifications order by id')).rows,notificationsBefore);
 assert.equal((await db.query("select * from public.listing_notification_events where lot_id=$1 and event_kind='SOLD'",[lot])).rows.length,1);
 assert.equal((await db.query("select * from public.lots where status='WAITING' and not relist_unlimited")).rows.length,0);
});
after(async()=>{await db?.close();});
async function asUser(id,fn,role='authenticated') {
 await db.exec('savepoint client_action');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id??'']);await db.exec(`set local role ${role}`);
 try{return await fn();}catch(e){await db.exec('rollback to savepoint client_action');throw e;}finally{await db.exec('reset role;release savepoint client_action');}
}
async function fixture(fn){await db.exec('begin');try{const room=randomUUID();await db.query("insert into public.auction_rooms(id,name,slug) values($1,'Relisting room',$2)",[room,room]);await fn(room);}finally{await db.exec('rollback');}}
async function createLot(room,{limit=5,unlimited=false,position=1}={}){const id=randomUUID();await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,status,queue_position,max_auto_relistings,relist_unlimited) values($1,$2,$3,'Managed item',100,'WAITING',$4,$5,$6)",[id,room,seller,position,limit,unlimited]);return id;}
const row=async lot=>(await db.query('select * from public.lots where id=$1',[lot])).rows[0];
const advance=room=>db.query('select public.advance_room_lifecycle($1)',[room]);
const manage=(lot,{limit=5,unlimited=false,remove=false,user=seller}={})=>asUser(user,()=>db.query('select * from public.manage_seller_listing($1,$2,$3,$4)',[lot,unlimited,limit,remove]));
async function expire(lot){await db.exec("select set_config('app.auction_lifecycle','true',true)");await db.query("update public.lots set ends_at=clock_timestamp()-interval '1 second' where id=$1",[lot]);await db.exec("select set_config('app.auction_lifecycle','false',true)");}
async function readyRetry(lot,room){await db.exec("select set_config('app.auction_lifecycle','true',true)");await db.query("update public.lots set next_eligible_at=clock_timestamp()-interval '1 second' where id=$1",[lot]);await db.exec("select set_config('app.auction_lifecycle','false',true)");await advance(room);}
async function open(lot,room){await expire(lot);await advance(room);assert.equal((await row(lot)).status,'FIRST_BID_WINDOW');}
async function noBids(lot,room){await open(lot,room);await expire(lot);await advance(room);}
const bid=(lot,amount=125)=>asUser(buyer,()=>db.query('select public.place_bid($1,$2)',[lot,amount]));
const events=async lot=>(await db.query('select user_id,kind from public.notifications where lot_id=$1 order by user_id,kind',[lot])).rows;
const attempts=async lot=>(await db.query('select * from public.auction_attempts where lot_id=$1',[lot])).rows;

test('whole retry counts validate 0 through 100 and reject malformed/fractional inputs',()=>{
 for(const value of ['0','5','100',' 3 '])assert.equal(parseRelistingLimit(value),Number(value));
 for(const value of ['-1','1.5','101','NaN','Infinity','','1e2','5.0'])assert.equal(parseRelistingLimit(value),null);
});
test('zero retries runs once, records the unsold attempt, then leaves the queue permanently',()=>fixture(async room=>{
 const lot=await createLot(room,{limit:0});await advance(room);await noBids(lot,room);
 const final=await row(lot);assert.equal(final.status,'EXPIRED');assert.equal(final.auto_relistings_used,0);assert.equal(final.completed_attempts,1);assert.ok(final.final_unsold_at);
 assert.equal((await attempts(lot)).length,1);assert.equal((await attempts(lot))[0].outcome,'UNSOLD');
 for(let i=0;i<5;i++)await advance(room);
 assert.deepEqual(await row(lot),final);assert.equal((await attempts(lot)).length,1);
}));
test('five additional relistings allow exactly six unsuccessful attempts with a lone-lot delay',()=>fixture(async room=>{
 const lot=await createLot(room);await advance(room);
 for(let i=1;i<=6;i++){
  await noBids(lot,room);const result=await row(lot);
  assert.equal(result.completed_attempts,i);assert.equal(result.auto_relistings_used,Math.min(i,5));assert.equal((await attempts(lot)).length,i);
  if(i<6){assert.equal(result.status,'UNSOLD');assert.ok(new Date(result.next_eligible_at)-Date.now()>58000);for(let n=0;n<5;n++)await advance(room);assert.deepEqual(await row(lot),result);await readyRetry(lot,room);}
  else assert.equal(result.status,'EXPIRED');
 }
}));
test('unlimited retries exceed the finite budget; disabling unlimited applies safely after a live attempt',()=>fixture(async room=>{
 const lot=await createLot(room,{limit:0,unlimited:true});await advance(room);
 for(let i=0;i<7;i++){await noBids(lot,room);assert.equal((await row(lot)).status,'UNSOLD');await readyRetry(lot,room);}
 const before=await row(lot);await manage(lot,{limit:3,unlimited:false});const pending=await row(lot);
 assert.equal(pending.status,'PREVIEW');assert.equal(pending.relist_unlimited,true);assert.equal(pending.pending_relist_unlimited,false);assert.equal(pending.ends_at.getTime(),before.ends_at.getTime());
 await noBids(lot,room);const final=await row(lot);assert.equal(final.status,'EXPIRED');assert.equal(final.relist_unlimited,false);assert.equal(final.completed_attempts,8);assert.equal(final.auto_relistings_used,7);assert.equal(final.pending_max_auto_relistings,null);
}));
test('raising exhausted limits restarts at the tail once; limits are totals, not reset budgets',()=>fixture(async room=>{
 const lot=await createLot(room,{limit:0});await advance(room);await noBids(lot,room);
 await manage(lot,{limit:5});const resumed=await row(lot);assert.equal(resumed.status,'UNSOLD');assert.equal(resumed.auto_relistings_used,1);
 await manage(lot,{limit:5});assert.equal((await row(lot)).auto_relistings_used,1);
 await readyRetry(lot,room);await noBids(lot,room);assert.equal((await row(lot)).auto_relistings_used,2);
 await manage(lot,{limit:1});assert.equal((await row(lot)).status,'EXPIRED');assert.equal((await row(lot)).completed_attempts,2);
 await manage(lot,{limit:2});assert.equal((await row(lot)).status,'UNSOLD');assert.equal((await row(lot)).auto_relistings_used,2);
 await manage(lot,{unlimited:true,limit:1});assert.equal((await row(lot)).status,'UNSOLD');assert.equal((await row(lot)).auto_relistings_used,2);
}));
test('the last already scheduled finite retry remains eligible when saving the same limit',()=>fixture(async room=>{
 const lot=await createLot(room,{limit:1});await advance(room);await noBids(lot,room);
 assert.equal((await row(lot)).auto_relistings_used,1);await manage(lot,{limit:1});assert.equal((await row(lot)).status,'UNSOLD');
 await readyRetry(lot,room);await noBids(lot,room);assert.equal((await row(lot)).status,'EXPIRED');assert.equal((await row(lot)).completed_attempts,2);
}));
test('rooms cycle independently and unsold retries return behind other eligible lots',()=>fixture(async room=>{
 const first=await createLot(room),second=await createLot(room,{position:2});await advance(room);await noBids(first,room);
 assert.equal((await row(second)).status,'PREVIEW');assert.ok((await row(first)).queue_position>(await row(second)).queue_position);
 await noBids(second,room);assert.equal((await row(first)).status,'PREVIEW');assert.equal((await row(first)).auto_relistings_used,1);
 const room2=randomUUID();await db.query("insert into public.auction_rooms(id,name,slug) values($1,'Other room',$2)",[room2,room2]);const other=await createLot(room2,{limit:0});await advance(room2);await noBids(other,room2);assert.equal((await row(other)).status,'EXPIRED');assert.equal((await row(first)).status,'PREVIEW');
}));
test('queued removal is a confirmed soft cancellation; repeated removal cannot duplicate history',()=>fixture(async room=>{
 const lot=await createLot(room);await manage(lot,{remove:true});const removed=await row(lot);assert.equal(removed.status,'CANCELLED');assert.ok(removed.removed_at);assert.equal(removed.completed_attempts,0);
 await manage(lot,{remove:true});await advance(room);assert.deepEqual(await row(lot),removed);assert.equal((await attempts(lot)).length,0);
 await assert.rejects(manage(lot),/removed listing cannot be restarted/);
}));
for(const phase of ['PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING'])test(`removal during ${phase} defers to completion and never cancels accepted bids`,()=>fixture(async room=>{
 const lot=await createLot(room);await advance(room);if(phase!=='PREVIEW')await open(lot,room);if(phase==='ACTIVE_BIDDING')await bid(lot);
 const before=await row(lot);await manage(lot,{remove:true});const pending=await row(lot);
 assert.equal(pending.status,before.status);assert.equal(pending.current_bid,before.current_bid);assert.equal(pending.highest_bidder_id,before.highest_bidder_id);assert.equal(pending.ends_at.getTime(),before.ends_at.getTime());
 if(phase==='PREVIEW')await open(lot,room);
 // Even a bid accepted AFTER the removal request must be honored.
 if(phase!=='ACTIVE_BIDDING')await bid(lot);
 await expire(lot);await advance(room);const sold=await row(lot);assert.equal(sold.status,'SOLD');assert.equal(Number(sold.winning_bid),125);assert.equal(sold.highest_bidder_id,buyer);assert.equal(sold.removed_at,null);assert.equal(sold.completed_attempts,1);
 await assert.rejects(manage(lot,{remove:true}),/cannot be managed/);
 const history=(await asUser(buyer,()=>db.query("select * from public.completed_auctions_page('buyer',51,0,$1)",[lot]))).rows;assert.equal(history.length,1);assert.equal(Number(history[0].sale_price),125);
 assert.equal((await asUser(seller,()=>db.query("select * from public.completed_auctions_page('seller',51,0,$1)",[lot]))).rows.length,1);
}));
test('pending removal with no bids finishes unsold and does not requeue',()=>fixture(async room=>{
 const lot=await createLot(room,{unlimited:true});await advance(room);await manage(lot,{remove:true});await noBids(lot,room);
 const final=await row(lot);assert.equal(final.status,'CANCELLED');assert.equal(final.auto_relistings_used,0);assert.equal(final.completed_attempts,1);assert.ok(final.final_unsold_at);assert.equal((await attempts(lot))[0].outcome,'UNSOLD');
}));
test('one first-live/first-bid/sold event per listing; only current watchers receive first-bid alerts',()=>fixture(async room=>{
 const lot=await createLot(room);await db.query('insert into public.watchlist(user_id,lot_id) values($1,$2)',[watcher,lot]);
 await advance(room);assert.equal((await events(lot)).length,0);await noBids(lot,room);await readyRetry(lot,room);
 await db.query('insert into public.watchlist(user_id,lot_id) values($1,$2)',[laterWatcher,lot]);await open(lot,room);
 await db.query('delete from public.watchlist where user_id=$1 and lot_id=$2',[watcher,lot]);await bid(lot);await bid(lot,175);
 await expire(lot);await advance(room);for(let i=0;i<5;i++)await advance(room);
 const all=await events(lot);const count=(user,kind)=>all.filter(e=>e.user_id===user&&e.kind===kind).length;
 for(const kind of ['SELLER_LIVE','SELLER_FIRST_BID','SELLER_SOLD'])assert.equal(count(seller,kind),1);
 assert.equal(count(watcher,'WATCHED_LIVE'),1);assert.equal(count(watcher,'WATCHED_FIRST_BID'),0);
 assert.equal(count(laterWatcher,'WATCHED_LIVE'),0);assert.equal(count(laterWatcher,'WATCHED_FIRST_BID'),1);assert.equal(count(laterWatcher,'WATCHED_SOLD'),1);assert.equal(count(buyer,'WON'),1);
 assert.equal(all.filter(e=>e.kind==='WATCHED_UNSOLD').length,0);
 assert.equal((await db.query('select * from public.listing_notification_events where lot_id=$1',[lot])).rows.length,3);
}));
test('settings cannot change ownership, prices, timers, counters or another seller; raw writes and event forgery reject',()=>fixture(async room=>{
 const lot=await createLot(room);await advance(room);const before=await row(lot);
 await assert.rejects(manage(lot,{user:stranger}),/Listing not found/);
 await assert.rejects(asUser(null,()=>db.query('select public.manage_seller_listing($1)',[lot]),'anon'),/permission denied/);
 for(const limit of [-1,101,'1.5','NaN','Infinity',null])await assert.rejects(manage(lot,{limit}),/whole number/);
 await manage(lot,{limit:0});const pending=await row(lot);
 for(const key of ['seller_id','room_id','starting_bid','current_bid','highest_bidder_id','winning_bid','ends_at','auto_relistings_used','completed_attempts'])assert.deepEqual(pending[key],before[key]);
 await assert.rejects(asUser(seller,()=>db.query('update public.lots set max_auto_relistings=100 where id=$1',[lot])),/permission denied/);
 await db.exec('grant update(max_auto_relistings) on public.lots to authenticated');
 await db.exec('create policy test_broad_update on public.lots for update to authenticated using(seller_id=auth.uid()) with check(seller_id=auth.uid())');
 await assert.rejects(asUser(seller,async()=>{await db.exec("select set_config('app.auction_lifecycle','true',true)");return db.query('update public.lots set max_auto_relistings=100 where id=$1',[lot]);}),/secure seller/);
 await assert.rejects(asUser(seller,()=>db.query('insert into public.listing_notification_events values($1,\'SOLD\',now())',[lot])),/permission denied/);
 await assert.rejects(asUser(seller,()=>db.query('select public.notify_lot_transition()')),/permission denied/);
}));
test('new draft RPC persists retries, validates whole numbers and retains lost-response idempotency',()=>fixture(async room=>{
 const key=randomUUID();const save=(limit,unlimited=false)=>asUser(seller,()=>db.query("select * from public.save_seller_draft_with_relisting($1,$2,'Submission','Detailed item description',25.50,$3,$4)",[key,room,unlimited,limit]));
 for(const limit of [-1,101,'2.5','NaN','Infinity',null])await assert.rejects(save(limit),/whole number/);
 const saved=(await save(0)).rows[0];assert.equal(saved.max_auto_relistings,0);assert.equal(saved.auto_relistings_used,0);assert.equal(saved.completed_attempts,0);
 assert.equal((await save(5,true)).rows[0].relist_unlimited,true);
 const image=randomUUID();const prepared=(await asUser(seller,()=>db.query("select * from public.prepare_seller_photo($1,$2,'png')",[saved.id,image]))).rows[0];
 await asUser(seller,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('lot-photos',$1,'{\"mimetype\":\"image/png\",\"size\":100}')",[prepared.storage_path]));
 await asUser(seller,()=>db.query('select public.submit_seller_lot($1)',[saved.id]));const published=await row(saved.id);
 await save(100,false);assert.deepEqual(await row(saved.id),published);
}));

test('legacy published retries retain unlimited policy and first-live claims without replaying old alerts',async()=>{
 await db.exec('begin');try{
  const legacy=await row(legacyRetry);assert.equal(legacy.relist_unlimited,true);assert.equal(legacy.completed_attempts,1);assert.equal(legacy.auto_relistings_used,1);
  const before=await events(legacyRetry);await advance(legacyRoom);await open(legacyRetry,legacyRoom);
  assert.deepEqual(await events(legacyRetry),before);
 }finally{await db.exec('rollback');}
});
test('unchanged live scheduler calls write no lots or duplicate event claims',()=>fixture(async room=>{
 const lot=await createLot(room);await advance(room);await open(lot,room);
 const before=await events(lot);
 await db.exec(`create temp table relisting_observed_writes(id uuid);
 create function pg_temp.observe_relisting_write() returns trigger language plpgsql as $$ begin insert into pg_temp.relisting_observed_writes values(new.id); return new; end; $$;
 create trigger observe_relisting_write after update on public.lots for each row execute function pg_temp.observe_relisting_write();`);
 for(let i=0;i<5;i++)await advance(room);
 assert.equal((await db.query('select * from pg_temp.relisting_observed_writes')).rows.length,0);assert.deepEqual(await events(lot),before);
}));

test('pending zero-retry settings still honor a bid and apply only on sale completion',()=>fixture(async room=>{
 const lot=await createLot(room);await advance(room);await manage(lot,{limit:0});
 assert.equal((await row(lot)).max_auto_relistings,5);assert.equal((await row(lot)).pending_max_auto_relistings,0);
 await open(lot,room);await bid(lot);await expire(lot);await advance(room);
 const sold=await row(lot);assert.equal(sold.status,'SOLD');assert.equal(sold.max_auto_relistings,0);assert.equal(sold.pending_max_auto_relistings,null);assert.equal(Number(sold.winning_bid),125);
}));

test('overlapping seller/watcher and winner/watcher roles receive one alert for each event',()=>fixture(async room=>{
 const lot=await createLot(room);await db.query('insert into public.watchlist(user_id,lot_id) values($1,$3),($2,$3)',[seller,buyer,lot]);
 await advance(room);await open(lot,room);await bid(lot);await expire(lot);await advance(room);
 const all=await events(lot);
 assert.deepEqual(all.filter(e=>e.user_id===seller).map(e=>e.kind).sort(),['SELLER_FIRST_BID','SELLER_LIVE','SELLER_SOLD']);
 assert.deepEqual(all.filter(e=>e.user_id===buyer).map(e=>e.kind).sort(),['WATCHED_FIRST_BID','WATCHED_LIVE','WON']);
}));
