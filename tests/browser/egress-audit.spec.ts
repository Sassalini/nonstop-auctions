import { test, expect } from '@playwright/test';
import { writeFile, mkdir } from 'node:fs/promises';
import { RealtimeFixture } from '../helpers/realtime-fixture';
const api='http://127.0.0.1:54399';
test('repeatable egress audit: authenticated visit, idle, bid burst and navigation',async({page,request,context})=>{
 test.setTimeout(100000);
 const idleMs=Number(process.env.AUDIT_IDLE_MS??32000);
 await request.post(api+'/_test/state',{data:{mode:'empty'}});await request.post(api+'/_test/state',{data:{mode:'global'}});await request.post(api+'/_test/state',{data:{mode:'gallery'}});
 await request.post(api+'/_test/state',{data:{accountsEnabled:true}});
 const hub=new RealtimeFixture();await hub.attach(context);
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByRole('button',{name:'Notifications (1 unread)',exact:true})).toBeVisible();
 await request.delete(api+'/_test/performance');
 await page.goto('/rooms/general-room');await expect(page.getByRole('heading',{name:'Gallery fixture lot',exact:true})).toBeVisible();await page.waitForTimeout(2000);
 const initial=await(await request.get(api+'/_test/performance')).json();const channels=hub.snapshot();
 await request.delete(api+'/_test/performance');for(let remaining=idleMs;remaining>0;remaining-=30000)await page.waitForTimeout(Math.min(remaining,30000));
 const idle=await(await request.get(api+'/_test/performance')).json();
 if(process.env.AUDIT_LABEL!=='before'){expect(idle.length).toBeLessThanOrEqual(idleMs>60000?20:2);expect(channels.channels).toBe(2);}
 await request.delete(api+'/_test/performance');
 for(let i=0;i<5;i++){hub.emit('lots',{id:'20000000-0000-0000-0000-000000000701',room_id:'10000000-0000-0000-0000-000000000007',status:'PREVIEW'});await page.waitForTimeout(350);}
 await page.waitForTimeout(1500);const burst=await(await request.get(api+'/_test/performance')).json();
 await page.goto('/my-auctions');await page.waitForTimeout(1000);const afterNavigation=hub.snapshot();
 const summarize=(rows:{path:string;bytes:number}[])=>({requests:rows.length,bytes:rows.reduce((n,r)=>n+r.bytes,0),byPath:Object.fromEntries([...new Set(rows.map(r=>r.path))].map(path=>[path,{requests:rows.filter(r=>r.path===path).length,bytes:rows.filter(r=>r.path===path).reduce((n,r)=>n+r.bytes,0)}]))});
 await mkdir('audit-results',{recursive:true});await writeFile(`audit-results/${process.env.AUDIT_LABEL??'current'}.json`,JSON.stringify({initial:summarize(initial),idle:{durationMs:idleMs,...summarize(idle)},fiveEvents:summarize(burst),channels,afterNavigation,notes:'Fixture uncompressed JSON bodies, not production wire bytes. Gallery uses local fixture photographs; no production image-size claim.'},null,2));
});


test('signed image token rotation does not redownload a mounted original',async({page,request,context})=>{
 await request.post(api+'/_test/state',{data:{mode:'empty'}});await request.post(api+'/_test/state',{data:{mode:'gallery'}});await request.post(api+'/_test/state',{data:{signedImageToken:'first'}});
 const hub=new RealtimeFixture();await hub.attach(context);
 await page.goto('/rooms/general-room');await expect(page.getByTestId('main-lot-image')).toBeVisible();await page.waitForTimeout(1500);
 await request.delete(api+'/_test/performance');await request.post(api+'/_test/state',{data:{signedImageToken:'second'}});
 const refreshed=page.waitForResponse(r=>r.url().includes('/rooms/general-room')&&r.request().headers()['rsc']==='1');
 hub.emit('lots',{id:'20000000-0000-0000-0000-000000000701',room_id:'10000000-0000-0000-0000-000000000007',status:'PREVIEW'});await refreshed;await page.waitForTimeout(1500);
 const trace=await(await request.get(api+'/_test/performance')).json();const photos=trace.filter((r:{path:string})=>r.path.includes('/object/sign/lot-photos/audit.png'));
 await mkdir('audit-results',{recursive:true});await writeFile(`audit-results/images-${process.env.AUDIT_LABEL??'current'}.json`,JSON.stringify({requests:photos.length,bytes:photos.reduce((n:number,r:{bytes:number})=>n+r.bytes,0),sourceBytes:2891942,scenario:'One already-mounted original; rotate signed token and trigger one Realtime RSC refresh. Local fixture PNG, not a production photo.'},null,2));
 if(process.env.AUDIT_LABEL!=='before')expect(photos).toHaveLength(0);
});
