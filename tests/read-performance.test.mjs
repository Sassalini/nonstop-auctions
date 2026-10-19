import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after,before,test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';
let db;
const seller='00000000-0000-0000-0000-000000000101', buyer=randomUUID(), other=randomUUID(), stranger=randomUUID();
before(async()=>{
 db=await releaseDatabase({throughMigration:10});
 const before=(await db.query('select * from public.lots order by id')).rows;
 await db.exec(await readFile(new URL('../supabase/migrations/011_auction_read_performance.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query('select * from public.lots order by id')).rows,before);
 for(const id of [buyer,other,stranger])await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[id]);
});
after(async()=>{await db?.close();});
async function asUser(id,fn,role='authenticated'){
 await db.exec('savepoint client_action');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id??'']);await db.exec(`set local role ${role}`);
 try{return await fn();}catch(e){await db.exec('rollback to savepoint client_action');throw e;}finally{await db.exec('reset role;release savepoint client_action');}
}
async function fixture(fn){
 await db.exec('begin');
 try{
  const room=randomUUID();await db.query("insert into public.auction_rooms(id,name,slug) values($1,'Performance room',$2)",[room,room]);
  const lots=[];
  for(let i=0;i<120;i++){
   const lot=randomUUID();lots.push(lot);
   await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,current_bid,bid_count,highest_bidder_id,winning_bid,sold_at,status,queue_position) values($1,$2,$3,'Paged sale',100,125.5,1,$4,125.5,'2026-10-19','SOLD',$5)",[lot,room,seller,i<115?buyer:other,i+1]);
   await db.query("insert into public.lot_images(lot_id,image_url,sort_order) values($1,'/first.png',0),($1,'/second.png',1)",[lot]);
  }
  await fn(room,lots);
 }finally{await db.exec('rollback');}
}
const page=(mode,limit=51,offset=0,focus=null)=>db.query('select * from public.completed_auctions_page($1,$2,$3,$4)',[mode,limit,offset,focus]);
test('bounded history is deterministic across all pages, includes only one thumbnail and preserves price/names',()=>fixture(async()=>{
 const rows=[];
 for(const offset of [0,50,100]){
  const result=(await asUser(buyer,()=>page('buyer',50,offset))).rows;
  assert.ok(result.length<=50);rows.push(...result);
 }
 assert.equal(rows.length,115);assert.equal(new Set(rows.map(r=>r.lot_id)).size,115);
 assert.deepEqual(rows.map(r=>r.lot_id),rows.map(r=>r.lot_id).sort().reverse());
 assert.ok(rows.every(row=>Number(row.sale_price)===125.5 && row.is_buyer && row.image_url==='/first.png'));
 assert.equal((await asUser(buyer,()=>page('buyer'))).rows.length,51);
 assert.equal((await asUser(seller,()=>page('seller',50,100))).rows.length,20);
}));
test('history ownership, focus links and RPC bounds cannot expose another account',()=>fixture(async()=>{
 await assert.rejects(asUser(null,()=>page('buyer'),'anon'),/permission denied/);
 await assert.rejects(asUser(null,()=>page('buyer')),/Authentication required/);
}));
test('RLS grants stay private while active and archived rooms retain the same visibility',()=>fixture(async(room,lots)=>{
 assert.equal((await asUser(stranger,()=>page('buyer'))).rows.length,0);
 assert.equal((await asUser(buyer,()=>page('buyer',1,0,lots[0]))).rows.length,1);
 assert.equal((await asUser(stranger,()=>page('buyer',1,0,lots[0]))).rows.length,0);
 assert.equal((await asUser(other,()=>page('seller',1,0,lots[0]))).rows.length,0);
 for(const args of [['invalid',1,0],['buyer',52,0],['buyer',1,-1],['buyer',0,0]])await assert.rejects(asUser(buyer,()=>page(...args)),/Invalid history/);
 await assert.rejects(asUser(buyer,()=>db.query('select highest_bidder_id from public.lots')),/permission denied/);
 await db.query('update public.auction_rooms set is_active=false where id=$1',[room]);
 assert.equal((await asUser(buyer,()=>db.query('select id from public.auction_rooms where id=$1',[room]))).rows.length,1);
 assert.equal((await asUser(stranger,()=>db.query('select id from public.auction_rooms where id=$1',[room]))).rows.length,0);
}));
test('scheduler recovery on an unchanged preview performs no lot updates or duplicate attempts',()=>fixture(async(room)=>{
 const lot=randomUUID();await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,status,queue_position) values($1,$2,$3,'Live lot',50,'WAITING',500)",[lot,room,seller]);
 await db.query('select public.advance_room_lifecycle($1)',[room]);
 const before=(await db.query('select * from public.lots where id=$1',[lot])).rows[0];
 await db.exec(`create temp table observed_lot_writes(id uuid);
 create function pg_temp.count_lot_write() returns trigger language plpgsql as $$ begin insert into pg_temp.observed_lot_writes values(new.id); return new; end; $$;
 create trigger read_performance_observe_writes after update on public.lots for each row execute function pg_temp.count_lot_write();`);
 for(let i=0;i<5;i++)await db.query('select public.advance_room_lifecycle($1)',[room]);
 assert.deepEqual((await db.query('select * from public.lots where id=$1',[lot])).rows[0],before);
 assert.equal((await db.query('select * from pg_temp.observed_lot_writes')).rows.length,0);
 assert.equal((await db.query('select * from public.auction_attempts where lot_id=$1',[lot])).rows.length,0);
}));
