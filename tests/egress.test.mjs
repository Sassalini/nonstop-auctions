import assert from 'node:assert/strict';
import { test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';
test('current relisting scheduler does not broadcast writes for an unchanged future deadline',async()=>{
 const db=await releaseDatabase({throughMigration:13});
 try {
  const room='10000000-0000-0000-0000-000000000007';
  await db.query('select public.advance_room_lifecycle($1)',[room]);
  await db.exec(`create temp table observed_writes(id uuid);
   create function pg_temp.observe_write() returns trigger language plpgsql as $$ begin insert into pg_temp.observed_writes values(new.id); return new; end; $$;
   create trigger egress_observe after update on public.lots for each row execute function pg_temp.observe_write();`);
  const before=(await db.query('select * from public.lots order by id')).rows;
  for(let i=0;i<10;i++) await db.query('select public.advance_room_lifecycle($1)',[room]);
  assert.deepEqual((await db.query('select * from public.lots order by id')).rows,before);
  assert.equal((await db.query('select count(*)::int as n from pg_temp.observed_writes')).rows[0].n,0);
 }finally{await db.close();}
});
