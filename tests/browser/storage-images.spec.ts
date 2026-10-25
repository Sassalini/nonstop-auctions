import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {mkdir,writeFile} from 'node:fs/promises';
import sharp from 'sharp';
import {RealtimeFixture} from '../helpers/realtime-fixture';
const api='http://127.0.0.1:54399';
test('measure stored photograph variants on each surface and intentional original inspection',async({page,request,context,browser})=>{
 test.setTimeout(100000);await request.post(api+'/_test/state',{data:{mode:'empty'}});await request.post(api+'/_test/state',{data:{mode:'seller'}});
 const hub=new RealtimeFixture();await hub.attach(context);
 await page.goto('/login?next=/sell');await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();await expect(page).toHaveURL(/\/sell$/);
 await page.getByLabel('Item title',{exact:true}).fill('Storage audit main');await page.getByLabel('Auction room',{exact:true}).selectOption('10000000-0000-0000-0000-000000000007');await page.getByLabel('Starting bid (GBP)',{exact:true}).fill('100');await page.locator('textarea').fill('Detailed photograph test.');
 const original=readFileSync('public/images/auction-house-background.png');
 await page.getByLabel('Item photographs',{exact:true}).setInputFiles([{name:'front.png',mimeType:'image/png',buffer:original},{name:'back.png',mimeType:'image/png',buffer:original}]);await expect(page.getByRole('img',{name:'Item photograph 2',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Submit listing',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Submit listing',exact:true}).click();await expect(page).toHaveURL(/submitted=1/);
 await request.post(api+'/_test/state',{data:{photoAuditCopies:8}});
 const objects=await(await request.get(api+'/_test/photo-metrics')).json();
 const samples:Record<string,unknown>={};
 const stats=async()=>{const trace=await(await request.get(api+'/_test/performance')).json();const images=trace.filter((r:{path:string})=>/\/storage\/v1\/object\/(?:(?:authenticated|sign)\/)?lot-photos\//.test(r.path));return {requests:images.length,bytes:images.reduce((n:number,r:{bytes:number})=>n+r.bytes,0),paths:images.map((r:{path:string;bytes:number})=>({path:r.path,bytes:r.bytes}))};};
 const visit=async(name:string,url:string)=>{const c=await browser.newContext({storageState:await context.storageState(),viewport:{width:1440,height:1000}});await hub.attach(c);const p=await c.newPage();await request.delete(api+'/_test/performance');await p.goto(url);await p.waitForTimeout(1600);await expect.poll(()=>p.locator('img[src*="/api/lot-photos/"],img[src*="/storage/v1/object/sign/"]').first().evaluate((node:HTMLImageElement)=>node.naturalWidth)).toBeGreaterThan(0);samples[name]=await stats();await c.close();};
 await visit('homepage','/');await visit('room','/rooms/general-room');await visit('account-watchlist-sales','/my-auctions');await visit('purchase-history','/won-auctions');
 await page.goto('/rooms/general-room');await expect(page.getByRole('heading',{name:'Storage audit main',exact:true,level:1})).toBeVisible();await page.waitForTimeout(1500);
 await request.delete(api+'/_test/performance');await page.getByRole('button',{name:'View Full Catalogue',exact:true}).click();await expect(page.getByRole('dialog')).toBeVisible();await page.waitForTimeout(1500);samples.catalogue=await stats();await page.getByRole('button',{name:'Close catalogue',exact:true}).click();
 await request.delete(api+'/_test/performance');await page.getByRole('button',{name:'Next photograph',exact:true}).click();await page.waitForTimeout(1000);samples.galleryNext=await stats();
 await request.delete(api+'/_test/performance');await page.getByRole('button',{name:'Open full-size image',exact:true}).click();await expect(page.getByRole('dialog').locator('img')).toBeVisible();await page.waitForTimeout(1000);samples.enlarged=await stats();await page.keyboard.press('Escape');
 await request.delete(api+'/_test/performance');await page.reload();await page.waitForTimeout(1500);samples.warmReload=await stats();
 await request.post(api+'/_test/state',{data:{photoAuditSecondRoom:true}});await request.delete(api+'/_test/performance');
 await page.locator('aside a.group[href="/rooms/jewellery-room"]').click();await expect(page.getByRole('heading',{name:'Storage audit second room',exact:true,level:1})).toBeVisible();await page.waitForTimeout(1500);samples.roomSwitch=await stats();
 const first=objects.find((o:{path:string})=>o.path.endsWith('.thumb.webp'));const display=objects.find((o:{path:string})=>o.path.endsWith('.display.webp'));
 expect(first.bytes).toBeLessThan(original.length);expect(display.bytes).toBeLessThan(original.length);
 await mkdir('audit-results/storage-images',{recursive:true});await writeFile(`audit-results/storage-images/${process.env.PHOTO_AUDIT_LABEL??'after'}.json`,JSON.stringify({profile:{thumbnailMaxDimension:400,displayMaxDimension:1600},originalBytes:original.length,thumbnailBytes:first.bytes,displayBytes:display.bytes,uploadedBytesBefore:original.length,uploadedBytesAfter:original.length+first.bytes+display.bytes,samples,notes:'One real fixture PNG, replicated to nine lots with two photographs each; fresh browser cache per visit. Supabase fixture binary response bodies, excluding headers/TLS. Warm reload uses a primed same browser.'},null,2));
 const thumb=await request.get(`/api/lot-photos/${first.path.split('/').at(-1).split('.')[0]}/thumb`);expect(thumb.status()).toBe(200);
 if(process.env.PHOTO_AUDIT_LABEL!=='before'){
  expect(thumb.headers()['cache-control']).toContain('max-age=300');expect(thumb.headers()['content-type']).toBe('image/webp');
  const conditional=await request.get(`/api/lot-photos/${first.path.split('/').at(-1).split('.')[0]}/thumb`,{headers:{'If-None-Match':thumb.headers().etag}});expect(conditional.status()).toBe(304);
 }
 if(process.env.PHOTO_AUDIT_LABEL!=='before'){
  expect((samples.homepage as {paths:{path:string}[]}).paths.every(row=>row.path.endsWith('.webp'))).toBe(true);
  expect((samples.enlarged as {paths:{path:string}[]}).paths.some(row=>row.path.endsWith('.png'))).toBe(true);
  expect((samples.warmReload as {requests:number}).requests).toBe(0);
 }
 const meta=await page.evaluate(async url=>{const image=await createImageBitmap(await(await fetch(url)).blob());const result={width:image.width,height:image.height};image.close();return result;},`/api/lot-photos/${first.path.split('/').at(-1).split('.')[0]}/thumb`);expect(Math.max(meta.width,meta.height)).toBeLessThanOrEqual(400);
 const displayPhoto=await request.get(`/api/lot-photos/${first.path.split('/').at(-1).split('.')[0]}/display`);await writeFile('audit-results/storage-images/sample-display.webp',await displayPhoto.body());await writeFile('audit-results/storage-images/sample-thumb.webp',await thumb.body());
 await request.post(api+'/_test/state',{data:{photoAuditDraft:true}});
 const privatePhoto=await context.request.get(`http://127.0.0.1:3005/api/lot-photos/${first.path.split('/').at(-1).split('.')[0]}/thumb`);expect(privatePhoto.status()).toBe(200);expect(privatePhoto.headers()['cache-control']).toContain('no-store');
 const forbidden=await request.get(`/api/lot-photos/${first.path.split('/').at(-1).split('.')[0]}/thumb`);expect(forbidden.status()).toBe(404);
 if(process.env.PHOTO_AUDIT_LABEL!=='before'){
  await request.post(api+'/_test/state',{data:{photoAuditLegacy:true}});
  const legacy=await browser.newContext({storageState:await context.storageState()});const old=await legacy.newPage();await request.delete(api+'/_test/performance');await old.goto('/rooms/general-room');await old.waitForTimeout(1200);
  const legacyStats=await stats();expect(new Set(legacyStats.paths.map((row:{path:string})=>row.path)).size).toBe(legacyStats.requests);await legacy.close();
 }


});

test('large portrait uploads retain the exact original and correctly scaled WebP variants',async({page,request})=>{
 test.setTimeout(45000);await request.post(api+'/_test/state',{data:{mode:'empty'}});await request.post(api+'/_test/state',{data:{mode:'seller'}});
 await page.goto('/login?next=/sell');await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();await expect(page).toHaveURL(/\/sell$/);
 await page.getByLabel('Item title',{exact:true}).fill('Portrait detail');await page.getByLabel('Auction room',{exact:true}).selectOption('10000000-0000-0000-0000-000000000007');await page.getByLabel('Starting bid (GBP)',{exact:true}).fill('100');await page.locator('textarea').fill('Detailed portrait photograph.');
 const original=await sharp(readFileSync('public/images/auction-house-background.png')).rotate(90).resize(2000,3000).jpeg({quality:90}).toBuffer();
 await page.getByLabel('Item photographs',{exact:true}).setInputFiles({name:'portrait.jpg',mimeType:'image/jpeg',buffer:original});await expect(page.getByRole('button',{name:'Submit listing',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Submit listing',exact:true}).click();await expect(page).toHaveURL(/submitted=1/);
 const objects=await(await request.get(api+'/_test/photo-metrics')).json();const source=objects.find((o:{path:string})=>o.path.endsWith('.jpg'));const id=source.path.split('/').at(-1).split('.')[0];
 const dimensions=await page.evaluate(async id=>{const result=[];for(const size of ['thumb','display','original']){const image=await createImageBitmap(await(await fetch(`/api/lot-photos/${id}/${size}`)).blob());result.push([image.width,image.height]);image.close();}return result;},id);
 expect(dimensions).toEqual([[267,400],[1067,1600],[2000,3000]]);
 expect((await(await request.get(`/api/lot-photos/${id}/original`)).body()).equals(original)).toBe(true);
});

test('a resumed draft completes missing variants without replacing its original',async({page,request})=>{
 await request.post(api+'/_test/state',{data:{mode:'empty'}});await request.post(api+'/_test/state',{data:{mode:'seller'}});await page.goto('/login?next=/sell');await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();await expect(page).toHaveURL(/\/sell$/);
 await page.getByLabel('Item title',{exact:true}).fill('Resumed variants');await page.getByLabel('Auction room',{exact:true}).selectOption('10000000-0000-0000-0000-000000000007');await page.getByLabel('Starting bid (GBP)',{exact:true}).fill('100');await page.locator('textarea').fill('Detailed photograph.');
 await page.getByLabel('Item photographs',{exact:true}).setInputFiles({name:'original.png',mimeType:'image/png',buffer:readFileSync('public/images/auction-house-background.png')});await expect(page.getByRole('button',{name:'Submit listing',exact:true})).toBeEnabled();
 await request.post(api+'/_test/state',{data:{failUploadAfter:2}});await page.getByRole('button',{name:'Submit listing',exact:true}).click();await expect(page.getByRole('status')).toContainText('saved in My Auctions');
 const initial=await(await request.get(api+'/_test/photo-metrics')).json();expect(initial).toHaveLength(1);
 await page.goto('/my-auctions');await page.getByRole('link',{name:'Resume submission',exact:true}).click();await request.post(api+'/_test/state',{data:{failUploadAfter:null}});await page.getByRole('button',{name:'Submit listing',exact:true}).click();await expect(page).toHaveURL(/submitted=1/);
 const final=await(await request.get(api+'/_test/photo-metrics')).json();expect(final).toHaveLength(3);expect(final.find((object:{path:string})=>object.path===initial[0].path)).toEqual(initial[0]);
});
