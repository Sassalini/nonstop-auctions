import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";

const fixture = 'http://127.0.0.1:54399/_test/state';
const hall = '10000000-0000-0000-0000-000000000007';
const png = readFileSync('public/images/auction-house-background.png');
const photo = (name = 'front.png') => ({ name, mimeType: 'image/png', buffer: png });
async function signIn(page: Page) {
  await page.goto('/login?next=/sell');
  await page.getByLabel('Email', { exact:true }).fill('one@example.test');
  await page.getByLabel('Password', { exact:true }).fill('fixturepassword');
  await page.getByRole('button', { name:'Sign In', exact:true }).click();
  await expect(page).toHaveURL(/\/sell$/);
  await expect(page.getByRole('button', { name:'Submit listing', exact:true })).toBeEnabled();
}
async function fill(page: Page, title = 'Seller porcelain vase') {
  await page.getByLabel('Item title', { exact:true }).fill(title);
  await page.getByLabel('Auction room', { exact:true }).selectOption(hall);
  await page.getByLabel('Starting bid (GBP)', { exact:true }).fill('25.50');
  await page.locator('textarea').fill('Porcelain vase. Excellent condition, 1930s, 20cm, no known repairs.');
}
test.beforeEach(async ({ request }) => {
  await request.post(fixture, { data:{ mode:'empty' } });
  await request.post(fixture, { data:{ mode:'seller' } });
});

