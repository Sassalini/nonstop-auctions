import { releaseDatabase } from '../tests/helpers/release-database.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const db=await releaseDatabase({throughMigration:9});
const seller='00000000-0000-0000-0000-000000000101',buyer='00000000-0000-0000-0000-000000000901';
await db.query('insert into auth.users(id,email_confirmed_at) values($1,now())',[buyer]);
await db.exec(`insert into public.lots(room_id,seller_id,title,starting_bid,current_bid,bid_count,highest_bidder_id,winning_bid,sold_at,status,queue_position)
 select '10000000-0000-0000-0000-000000000007','${seller}','Measured completed lot',100,125,1,'${buyer}',125,now()-make_interval(secs=>n),'SOLD',n+100 from generate_series(1,5000)n;
 analyze public.lots; analyze public.auction_rooms;`);
const queries={rooms:"select id,name from public.auction_rooms where is_active",catalogue:"select id,title from public.lots where status in ('WAITING','PREVIEW','FIRST_BID_WINDOW','ACTIVE_BIDDING','SOLD','UNSOLD','CANCELLED') order by queue_position,created_at,id limit 1000",history:"select * from public.my_completed_auctions()"};
queries.historyPageBase = "select id,winning_bid,sold_at from public.lots where status='SOLD' and highest_bidder_id=(select auth.uid()) order by sold_at desc,id desc limit 51";
const results=[];
async function measure(label){
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[buyer]);await db.exec('set role authenticated');
 for(const [name,sql] of Object.entries(queries)){
  if(name==='history' && label==='009')continue;
  if(name === "historyPageBase") await db.exec("reset role");
  const samples=[];let plan;
  for(let n=0;n<4;n++){
   const result=await db.query('explain (analyze,buffers,format json) '+sql);plan=result.rows[0]['QUERY PLAN'][0];samples.push(plan['Execution Time']);
  }
  if(name === "historyPageBase") await db.exec("set role authenticated");
  results.push({label,name,firstMs:samples[0],warmMedianMs:samples.slice(1).sort((a,b)=>a-b)[1],plan});
 }
 await db.exec('reset role');
}
await measure('009');
await db.exec(await readFile('supabase/migrations/010_completed_auctions_and_immediate_requeue.sql','utf8'));
await measure('010');
if(process.argv[2]){await db.exec(await readFile(process.argv[2],'utf8'));queries.historyPage = "select * from public.completed_auctions_page('buyer',51,0)";await db.exec('analyze public.lots');await measure('011');}
await mkdir('performance-results',{recursive:true});await writeFile('performance-results/performance-database.json',JSON.stringify(results,null,2));
console.log(results.map(r=>({label:r.label,name:r.name,firstMs:r.firstMs,warmMedianMs:r.warmMedianMs})));await db.close();
