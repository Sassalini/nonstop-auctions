import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { RealtimeFixture } from '../helpers/realtime-fixture';
const fixture='http://127.0.0.1:54399/_test/state';
const hall='10000000-0000-0000-0000-000000000007';
const first='20000000-0000-0000-0000-000000000701';
const second='20000000-0000-0000-0000-000000000702';
async function login(page:Page,next='/my-auctions'){
 await page.goto(`/login?next=${next}`);await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();await expect(page).toHaveURL(new RegExp(`${next}$`));
}
for(const mode of ['zero','five','unlimited'])test(`seller form persists ${mode} relisting preference`,async({page,request})=>{
 await request.post(fixture,{data:{mode:'empty'}});await request.post(fixture,{data:{mode:'seller'}});await login(page,'/sell');
 const limit=page.getByLabel('Number of automatic relistings',{exact:true}),unlimited=page.getByLabel('Keep relisting until sold',{exact:true});
 await expect(limit).toHaveValue('5');await expect(unlimited).not.toBeChecked();
 await limit.fill('101');expect(await limit.evaluate((el:HTMLInputElement)=>el.validity.rangeOverflow)).toBe(true);
 await limit.fill('1.5');expect(await limit.evaluate((el:HTMLInputElement)=>el.validity.stepMismatch)).toBe(true);
 await limit.fill(mode==='zero'?'0':'5');if(mode==='unlimited'){await unlimited.check();await expect(limit).toBeDisabled();await unlimited.uncheck();await expect(limit).toBeEnabled();await unlimited.check();}
 await page.getByLabel('Item title',{exact:true}).fill(`Relisting ${mode}`);await page.getByLabel('Auction room',{exact:true}).selectOption(hall);await page.getByLabel('Starting bid (GBP)',{exact:true}).fill('25.50');await page.locator('textarea').fill('Detailed listing description');
 await page.getByLabel('Item photographs',{exact:true}).setInputFiles({name:'front.png',mimeType:'image/png',buffer:readFileSync('public/images/auction-house-background.png')});
 await page.getByRole('button',{name:'Submit listing',exact:true}).click();await expect(page).toHaveURL(/my-auctions\?submitted=1/);
 const [lot]=await(await request.get('http://127.0.0.1:54399/rest/v1/lots')).json();expect(lot.max_auto_relistings).toBe(mode==='zero'?0:5);expect(lot.relist_unlimited).toBe(mode==='unlimited');expect(lot.auto_relistings_used).toBe(0);
});
for(const width of [375,1440])test(`seller management, confirmation and pending active removal at ${width}px`,async({page,context,request})=>{
 await request.post(fixture,{data:{mode:'empty'}});await request.post(fixture,{data:{mode:'management'}});const hub=new RealtimeFixture();await hub.attach(context);await page.setViewportSize({width,height:1000});await login(page);
 const queued=page.locator('article').filter({has:page.getByRole('heading',{name:'Queued managed listing',exact:true})});
 await queued.getByRole('button',{name:'Manage relistings',exact:true}).click();await queued.getByLabel('Keep relisting until sold',{exact:true}).check();await expect(queued.getByLabel('Number of automatic relistings',{exact:true})).toBeDisabled();await queued.getByRole('button',{name:'Save relisting settings',exact:true}).click();await expect(queued.getByText(/automatic relistings scheduled · Until sold/)).toBeVisible();
 await queued.getByRole('button',{name:'Manage relistings',exact:true}).click();await queued.getByLabel('Keep relisting until sold',{exact:true}).uncheck();await queued.getByLabel('Number of automatic relistings',{exact:true}).fill('2');await queued.getByRole('button',{name:'Save relisting settings',exact:true}).click();await expect(queued.getByText('Up to 2 additional relistings',{exact:false})).toBeVisible();
 await queued.getByRole('button',{name:'Remove Listing',exact:true}).click();let [lot]=await(await request.get(`http://127.0.0.1:54399/rest/v1/lots?id=eq.${first}`)).json();expect(lot.status).toBe('WAITING');
 await queued.getByRole('button',{name:'Confirm removal',exact:true}).click();await expect(queued.getByText(/Listing removed/)).toBeVisible();await expect(queued.getByRole('button',{name:'Remove Listing',exact:true})).toHaveCount(0);
 const active=page.locator('article').filter({has:page.getByRole('heading',{name:'Active managed listing',exact:true})});
 const [before]=await(await request.get(`http://127.0.0.1:54399/rest/v1/lots?id=eq.${second}`)).json();
 await active.getByRole('button',{name:'Manage relistings',exact:true}).click();await active.getByLabel('Number of automatic relistings',{exact:true}).fill('0');await active.getByRole('button',{name:'Save relisting settings',exact:true}).click();await expect(active.getByText('After this attempt:',{exact:false})).toBeVisible();
 await active.getByRole('button',{name:'Remove Listing',exact:true}).click();await expect(active.getByText(/It will still sell if there is a valid winning bid/)).toBeVisible();await active.getByRole('button',{name:'Confirm removal',exact:true}).click();await expect(active.getByText(/Removal pending/)).toBeVisible();
 [lot]=await(await request.get(`http://127.0.0.1:54399/rest/v1/lots?id=eq.${second}`)).json();expect(lot.status).toBe('PREVIEW');expect(lot.ends_at).toBe(before.ends_at);expect(lot.removal_requested_at).toBeTruthy();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`test-results/seller-management-${width}.png`,fullPage:true});
 await page.goto('/rooms/general-room');await expect(page.getByRole('heading',{name:'Active managed listing',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Queued managed listing',exact:true})).toHaveCount(0);await expect(page.getByRole('heading',{name:'Exhausted managed listing',exact:true})).toHaveCount(0);
});
test('exhausted listing can return to the queue and then stop without removing history',async({page,request})=>{
 await request.post(fixture,{data:{mode:'empty'}});await request.post(fixture,{data:{mode:'management'}});await login(page);
 const article=page.locator('article').filter({has:page.getByRole('heading',{name:'Exhausted managed listing',exact:true})});
 await article.getByRole('button',{name:'Manage relistings',exact:true}).click();await article.getByLabel('Number of automatic relistings',{exact:true}).fill('5');await article.getByRole('button',{name:'Save relisting settings',exact:true}).click();await expect(article.getByText('1 automatic relistings scheduled',{exact:false})).toBeVisible();
 await article.getByRole('button',{name:'Stop future relistings',exact:true}).click();await expect(article.getByText('Relistings finished',{exact:false})).toBeVisible();await expect(article.getByRole('heading',{name:'Exhausted managed listing',exact:true})).toBeVisible();
});
