import { createServerClient } from '@supabase/ssr';
import { mkdir, writeFile } from 'node:fs/promises';
const api='http://127.0.0.1:54399', app='http://127.0.0.1:3005';
await fetch(`${api}/_test/state`,{method:'POST',body:JSON.stringify({mode:'performance'})});
const { delayMs } = await (await fetch(`${api}/_test/performance-config`)).json();
const cookies = new Map();
const auth = createServerClient(api,'sb_publishable_browser_test',{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:items=>items.forEach(item=>cookies.set(item.name,item.value))}});
const loginStart=performance.now();
const {error}=await auth.auth.signInWithPassword({email:'one@example.test',password:'fixturepassword'});
if(error) throw error;
const loginMs=performance.now()-loginStart;
const headers={Cookie:[...cookies].map(([name,value])=>`${name}=${value}`).join('; ')};
const results=[];
for(const [name,path,privatePage] of [['home','/',false],['room','/rooms/general-room',false],['lot','/lots/20000000-0000-0000-0000-000000000701',false],['my-auctions','/my-auctions',true],['won-auctions','/won-auctions',true],['room-authenticated','/rooms/jewellery-room',true]]){
 for(let sample=0;sample<4;sample++){
  await fetch(`${api}/_test/performance`,{method:'DELETE'});
  const start=performance.now();const response=await fetch(app+path,{headers:privatePage?headers:{}});const ttfbMs=performance.now()-start;
  const html=await response.text();const totalMs=performance.now()-start;
  if(!response.ok||html.includes('Could not load your auction account.')) throw new Error(`${name}: HTTP ${response.status}`);
  const trace=await(await fetch(`${api}/_test/performance`)).json();
  results.push({name,sample,phase:sample===0?'route-first':'warm',ttfbMs,totalMs,htmlBytes:Buffer.byteLength(html),requests:trace.length,rows:trace.reduce((sum,r)=>sum+r.rows,0),apiBytes:trace.reduce((sum,r)=>sum+r.bytes,0),authRequests:trace.filter(r=>r.path.startsWith('/auth')).length,trace});
 }
}
await mkdir('performance-results',{recursive:true});
const file=`performance-results/performance-${process.argv[2]??'current'}.json`;
await writeFile(file,JSON.stringify({description:'Local next start SSR; 254 lots, 762 photos, 120 purchases and 120 sales; fixed fixture API latency per request. Route-first is first visit to each route in one fresh process, not Cloudflare cold start. Warm is median of 3.',delayMs,loginMs,results},null,2));
for(const name of [...new Set(results.map(r=>r.name))]){
 const rows=results.filter(r=>r.name===name), warm=rows.slice(1).map(r=>r.totalMs).sort((a,b)=>a-b);
 console.log(JSON.stringify({name,firstMs:Math.round(rows[0].totalMs),warmMedianMs:Math.round(warm[1]),requests:rows[1].requests,rows:rows[1].rows,apiBytes:rows[1].apiBytes,authRequests:rows[1].authRequests}));
}
console.log(`Evidence: ${file}`);
