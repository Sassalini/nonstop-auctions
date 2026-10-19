import { expect, test } from '@playwright/test';
const api='http://127.0.0.1:54399';
const lot='20000000-0000-0000-0000-000000000701';

test('room reads stay scoped as completed catalogue grows, and lot details are not fetched twice',async({request})=>{
 await request.post(api+'/_test/state',{data:{mode:'performance'}});
 await request.delete(api+'/_test/performance');
 const room=await request.get('/rooms/general-room');expect(room.ok()).toBe(true);
 const trace=await(await request.get(api+'/_test/performance')).json();
 const lotReads=trace.filter((r:{path:string})=>r.path==='/rest/v1/lots');
 expect(lotReads).toHaveLength(2); // room cards' current lots + this room's bounded queue
 expect(lotReads.every((r:{rows:number})=>r.rows<=5)).toBe(true);
 expect(trace.filter((r:{path:string})=>r.path.includes('/object/sign/')).every((r:{rows:number})=>r.rows<=18)).toBe(true);
 await request.delete(api+'/_test/performance');
 const detail=await request.get(`/lots/${lot}`);expect(detail.ok()).toBe(true);
 const detailTrace=await(await request.get(api+'/_test/performance')).json();
 expect(detailTrace.filter((r:{path:string;query:string})=>r.path==='/rest/v1/lots' && new URLSearchParams(r.query).get('id')===`eq.${lot}`)).toHaveLength(1);
});

test('buyer and seller history remain accessible across bounded pages and focused notification links',async({page,request})=>{
 await request.post(api+'/_test/state',{data:{mode:'performance'}});
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await page.goto('/won-auctions');
 await expect(page.locator('#won-auctions article')).toHaveCount(50);
 await page.getByRole('navigation',{name:'Won auction pages'}).getByRole('link',{name:'Next',exact:true}).click();
 await expect(page).toHaveURL(/historyPage=2/);await expect(page.locator('#won-auctions article')).toHaveCount(50);
 await page.getByRole('navigation',{name:'Won auction pages'}).getByRole('link',{name:'Next',exact:true}).click();
 await expect(page.locator('#won-auctions article')).toHaveCount(20);
 await page.getByRole('navigation',{name:'Won auction pages'}).getByRole('link',{name:'Previous',exact:true}).click();await expect(page).toHaveURL(/historyPage=2/);
 // A notification can open an older purchase that is not on the first page.
 const old='40000000-0000-0000-0000-000000000001';
 await page.goto(`/won-auctions?lot=${old}#${old}`);
 await expect(page.locator('#won-auctions article')).toHaveCount(1);await expect(page.locator(`[id="${old}"]`)).toBeVisible();
 await page.getByRole('link',{name:'View all Won Auctions',exact:true}).click();await expect(page.locator('#won-auctions article')).toHaveCount(50);
 await page.goto('/my-auctions');await expect(page.locator('#sold-auctions article')).toHaveCount(50);
 await page.getByRole('navigation',{name:'Sold auction pages'}).getByRole('link',{name:'Next',exact:true}).click();await expect(page.locator('#sold-auctions article')).toHaveCount(50);
});
