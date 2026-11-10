import { expect,test, type Page } from '@playwright/test';
import Stripe from 'stripe';
const lot='20000000-0000-0000-0000-000000000701';
const orderUrl = `/orders/${lot}`;
const fixture = 'http://127.0.0.1:54399/_test';
const checkoutButton = 'Pay Now with Stripe';

async function signIn(page: Page, email = 'one@example.test', next = orderUrl) {
  await page.goto(`/login?next=${next}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fixturepassword');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

async function saveAddress(page: Page) {
  for (const [label, value] of [['Full recipient name', 'Buyer'], ['Address line 1', '10 Example Road'], ['Town / city', 'London'], ['Postcode', 'SW1A 1AA'], ['Country', 'United Kingdom']]) {
    await page.getByLabel(label).fill(value);
  }
  await page.getByRole('button', { name: 'Save address', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Buyer', exact: true })).toBeVisible();
}

test.beforeEach(async({request})=>{await request.post('http://127.0.0.1:54399/_test/state',{data:{mode:'transactions'}});});
for(const width of [390,1280])test(`private address, order and message flows at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await signIn(page);
 await expect(page.getByRole('button',{name:'Confirm order address'})).toBeDisabled();
 await expect(page.getByText('Please select a delivery address',{exact:true})).toBeVisible();
 await page.getByRole('link',{name:'Add New Address'}).click();
 await expect(page.getByRole('heading',{name:'Delivery Addresses',exact:true})).toBeVisible();
 await saveAddress(page);
 await page.getByRole('link',{name:'Return to order'}).click();await page.getByRole('button',{name:'Confirm order address'}).click();await expect(page.getByText('Fulfilment · Preparing for dispatch',{exact:true})).toBeVisible();await expect(page.getByText('Payment · Payment not recorded',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Contact seller',exact:true}).click();await expect(page).toHaveURL(/messages\?conversation=/);
 await page.getByLabel('Message',{exact:true}).fill('Please confirm delivery arrangements.');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByText('Please confirm delivery arrangements.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto(`/login?next=/orders/${lot}`);await page.getByLabel('Email',{exact:true}).fill('two@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByText('10 Example Road',{exact:false})).toBeVisible();await page.getByLabel('Courier / service',{exact:true}).fill('Royal Mail');await page.getByLabel('Tracking reference',{exact:true}).fill('TRACK123');await page.getByRole('combobox',{name:'Shipping status',exact:true}).selectOption('DISPATCHED');await page.getByRole('button',{name:'Save shipping update',exact:true}).click();await expect(page.getByText('Fulfilment · Dispatched',{exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Track with carrier',exact:false})).toHaveAttribute('href',/^https:\/\/www\.royalmail\.com\//);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto(`/login?next=/orders/${lot}`);await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('button',{name:'Confirm I have received this item',exact:true}).click();await expect(page.getByText('Fulfilment · Buyer confirmed receipt',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

for (const width of [390, 1280]) test(`winner sees correct delivery and collection totals at ${width}px with payments disabled`, async ({ page, request }) => {
  test.skip(process.env.TEST_STRIPE_CHECKOUT === '1', 'Runs with checkout disabled');
  await request.post('http://127.0.0.1:54399/_test/state', { data: { mode: 'checkout' } });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('/login?next=/won-auctions');
  await page.getByLabel('Email', { exact: true }).fill('one@example.test');
  await page.getByLabel('Password', { exact: true }).fill('fixturepassword');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page.getByText('Awaiting payment', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Order details / delivery tracking' }).click();
  await expect(page.getByText('£279.95', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: checkoutButton })).toHaveCount(0);
  await expect(page.locator('#checkout').getByText(/Online payments are currently unavailable/)).toBeVisible();
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

test('sandbox checkout opens for the winner and only a signed webhook settles it', async ({ page, context, browser, request }) => {
  test.skip(process.env.TEST_STRIPE_CHECKOUT !== '1', 'Runs with the explicit sandbox checkout fixture flag');
  const state = `${fixture}/state`;
  await request.post(state, { data: { mode: 'checkout' } });
  await context.route('https://checkout.stripe.com/**', route => route.fulfill({
    status: 200, contentType: 'text/html', body: '<h1>Hosted Checkout fixture</h1>',
  }));
  await signIn(page);
  await expect(page.getByText('Payment · Unpaid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: checkoutButton })).toHaveCount(2);
  await expect(page.locator('#checkout').getByRole('button', { name: checkoutButton })).toBeDisabled();
  await page.getByRole('combobox', { name: 'Fulfilment method' }).selectOption('collection');
  const otherTab = await context.newPage();
  await otherTab.goto(orderUrl);
  await otherTab.getByRole('combobox', { name: 'Fulfilment method' }).selectOption('collection');
  const actionRequest = page.waitForRequest(req => req.method() === 'POST' && Boolean(req.headers()['next-action']));
  await Promise.all([
    page.locator('#checkout').getByRole('button', { name: checkoutButton }).click(),
    otherTab.getByRole('button', { name: checkoutButton }).last().click(),
  ]);
  await expect(page.getByRole('heading', { name: 'Hosted Checkout fixture' })).toBeVisible();
  await expect(otherTab.getByRole('heading', { name: 'Hosted Checkout fixture' })).toBeVisible();
  expect(page.url()).toBe(otherTab.url());
  await otherTab.close();
  const { session, attempt, sessions } = await (await request.get(`${fixture}/checkout`)).json();
  expect(sessions).toBe(1);
  expect(attempt.total_minor).toBe(27500);
  expect(attempt.pending_address).toBeNull();
  expect(new URL(session.cancelUrl).pathname).toBe(orderUrl);
  expect(new URL(session.successUrl).pathname).toBe(orderUrl);

  const origin = new URL(session.cancelUrl).origin;
  const outsider = await browser.newPage({ baseURL: origin });
  await signIn(outsider, 'three@example.test');
  await expect(outsider.getByText('Lot Not Found')).toBeVisible();
  const submitted = await actionRequest;
  const headers = submitted.headers();
  const denied = await outsider.request.post(orderUrl, { data: submitted.postDataBuffer()!, headers: {
    'next-action': headers['next-action'], 'content-type': headers['content-type'], origin,
  } });
  expect(await denied.text()).toContain('Order unavailable');
  await outsider.close();

  await page.goto(session.cancelUrl);
  await expect(page.getByText('Payment · Checkout in progress', { exact: true })).toBeVisible();
  await expect(page.locator('#checkout').getByRole('button', { name: 'Resume checkout' })).toBeEnabled();
  await page.goto(session.successUrl);
  await expect(page.getByText('Payment · Payment processing', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resume checkout' })).toHaveCount(0);
  await request.post(state, { data: { captureStripe: true } });
  const payload = JSON.stringify({
    id: 'evt_browser_fixture_paid', type: 'checkout.session.completed', livemode: false, account: 'acct_browserFixture',
    data: { object: { id: session.id, metadata: { nonstop_test_attempt: attempt.id } } },
  });
  const stripe = new Stripe('sk_test_browser_fixture');
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_browser_fixture' });
  const deliver = (header: string) => request.post('/api/stripe/webhook', {
    data: payload, headers: { 'stripe-signature': header, 'content-type': 'application/json' },
  });
  expect((await deliver(signature + 'invalid')).status()).toBe(400);
  await expect(page.getByText('Payment · Payment processing', { exact: true })).toBeVisible();
  expect((await deliver(signature)).status()).toBe(204);
  expect((await deliver(signature)).status()).toBe(204);
  await expect(page.getByText('Payment · Paid', { exact: true })).toBeVisible();
  await expect(page.getByText('Fulfilment · Preparing for collection', { exact: true })).toBeVisible();
  expect((await (await request.get(`${fixture}/checkout`)).json()).orderPaidNotifications).toBe(1);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 'two@example.test');
  await expect(page.getByText('Payment · Paid', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save collection update' })).toBeVisible();
  await expect(page.getByRole('button', { name: checkoutButton })).toHaveCount(0);
});

test('delivery uses the saved address and postage, and only a verified expiry unlocks retry', async ({ page, request }) => {
  test.skip(process.env.TEST_STRIPE_CHECKOUT !== '1', 'Runs with the explicit sandbox checkout fixture flag');
  await page.setViewportSize({ width: 390, height: 900 });
  await request.post(`${fixture}/state`, { data: { mode: 'checkout', stripeMapped: false } });
  await page.route('https://checkout.stripe.com/**', route => route.fulfill({
    contentType: 'text/html', body: '<h1>Hosted Checkout fixture</h1>',
  }));
  await signIn(page);
  await expect(page.locator('#checkout').getByText(/until the seller sets up Stripe/)).toBeVisible();
  await expect(page.getByRole('button', { name: checkoutButton })).toHaveCount(0);
  await request.post(`${fixture}/state`, { data: { stripeMapped: true } });
  await page.reload();
  await expect(page.locator('#checkout').getByText('Please select a delivery address', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Add New Address' }).click();
  await saveAddress(page);
  await page.getByRole('link', { name: 'Return to order' }).click();
  await expect(page.locator('#checkout').getByRole('button', { name: checkoutButton })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: checkoutButton }).last().click();
  await expect(page.getByRole('heading', { name: 'Hosted Checkout fixture' })).toBeVisible();
  const { session, attempt } = await (await request.get(`${fixture}/checkout`)).json();
  expect(attempt.total_minor).toBe(27995);
  expect(attempt.postage_minor).toBe(495);
  expect(attempt.pending_address.postcode).toBe('SW1A 1AA');
  await page.goto(session.cancelUrl);
  await request.post(`${fixture}/state`, { data: { expireStripe: true } });
  await page.locator('#checkout').getByRole('button', { name: 'Resume checkout' }).click();
  await expect(page.getByText('Payment · Checkout expired', { exact: true })).toBeVisible();
  await page.locator('#checkout').getByRole('button', { name: checkoutButton }).click();
  await expect(page.getByRole('heading', { name: 'Hosted Checkout fixture' })).toBeVisible();
  expect((await (await request.get(`${fixture}/checkout`)).json()).sessions).toBe(2);
  expect(new URL(page.url()).pathname).not.toContain(session.id);
});


