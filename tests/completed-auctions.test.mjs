import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';
let db;
const seller='00000000-0000-0000-0000-000000000101', buyer=randomUUID(), stranger=randomUUID();
before(async()=>{
 db=await releaseDatabase({throughMigration:9});
 const soldBefore=(await db.query("select * from public.lots where status='SOLD' order by id")).rows;
 await db.exec(await readFile(new URL('../supabase/migrations/010_completed_auctions_and_immediate_requeue.sql',import.meta.url),'utf8'));
 assert.deepEqual((await db.query("select * from public.lots where status='SOLD' order by id")).rows,soldBefore);
 await db.query('insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())',[buyer,stranger]);
});
after(async()=>{await db?.close();});
async function as(id,fn,role='authenticated') {
 await db.exec('savepoint client');
 await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id??'']);
 await db.exec(`set local role ${role}`);
 try {return await fn();}catch(e){await db.exec('rollback to savepoint client');throw e;}
 finally{await db.exec('reset role;release savepoint client');}
}
async function fixture(fn){
 await db.exec('begin');
 const room=randomUUID(),lot=randomUUID();
 await db.query("insert into public.auction_rooms(id,name,slug) values($1::uuid,'History room',$1::text)",[room]);
 await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,status,queue_position) values($1,$2,$3,'History item',100,'WAITING',1)",[lot,room,seller]);
 try{await fn(room,lot);}finally{await db.exec('rollback');}
}
const advance=room=>db.query('select * from public.advance_room_lifecycle($1)',[room]);
async function expire(lot){await db.exec("select set_config('app.auction_lifecycle','true',true)");await db.query("update public.lots set ends_at=clock_timestamp()-interval '1 second' where id=$1",[lot]);await db.exec("select set_config('app.auction_lifecycle','false',true)");}
const row=async lot=>(await db.query('select * from public.lots where id=$1',[lot])).rows[0];
test('authoritative sale persists buyer/seller history, prices, private names and bid history',()=>fixture(async(room,lot)=>{
 await advance(room);await expire(lot);await advance(room);
 await as(buyer,()=>db.query('select public.place_bid($1,125.50)',[lot]));
 await expire(lot);const result=await as(null,()=>advance(room),'anon');
 assert.equal(result.rows[0].highest_bidder_id,null);
 assert.equal((await row(lot)).highest_bidder_id,buyer);
 assert.equal(Number((await row(lot)).winning_bid),125.50);
 const history=()=>db.query('select * from public.my_completed_auctions()');
 const own=(await as(buyer,history)).rows;
 assert.equal(own.length,1);assert.equal(own[0].lot_id,lot);assert.equal(Number(own[0].sale_price),125.50);assert.equal(own[0].is_buyer,true);
 assert.equal((await as(seller,history)).rows.some(r=>r.lot_id===lot),true);
 assert.equal((await as(stranger,history)).rows.length,0);
 await assert.rejects(as(null,history,'anon'),/permission denied/);
 await assert.rejects(as(stranger,()=>db.query('select highest_bidder_id from public.lots')),/permission denied/);
 assert.equal((await as(seller,()=>db.query('select * from public.bids where lot_id=$1',[lot]))).rows.length,1);
 assert.equal((await as(stranger,()=>db.query('select * from public.bids where lot_id=$1',[lot]))).rows.length,0);
 await db.query('update public.auction_rooms set is_active=false where id=$1',[room]);
 assert.equal((await as(buyer,()=>db.query('select id,title,winning_bid from public.lots where id=$1',[lot]))).rows.length,1);
 assert.equal((await as(buyer,history)).rows.length,1);
 assert.equal((await as(buyer,()=>db.query('select id from public.auction_rooms where id=$1',[room]))).rows.length,1);
}));
test('single unsold lot waits sixty seconds, preserves attempts and suppresses repeated unsold notices',()=>fixture(async(room,lot)=>{
 await db.query('insert into public.watchlist(user_id,lot_id) values($1,$2)',[buyer,lot]);
 await advance(room);await expire(lot);await advance(room);await expire(lot);await advance(room);
 const unsold=await row(lot);assert.equal(unsold.status,'UNSOLD');
 assert.ok(new Date(unsold.next_eligible_at)-Date.now()>58000);
 for(let i=0;i<5;i++)await advance(room);
 assert.equal((await row(lot)).status,'UNSOLD');
 assert.equal((await db.query('select * from public.auction_attempts where lot_id=$1',[lot])).rows.length,1);
 await db.exec("select set_config('app.auction_lifecycle','true',true)");
 await db.query("update public.lots set next_eligible_at=clock_timestamp()-interval '1 second' where id=$1",[lot]);
 await db.exec("select set_config('app.auction_lifecycle','false',true)");
 await advance(room);assert.equal((await row(lot)).status,'PREVIEW');
 await expire(lot);await advance(room);await expire(lot);await advance(room);
 assert.equal((await db.query('select * from public.auction_attempts where lot_id=$1',[lot])).rows.length,2);
 assert.equal((await db.query("select * from public.notifications where lot_id=$1 and kind='WATCHED_UNSOLD'",[lot])).rows.length,1);
}));
test('unsold returns behind all waiting lots; rooms cycle independently with one current lot',()=>fixture(async(room,lot)=>{
 const second=randomUUID();await db.query("insert into public.lots(id,room_id,seller_id,title,starting_bid,status,queue_position) values($1,$2,$3,'Next item',50,'WAITING',2)",[second,room,seller]);
 await advance(room);await expire(lot);await advance(room);await expire(lot);await advance(room);
 assert.equal((await row(lot)).status,'UNSOLD');assert.equal((await row(second)).status,'PREVIEW');
 assert.ok((await row(lot)).queue_position>(await row(second)).queue_position);
 assert.ok(new Date((await row(lot)).next_eligible_at)<=new Date());
 for(let i=0;i<5;i++)await advance(room);
 assert.equal((await db.query("select id from public.lots where room_id=$1 and status in ('PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING')",[room])).rows.length,1);
 await expire(second);await advance(room);await expire(second);await advance(room);
 assert.equal((await row(lot)).status,'PREVIEW');assert.equal((await row(lot)).bid_count,0);
}));

