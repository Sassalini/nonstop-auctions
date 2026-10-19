import { chromium } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';
import { mkdir, writeFile } from 'node:fs/promises';
import { RealtimeFixture } from '../tests/helpers/realtime-fixture.ts';
const api='http://127.0.0.1:54399',app='http://127.0.0.1:3005';
await fetch(api+'/_test/state',{method:'POST',body:JSON.stringify({mode:'global'})});
const cookies=new Map();
const client=createServerClient(api,'sb_publishable_browser_test',{cookies:{getAll:()=>[...cookies].map(([name,value])=>({name,value})),setAll:values=>values.forEach(c=>cookies.set(c.name,c.value))}});
const {error}=await client.auth.signInWithPassword({email:'one@example.test',password:'fixturepassword'});if(error)throw error;
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
try{
 const context=await browser.newContext();const hub=new RealtimeFixture();await hub.attach(context);
 await context.addCookies([...cookies].map(([name,value])=>({name,value,url:app,sameSite:'Lax'})));
 const page=await context.newPage();
 for(const [name,path,heading] of [['room','/rooms/general-room','Release test catalogue item'],['room-switch','/rooms/jewellery-room','Jewellery fixture lot'],['my-auctions','/my-auctions','Track bids, watched lots, and seller activity.']]){
  await fetch(api+'/_test/performance',{method:'DELETE'});
  const requests=[];const onRequest=r=>{if(r.url().includes('/api/')||r.url().includes('_rsc')||r.url().startsWith(api))requests.push(r.url());};page.on('request',onRequest);
  const start=performance.now();await page.goto(app+path);
  await page.getByRole('heading',{name:heading,exact:true}).waitFor();const headingMs=performance.now()-start;
  await page.waitForTimeout(2000);page.off('request',onRequest);
  results.push({name,headingMs,browserRequests:requests.length,liveCatalogueRequests:requests.filter(url=>url.includes('/api/live-lots')).length,realtime:hub.snapshot(),trace:await(await fetch(api+'/_test/performance')).json()});
 }
 await context.close();
}finally{await browser.close();}
await mkdir('performance-results',{recursive:true});
await writeFile(`performance-results/performance-browser-${process.argv[2]??'current'}.json`,JSON.stringify(results,null,2));
console.log(results.map(({trace,...r})=>({...r,supabaseRequests:trace.length})));
