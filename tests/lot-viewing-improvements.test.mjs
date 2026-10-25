import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after,before,test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';
import { descriptionParagraphs } from '../src/lib/lot-description.ts';
import { orderSidebarRooms } from '../src/lib/room-order.ts';
import { parseLotReference } from '../src/lib/lot-reference.ts';
import { getAuctionViewingTarget } from '../src/lib/auction-viewing.ts';
let db;const seller='00000000-0000-0000-0000-000000000101',buyer=randomUUID();
const migration=await readFile(new URL('../supabase/migrations/013_permanent_lot_references.sql',import.meta.url),'utf8');
before(async()=>{
 db=await releaseDatabase({throughMigration:12});
 await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[buyer]);
 const lots=(await db.query('select * from public.lots order by id')).rows;
 await db.exec(migration);
 assert.deepEqual((await db.query('select * from public.lots order by id')).rows.map(({lot_reference,...row})=>{assert.ok(Number(lot_reference)>0);return row;}),lots);
});
after(async()=>{await db?.close();});
async function asUser(id,fn){await db.exec('savepoint actor');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);await db.exec('set local role authenticated');try{return await fn();}catch(e){await db.exec('rollback to savepoint actor');throw e;}finally{await db.exec('reset role;release savepoint actor');}}
async function fixture(fn){await db.exec('begin');try{await fn();}finally{await db.exec('rollback');}}
const room='10000000-0000-0000-0000-000000000007';
const save=()=>db.query("select * from public.save_seller_draft($1,$2,'Referenced item','Item description',100)",[randomUUID(),room]);
test('permanent reference allocation handles overlapping creation requests and survives draft deletion',()=>fixture(async()=>{
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[seller]);await db.exec('set local role authenticated');
 let results;try{results=await Promise.all(Array.from({length:20},()=>save()));}finally{await db.exec('reset role');}
 const rows=results.map(result=>result.rows[0]);assert.equal(new Set(rows.map(row=>row.lot_reference)).size,20);
 const old=rows[0];await asUser(seller,()=>db.query('select public.discard_seller_draft($1)',[old.id]));
 const next=(await asUser(seller,save)).rows[0];assert.ok(Number(next.lot_reference)>Math.max(...rows.map(row=>Number(row.lot_reference))));
 assert.equal((await db.query('select * from public.lot_reference_allocations where reference=$1',[old.lot_reference])).rows.length,1);
 await assert.rejects(asUser(seller,()=>db.query('update public.lots set lot_reference=99999 where id=$1',[next.id])),/permission denied/);
 await db.exec('savepoint forbidden');try{await assert.rejects(db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,lot_reference) values($1,$2,$3,'Reused',100,$4)",[randomUUID(),room,seller,old.lot_reference]),/duplicate key/);}finally{await db.exec('rollback to savepoint forbidden;release savepoint forbidden');}
}));
test('references remain immutable through scheduler requeue and notifications/history use the same reference',()=>fixture(async()=>{
 const id=randomUUID();await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,status,relist_unlimited,queue_position) values($1,$2,$3,'Immutable reference',100,'WAITING',true,10000)",[id,room,seller]);
 const reference=(await db.query('select lot_reference from public.lots where id=$1',[id])).rows[0].lot_reference;
 await db.exec("select set_config('app.auction_lifecycle','true',true)");
 // Retire other seeded queue entries within this rolled-back local fixture.
 await db.query("update public.lots set status='CANCELLED' where room_id=$1 and id<>$2",[room,id]);
 await db.query('select public.advance_room_lifecycle($1)',[room]);
 await db.query("update public.lots set ends_at=clock_timestamp()-interval '1 second' where id=$1",[id]);await db.query('select public.advance_room_lifecycle($1)',[room]);
 await db.query("update public.lots set ends_at=clock_timestamp()-interval '1 second' where id=$1",[id]);await db.query('select public.advance_room_lifecycle($1)',[room]);
 assert.equal((await db.query('select lot_reference from public.lots where id=$1',[id])).rows[0].lot_reference,reference);
 await db.query("update public.lots set next_eligible_at=clock_timestamp()-interval '1 second' where id=$1",[id]);await db.query('select public.advance_room_lifecycle($1)',[room]);
 await db.query("update public.lots set ends_at=clock_timestamp()-interval '1 second' where id=$1",[id]);await db.query('select public.advance_room_lifecycle($1)',[room]);
 await asUser(buyer,()=>db.query('select public.place_bid($1,125)',[id]));
 await db.query("update public.lots set ends_at=clock_timestamp()-interval '1 second' where id=$1",[id]);await db.query('select public.advance_room_lifecycle($1)',[room]);
 const history=(await asUser(buyer,()=>db.query("select * from public.completed_auctions_page_with_reference('buyer',1,0,$1)",[id]))).rows[0];assert.equal(history.lot_reference,reference);assert.equal(Number(history.sale_price),125);
 assert.ok((await db.query('select lot_reference from public.notifications where lot_id=$1',[id])).rows.every(row=>row.lot_reference===reference));
 await db.exec('savepoint immutable');try{await assert.rejects(db.query('update public.lots set lot_reference=88888 where id=$1',[id]),/permanent/);}finally{await db.exec('rollback to savepoint immutable;release savepoint immutable');}
}));
test('migration preserves legitimate pre-existing database references',async()=>{
 const legacy=await releaseDatabase({throughMigration:12});try{
  await legacy.exec('alter table public.lots add column lot_reference bigint; with refs as(select id,10000+row_number() over(order by created_at,id) ref from public.lots) update public.lots l set lot_reference=r.ref from refs r where l.id=r.id');
  const before=(await legacy.query('select id,lot_reference from public.lots order by id')).rows;await legacy.exec(migration);assert.deepEqual((await legacy.query('select id,lot_reference from public.lots order by id')).rows,before);
 }finally{await legacy.close();}
});
test('sidebar ordering, plain-text condition merging, reference parsing and manual navigation are stable',()=>{
 const rooms=[{id:'art'},{id:'general-room'},{id:'watches'}];assert.deepEqual(orderSidebarRooms(rooms).map(r=>r.id),['general-room','art','watches']);assert.equal(rooms[0].id,'art');
 assert.deepEqual(descriptionParagraphs('Condition: excellent.','excellent.'),['Condition: excellent.']);assert.deepEqual(descriptionParagraphs('Item','<script>plain text</script>'),['Item','<script>plain text</script>']);assert.deepEqual(descriptionParagraphs('Item','Condition report pending.'),['Item']);
 for(const value of ['123','Lot 123','#123','LOT #123'])assert.equal(parseLotReference(value),123);
 for(const value of ['',null,'1.5','0','-1','9007199254740992','123 or true'])assert.equal(parseLotReference(value),null);
 assert.equal(getAuctionViewingTarget({ready:true,enabled:true,displayedLotId:'queued',roomCurrentLotId:'live',isLotRoute:true,manualSelection:true}),null);
});

test('legacy serial high-water mark is retained even if its highest draft was deleted',async()=>{
 const legacy=await releaseDatabase({throughMigration:12});try{
  await legacy.exec('alter table public.lots add column lot_reference bigserial');
  const draft=(await legacy.query("insert into public.lots(room_id,seller_id,title,starting_bid) values($1,$2,'Deleted legacy reference',100) returning id,lot_reference",[room,seller])).rows[0];
  await legacy.query('delete from public.lots where id=$1',[draft.id]);await legacy.exec(migration);
  const next=(await legacy.query("insert into public.lots(room_id,seller_id,title,starting_bid) values($1,$2,'New reference',100) returning lot_reference",[room,seller])).rows[0];assert.ok(Number(next.lot_reference)>Number(draft.lot_reference));
 }finally{await legacy.close();}
});
