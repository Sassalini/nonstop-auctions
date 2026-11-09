import { expect,test } from '@playwright/test';
import Stripe from 'stripe';
const lot='20000000-0000-0000-0000-000000000701';
test.beforeEach(async({request})=>{await request.post('http://127.0.0.1:54399/_test/state',{data:{mode:'transactions'}});});
for(const width of [390,1280])test(`private address, order and message flows at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/login?next=/account/addresses');
 await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Delivery Addresses',exact:true})).toBeVisible();
 for(const [label,value] of [['Full recipient name','Buyer'],['Address line 1','10 Example Road'],['Town / city','London'],['Postcode','SW1A 1AA'],['Country','United Kingdom']])await page.getByLabel(label,{exact:false}).fill(value);
 await page.getByRole('button',{name:'Save address',exact:true}).click();await expect(page.getByRole('heading',{name:'Buyer',exact:true})).toBeVisible();
 await page.goto(`/orders/${lot}`);await page.getByRole('button',{name:'Confirm order address'}).click();await expect(page.getByText('Fulfilment · Preparing for dispatch',{exact:true})).toBeVisible();await expect(page.getByText('Payment · Payment not recorded',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Contact seller',exact:true}).click();await expect(page).toHaveURL(/messages\?conversation=/);
 await page.getByLabel('Message',{exact:true}).fill('Please confirm delivery arrangements.');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByText('Please confirm delivery arrangements.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto(`/login?next=/orders/${lot}`);await page.getByLabel('Email',{exact:true}).fill('two@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByText('10 Example Road',{exact:false})).toBeVisible();await page.getByLabel('Courier / service',{exact:true}).fill('Royal Mail');await page.getByLabel('Tracking reference',{exact:true}).fill('TRACK123');await page.getByRole('combobox',{name:'Shipping status',exact:true}).selectOption('DISPATCHED');await page.getByRole('button',{name:'Save shipping update',exact:true}).click();await expect(page.getByText('Fulfilment · Dispatched',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Track with carrier',exact:false})).toHaveAttribute('href',/^https:\/\/www\.royalmail\.com\//);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto(`/login?next=/orders/${lot}`);await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('button',{name:'Confirm I have received this item',exact:true}).click();await expect(page.getByText('Fulfilment · Buyer confirmed receipt',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

for (const width of [390, 1280]) test(`winner sees correct delivery and collection totals at ${width}px with payments disabled`, async ({ page, request }) => {
  await request.post('http://127.0.0.1:54399/_test/state', { data: { mode: 'checkout' } });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/login?next=/won-auctions');
  await page.getByLabel('Email', { exact: true }).fill('one@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixturepassword');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByText('Awaiting payment', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Order details / delivery tracking' }).click();
  await expect(page.getByText('£279.95', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pay now' })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Fulfilment method' }).selectOption('collection');
  await expect(page.getByText('£279.95', { exact: true })).toHaveCount(0);
  await expect(page.getByText('£275', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Saved delivery address' })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Stripe webhook verifies the raw payload before handling an event', async ({ request }) => {
  const stripe = new Stripe('sk_test_browser_fixture');
  const data = JSON.stringify({ id: 'evt_fixture', type: 'account.updated', livemode: false, data: { object: {} } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload: data, secret: 'whsec_browser_fixture' });
  const send = (payload: string) => request.post('/api/stripe/webhook', {
    data: payload, headers: { 'stripe-signature': signature, 'content-type': 'application/json' },
  });
  expect((await send(data + ' ')).status()).toBe(400);
  expect((await send(data)).status()).toBe(204);
});

test('sandbox checkout opens for the winner and only a signed webhook settles it', async ({ page, request }) => {
  test.skip(process.env.TEST_STRIPE_CHECKOUT !== '1', 'Runs with the explicit sandbox checkout fixture flag');
  const state = 'http://127.0.0.1:54399/_test/state';
  await request.post(state, { data: { mode: 'checkout' } });
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<h1>Hosted Checkout fixture</h1>',
  }));
  await page.goto(`/login?next=/orders/${lot}`);
  await page.getByLabel('Email', { exact: true }).fill('one@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixturepassword');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await page.getByRole('combobox', { name: 'Fulfilment method' }).selectOption('collection');
  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(page.getByRole('heading', { name: 'Hosted Checkout fixture' })).toBeVisible();

  await page.goto(`/orders/${lot}?checkout=returned`);
  await expect(page.getByText('Payment · Payment pending', { exact: true })).toBeVisible();
  await request.post(state, { data: { captureStripe: true } });
  const payload = JSON.stringify({
    id: 'evt_browser_fixture_paid', type: 'checkout.session.completed', livemode: false, account: 'acct_browserFixture',
    data: { object: { id: 'cs_test_browser_fixture', metadata: { nonstop_test_attempt: '70000000-0000-0000-0000-000000000001' } } },
  });
  const stripe = new Stripe('sk_test_browser_fixture');
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_browser_fixture' });
  const deliver = (header: string) => request.post('/api/stripe/webhook', {
    data: payload, headers: { 'stripe-signature': header, 'content-type': 'application/json' },
  });
  expect((await deliver(signature + 'invalid')).status()).toBe(400);
  expect((await deliver(signature)).status()).toBe(204);
  expect((await deliver(signature)).status()).toBe(204);
  await page.reload();
  await expect(page.getByText('Payment · Paid', { exact: true })).toBeVisible();
  await expect(page.getByText('Fulfilment · Preparing for collection', { exact: true })).toBeVisible();
});