test('seller copy, authentication gate, all active rooms and desktop/mobile layout', async ({ page }) => {
  await page.goto('/sell');
  await expect(page.getByRole('heading', { name:'Sell an Item.', exact:true })).toBeVisible();
  for (const name of ['Moderation','Trusted Sellers','A fully online Traditional Experience','High Quality As Standard']) await expect(page.getByRole('heading', { name,exact:true })).toBeVisible();
  await expect(page.getByRole('button', { name:'Submit listing' })).toBeDisabled();
  await expect(page.locator('select option')).toHaveCount(13);
  await expect(page.locator('textarea')).not.toHaveAttribute('placeholder');
  await expect(page.getByText(/reserve preference|reserve amount|opening soon/i)).toHaveCount(0);
  for (const width of [320,375,768,1440]) {
    await page.setViewportSize({ width,height:1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.screenshot({ path:'test-results/sell-desktop.png',fullPage:true });
  await page.setViewportSize({ width:375,height:900 });
  await page.screenshot({ path:'test-results/sell-mobile.png',fullPage:true });
});

test('validates money, missing/invalid/oversized photos; previews and removal work', async ({ page }) => {
  await signIn(page); await fill(page);
  await page.getByLabel('Starting bid (GBP)', { exact:true }).fill('1.001');
  await page.getByRole('button', { name:'Submit listing' }).click();
  await expect(page.getByRole('status')).toContainText('no more than two decimal places');
  await page.getByLabel('Starting bid (GBP)', { exact:true }).fill('25.50');
  await page.getByRole('button', { name:'Submit listing' }).click();
  await expect(page.getByRole('status')).toContainText('at least one photo');
  const input = page.getByLabel('Item photographs', { exact:true });
  await input.setInputFiles({ name:'text.txt',mimeType:'text/plain',buffer:Buffer.from('invalid') });
  await expect(page.locator('main').getByRole('alert')).toContainText('JPEG, PNG or WebP');
  await input.setInputFiles({ name:'invalid.png',mimeType:'image/png',buffer:Buffer.from('invalid') });
  await expect(page.locator('main').getByRole('alert')).toContainText('not a readable image');
  await input.setInputFiles({ name:'large.png',mimeType:'image/png',buffer:Buffer.alloc(5*1024*1024+1) });
  await expect(page.locator('main').getByRole('alert')).toContainText('5 MB');
  await input.setInputFiles([photo(),photo('back.png')]);
  await expect(page.getByRole('img',{ name:'Item photograph 1',exact:true })).toBeVisible();
  await expect(page.getByRole('img',{ name:'Item photograph 2',exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'Remove photograph 1',exact:true }).click();
  await expect(page.getByRole('img',{ name:/Item photograph/ })).toHaveCount(1);
  for (const width of [320,375,768,1440]) {
    await page.setViewportSize({ width,height:1000 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  for (const mimeType of ['image/jpeg','image/webp']) {
    const encoded = await page.evaluate(type => { const canvas = document.createElement('canvas'); canvas.width=2; canvas.height=2; return canvas.toDataURL(type).split(',')[1]; },mimeType);
    await input.setInputFiles({ name:`photo.${mimeType.split('/')[1]}`,mimeType,buffer:Buffer.from(encoded,'base64') });
    await expect(page.getByRole('img',{ name:/Item photograph/ })).toHaveCount(mimeType === 'image/jpeg' ? 2 : 3);
  }
});

test('multiple images submit once, appear in My Auctions, gallery and the selected room queue', async ({ page }) => {
  await page.setViewportSize({ width:375,height:900 });
  await signIn(page); await fill(page);
  await page.getByLabel('Item photographs', { exact:true }).setInputFiles([photo(),photo('back.png')]);
  await expect(page.getByRole('img',{ name:/Item photograph/ })).toHaveCount(2);
  await page.getByRole('button',{ name:'Submit listing',exact:true }).click();
  await expect(page).toHaveURL(/\/my-auctions\?submitted=1/);
  await expect(page.getByRole('status')).toContainText('Listing submitted successfully');
  await expect(page.getByRole('heading',{ name:'Seller porcelain vase',exact:true })).toHaveCount(1);
  const link = page.getByRole('link',{ name:'Seller porcelain vase',exact:true });
  await link.click();
  await expect(page.getByRole('heading',{ name:'Seller porcelain vase',exact:true })).toBeVisible();
  await expect(page.locator('img[src*="/object/sign/lot-photos/"]').first()).toBeVisible();
  await page.goto('/rooms/general-room');
  await expect(page.getByRole('heading',{ name:'Seller porcelain vase',exact:true })).toBeVisible();
});

test('interrupted upload remains recoverable and can be resumed or discarded with its stored photos', async ({ page, request }) => {
  await signIn(page); await fill(page,'Recoverable listing');
  await page.getByLabel('Item photographs', { exact:true }).setInputFiles(photo());
  await expect(page.getByRole('img',{ name:'Item photograph 1',exact:true })).toBeVisible();
  await request.post(fixture,{ data:{ failUpload:true } });
  await page.getByRole('button',{ name:'Submit listing',exact:true }).click();
  await expect(page.getByRole('status')).toContainText('saved in My Auctions');
  await page.goto('/my-auctions');
  await expect(page.getByText('Unfinished submission', { exact:false })).toBeVisible();
  await page.getByRole('link',{ name:'Resume submission' }).click();
  await expect(page.getByText('Upload interrupted. Remove and reselect this photo.')).toBeVisible();
  await page.getByRole('button',{ name:'Remove photograph 1' }).click();
  await page.getByLabel('Item photographs', { exact:true }).setInputFiles(photo());
  await expect(page.getByRole('img',{ name:'Item photograph 1',exact:true })).toBeVisible();
  await request.post(fixture,{ data:{ failUpload:false,loseSubmitResponse:true } });
  await page.getByRole('button',{ name:'Submit listing',exact:true }).click();
  await expect(page.getByRole('status')).toContainText('saved in My Auctions');
  await page.getByRole('button',{ name:'Submit listing',exact:true }).click();
  await expect(page).toHaveURL(/\/my-auctions\?submitted=1/);
  await expect(page.getByRole('heading',{ name:'Recoverable listing',exact:true })).toHaveCount(1);
});

test('discard removes an unfinished listing and its registered photos', async ({ page,request }) => {
  await signIn(page); await fill(page,'Discardable listing');
  await page.getByLabel('Item photographs',{ exact:true }).setInputFiles([photo(),photo('back.png')]);
  await expect(page.getByRole('img',{ name:'Item photograph 1',exact:true })).toBeVisible();
  await request.post(fixture,{ data:{ failUploadAfter:1 } });
  await page.getByRole('button',{ name:'Submit listing',exact:true }).click();
  await expect(page.getByRole('status')).toContainText('saved in My Auctions');
  expect(await (await request.get('http://127.0.0.1:54399/_test/seller-state')).json()).toEqual({ lots:1,images:2,objects:1 });
  await page.goto('/my-auctions');
  await page.getByRole('button',{ name:'Discard draft',exact:true }).click();
  await page.getByRole('button',{ name:'Confirm discard draft and photos',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Discardable listing',exact:true })).toHaveCount(0);
  await expect(page.getByText('You have no listings yet.')).toBeVisible();
  expect(await (await request.get('http://127.0.0.1:54399/_test/seller-state')).json()).toEqual({ lots:0,images:0,objects:0 });
});
