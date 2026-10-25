import { expect, test } from '@playwright/test';
import { RealtimeFixture } from '../helpers/realtime-fixture';
const state='http://127.0.0.1:54399/_test/state';
const first='20000000-0000-0000-0000-000000000701',next='20000000-0000-0000-0000-000000000702';
const preference='nonstop-auctions:auto-play';
for(const width of [375,768,1440])test(`gallery, room badges and description are accessible at ${width}px`,async({page,request,context})=>{
 await request.post(state,{data:{mode:'empty'}});await request.post(state,{data:{mode:'gallery'}});const hub=new RealtimeFixture();await hub.attach(context);
 await page.setViewportSize({width,height:900});await page.goto('/rooms/general-room');
 await expect(page.getByRole('heading',{name:'Gallery fixture lot',exact:true})).toBeVisible();
 const cards=page.locator('aside a.group');await expect(cards.first()).toHaveAttribute('href','/rooms/general-room');
 const footers=page.getByTestId('room-status-footer');expect(await footers.evaluateAll(nodes=>nodes.every(node=>{const badge=node.querySelector('span');if(!badge)return false;const a=node.getBoundingClientRect(),b=badge.getBoundingClientRect();return b.left>=a.left&&b.right<=a.right&&b.top>=a.top&&b.bottom<=a.bottom;}))).toBe(true);
 await expect(page.getByRole('button',{name:'Audio',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Next photograph',exact:true}).click();await expect(page.getByRole('button',{name:'Show photograph 2',exact:true})).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId('main-lot-image')).toHaveAttribute('src',/gallery=2/);
 const expand=page.getByRole('button',{name:'Open full-size image',exact:true});await expand.click();const viewer=page.getByRole('dialog');await expect(viewer).toBeVisible();await expect(viewer.locator('img')).toHaveCSS('object-fit','contain');
 await page.keyboard.press('Shift+Tab');await expect(page.getByRole('button',{name:'Next enlarged photograph',exact:true})).toBeFocused();await page.keyboard.press('Tab');await expect(page.getByRole('button',{name:'Close image viewer',exact:true})).toBeFocused();
 await page.keyboard.press('ArrowRight');await expect(viewer.locator('img')).toHaveAttribute('src',/gallery=3/);await expect(page.getByRole('button',{name:'Show photograph 3',exact:true})).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('Escape');await expect(viewer).toHaveCount(0);await expect(expand).toBeFocused();
 await expand.click();await page.getByRole('button',{name:'Close image viewer',exact:true}).click();await expect(expand).toBeFocused();
 await expect(page.getByRole('button',{name:'Condition Report',exact:true})).toHaveCount(0);await expect(page.getByText('Additional condition information.',{exact:true})).toBeVisible();await expect(page.getByText('Costs',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/lot-polish-${width}.png`,fullPage:width<1000});
 await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Selected queued lot',exact:true})}).click();await expect(page.getByRole('heading',{name:'Selected queued lot',exact:true,level:1})).toBeVisible();await expect(page.getByRole('button',{name:'Next photograph',exact:true})).toHaveCount(0);await expect(page.getByTestId('main-lot-image')).not.toHaveAttribute('src',/gallery=3/);
 await page.goto(`/lots/${first}?view=manual`);await expect(page.getByRole('button',{name:'Show photograph 3',exact:true})).toBeVisible();
});
test('manual selection survives Realtime and reload without changing Auto-play; returning resumes live',async({page,request,context})=>{
 await request.post(state,{data:{mode:'empty'}});await request.post(state,{data:{mode:'sequence'}});const hub=new RealtimeFixture();await hub.attach(context);await page.goto('/rooms/general-room');
 await page.getByRole('link').filter({has:page.getByRole('heading',{name:'Next sequence lot',exact:true})}).click();await expect(page).toHaveURL(new RegExp(`${next}\\?view=manual$`));await expect(page.getByRole('button',{name:'Bidding Not Open',exact:true})).toBeDisabled();
 expect(await page.evaluate(key=>localStorage.getItem(key),preference)).not.toBe('off');await expect(page.getByRole('switch',{name:'Auto-play',exact:true})).toHaveAttribute('aria-checked','true');
 hub.emit('lots',{id:first,room_id:'10000000-0000-0000-0000-000000000007',status:'ACTIVE_BIDDING'});await page.reload();await expect(page.getByRole('heading',{name:'Next sequence lot',exact:true,level:1})).toBeVisible();
 await page.getByRole('link',{name:'Return to Live Auction',exact:true}).click();await expect(page.getByRole('heading',{name:'Sequence current lot',exact:true,level:1})).toBeVisible();
 await request.post(state,{data:{sequenceResult:'SOLD'}});hub.emit('lots',{id:first,room_id:'10000000-0000-0000-0000-000000000007',status:'SOLD'});await expect(page.getByRole('heading',{name:'Next sequence lot',exact:true,level:1})).toBeVisible();await expect(page).not.toHaveURL(/view=manual/);
});
for(const width of [375,1440])test(`full catalogue stays in room, paginates, closes and selects at ${width}px`,async({page,request,context})=>{
 await request.post(state,{data:{mode:'empty'}});await request.post(state,{data:{mode:'catalogue'}});const hub=new RealtimeFixture();await hub.attach(context);await page.setViewportSize({width,height:900});await page.goto('/rooms/general-room');const previous=page.url();
 const button=page.getByRole('button',{name:'View Full Catalogue',exact:true});await button.click();const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(dialog.getByRole('link')).toHaveCount(24);expect(page.url()).toBe(previous);
 await expect(dialog.getByText(/Excluded|Returned/)).toHaveCount(0);await expect(dialog.getByRole('heading',{name:'Catalogue item 1',exact:true})).toBeVisible();
 expect(await dialog.evaluate(node=>{const r=node.getBoundingClientRect();return r.width<=innerWidth&&r.height<=innerHeight;})).toBe(true);
 await dialog.getByRole('button',{name:'Next',exact:true}).click();await expect(dialog.getByText('Page 2',{exact:true})).toBeVisible();await expect(dialog.getByRole('heading',{name:'Catalogue item 24',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(button).toBeFocused();expect(page.url()).toBe(previous);
 await button.click();await expect(dialog.getByRole('heading',{name:'Catalogue item 1',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close catalogue',exact:true}).click();await expect(button).toBeFocused();
 await button.click();await dialog.getByRole('link').filter({has:page.getByRole('heading',{name:'Catalogue item 2',exact:true})}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'Catalogue item 2',exact:true,level:1})).toBeVisible();await expect(page.getByRole('link',{name:'Return to Live Auction',exact:true})).toBeVisible();
 await expect(page.getByText('Returned',{exact:true})).toHaveCount(0);await expect(page.locator('aside a.group[href="/rooms/general-room"]')).toHaveClass(/border-auction-gold\/70/);
});
test('reference search finds the stable lot and queued catalogue fetch is bounded and validated',async({page,request})=>{
 await request.post(state,{data:{mode:'empty'}});await request.post(state,{data:{mode:'gallery'}});await page.goto('/search?q=Lot+1001');await expect(page.getByRole('link',{name:'Gallery fixture lot',exact:true})).toBeVisible();await page.getByRole('link',{name:'Gallery fixture lot',exact:true}).click();await expect(page.getByRole('heading',{name:'Gallery fixture lot',exact:true,level:1})).toBeVisible();
 const bad=await request.get('/api/rooms/general-room/catalogue?page=-1');expect(bad.status()).toBe(400);
 await request.post(state,{data:{mode:'catalogue'}});const response=await request.get('/api/rooms/general-room/catalogue?page=1');expect(response.ok()).toBe(true);const data=await response.json();expect(data.lots.length).toBe(24);expect(data.hasNext).toBe(true);expect(data.lots.every((lot:{auctionStatus:string})=>!['SOLD','CANCELLED','EXPIRED'].includes(lot.auctionStatus))).toBe(true);
});
