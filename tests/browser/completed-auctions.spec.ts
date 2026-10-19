import { expect, test } from '@playwright/test';
const fixture='http://127.0.0.1:54399/_test/state';
for(const width of [375,1440]) {
 test(`completed purchases and sales at ${width}px`,async({page,request})=>{
  await request.post(fixture,{data:{mode:'empty'}});await request.post(fixture,{data:{mode:'history'}});
  await page.setViewportSize({width,height:900});
  await page.goto('/won-auctions');await expect(page).toHaveURL(/login/);
  await page.getByLabel('Email',{exact:true}).fill('two@example.test');
  await page.getByLabel('Password',{exact:true}).fill('fixturepassword');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.goto('/won-auctions');
  await expect(page.getByText('You won this auction.',{exact:true})).toBeVisible();
  await expect(page.getByText('Sold for: £125.50',{exact:true})).toBeVisible();
  await expect(page.getByText('Seller: History Seller')).toBeVisible();
  await expect(page.getByText(/Payment not recorded/)).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:`test-results/purchases-${width}.png`});
  await page.getByRole('link',{name:'Completed history item',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Completed history item',exact:true})).toBeVisible();
  await expect(page.getByText(/Est\.|estimate|Unavailable until/)).toHaveCount(0);
  await page.getByRole('button',{name:'Sign out',exact:true}).click();
  await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');
  await page.getByRole('button',{name:'Sign In',exact:true}).click();
  await page.goto('/my-auctions');
  await expect(page.getByRole('heading',{name:'Sold Auctions',exact:true})).toBeVisible();
  await expect(page.getByText('Winning bidder: History Buyer')).toBeVisible();
  await page.screenshot({path:`test-results/sales-${width}.png`});
 });
}

