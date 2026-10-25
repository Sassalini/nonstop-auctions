import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {before,after,test} from 'node:test';
import {releaseDatabase} from './helpers/release-database.mjs';
let db;const seller=randomUUID(),other=randomUUID();
before(async()=>{db=await releaseDatabase({throughMigration:14});await db.query('insert into auth.users(id,email_confirmed_at) values($1,now()),($2,now())',[seller,other]);});
after(async()=>{await db?.close();});
async function actor(id,fn,role='authenticated'){await db.exec('savepoint actor');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[id??'']);await db.exec('set local role '+role);try{return await fn();}catch(e){await db.exec('rollback to savepoint actor');throw e;}finally{await db.exec('reset role;release savepoint actor');}}
async function fixture(fn){await db.exec('begin');try{const room=randomUUID();await db.query("insert into public.auction_rooms(id,name,slug) values($1,'Photo room',$2)",[room,room]);const lot=(await actor(seller,()=>db.query("select * from public.save_seller_draft($1,$2,'Photo item','Description',100)",[randomUUID(),room]))).rows[0];const image=(await actor(seller,()=>db.query("select * from public.prepare_seller_photo_variants($1,$2,'png')",[lot.id,randomUUID()]))).rows[0];await fn(room,lot,image);}finally{await db.exec('rollback');}}
async function upload(path,type='image/webp'){return actor(seller,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('lot-photos',$1,$2)",[path,JSON.stringify({mimetype:type,size:1000})]));}
test('variants preserve private draft, public visibility, immutable originals and ownership',()=>fixture(async(room,lot,image)=>{
 assert.equal(image.thumbnail_path,image.storage_path+'.thumb.webp');assert.equal(image.display_path,image.storage_path+'.display.webp');
 for(const path of [image.storage_path,image.thumbnail_path,image.display_path]){await upload(path,path===image.storage_path?'image/png':'image/webp');await assert.rejects(actor(other,()=>db.query("insert into storage.objects(bucket_id,name,metadata) values('lot-photos',$1,'{}')",[path+'other'])));}
 assert.equal((await actor(null,()=>db.query('select * from storage.objects'), 'anon')).rows.length,0);
 assert.equal((await actor(other,()=>db.query("select * from public.lot_photo_delivery($1,'thumb')",[image.id]))).rows.length,0);
 assert.equal((await actor(seller,()=>db.query("select * from public.lot_photo_delivery($1,'thumb')",[image.id]))).rows[0].public_cache,false);
 assert.equal((await actor(seller,()=>db.query("update storage.objects set metadata='{}' where name=$1 returning id",[image.storage_path]))).rows.length,0);
 await actor(seller,()=>db.query('select public.submit_seller_lot($1)',[lot.id]));
 assert.equal((await actor(null,()=>db.query('select * from storage.objects'),'anon')).rows.length,3);
 const delivery=(await actor(null,()=>db.query("select * from public.lot_photo_delivery($1,'thumb')",[image.id]),'anon')).rows[0];assert.equal(delivery.object_path,image.thumbnail_path);assert.equal(delivery.public_cache,true);
 await assert.rejects(upload(image.storage_path+'extra'));
 await db.query('update public.auction_rooms set is_active=false where id=$1',[room]);assert.equal((await actor(null,()=>db.query('select * from storage.objects'),'anon')).rows.length,0);
 assert.equal((await db.query("select public from storage.buckets where id='lot-photos'")).rows[0].public,false);
}));
test('incomplete variants cannot publish and removal accounts for every stored variant',()=>fixture(async(_room,lot,image)=>{
 await upload(image.storage_path,'image/png');await upload(image.thumbnail_path);
 await assert.rejects(actor(seller,()=>db.query('select public.submit_seller_lot($1)',[lot.id])),/Finish uploading/);
 await actor(seller,()=>db.query("delete from storage.objects where name=$1",[image.storage_path]));
 await assert.rejects(actor(seller,()=>db.query('select public.remove_seller_photo($1)',[image.id])),/variants/);
 await actor(seller,()=>db.query("delete from storage.objects where name=$1",[image.thumbnail_path]));await actor(seller,()=>db.query('select public.discard_seller_draft($1)',[lot.id]));
 assert.equal((await db.query('select * from public.lot_images where id=$1',[image.id])).rows.length,0);
}));
test('operator attachment requires complete derivatives and is unavailable to client roles',()=>fixture(async(_room,_lot,image)=>{
 await assert.rejects(actor(seller,()=>db.query('select public.register_existing_photo_variants($1)',[image.id])),/permission denied/);
 await assert.rejects(db.query('select public.register_existing_photo_variants($1)',[image.id]),/Upload and validate/);
}));
