import { expect, test, type Page } from '@playwright/test';

const fixture = 'http://127.0.0.1:54399/_test';
const payments = '/account/seller-payments';
async function signIn(page: Page, email = 'two@example.test') {
  await page.goto(`/login?next=${payments}`);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Password', { exact: true }).fill('fixturepassword');
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${payments}$`));
}
test.beforeEach(async ({ request, context }) => {
  test.skip(process.env.TEST_STRIPE_CHECKOUT !== '1', 'Requires the explicit local sandbox fixture flag');
  await request.post(`${fixture}/state`, { data: { mode: 'onboarding' } });
  await context.route('https://connect.stripe.com/**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Stripe onboarding fixture</h1>' }));
});

test('new seller starts setup and return checks incomplete verification before reporting readiness', async ({ page, request }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Not set up', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Set Up Seller Payments', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  const state = await (await request.get(`${fixture}/onboarding`)).json();
  expect(state.creations).toBe(1);
  expect(state.lastLink.refresh).toBe(`http://127.0.0.1:3005${payments}/refresh`);
  await page.goto(state.lastLink.return);
  await expect(page.getByRole('heading', { name: 'Setup in progress', exact: true })).toBeVisible();
  await request.post(`${fixture}/state`, { data: { verification: 'additional' } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Additional verification required', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue Stripe onboarding' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  await request.post(`${fixture}/state`, { data: { verification: 'ready' } });
  await page.goto(payments);
  await expect(page.getByRole('heading', { name: 'Ready to receive payments', exact: true })).toBeVisible();
  expect((await (await request.get(`${fixture}/onboarding`)).json()).creations).toBe(1);
  await expect(page.getByRole('button', { name: 'Continue Stripe onboarding' })).toHaveCount(0);
});

test('concurrent seller requests and expired links reuse the same account', async ({ page, context, request }) => {
  await signIn(page);
  const second = await context.newPage();
  await second.goto(payments);
  await Promise.all([page.getByRole('button', { name: 'Set Up Seller Payments' }).click(), second.getByRole('button', { name: 'Set Up Seller Payments' }).click()]);
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  await expect(second.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  const state = await (await request.get(`${fixture}/onboarding`)).json();
  expect(state.creations).toBe(1);
  expect(state.mappings).toHaveLength(1);
  // Inspect the authenticated server redirect before following it, so the
  // fixture intercepts Stripe as a new request rather than a redirect chain.
  const refresh = await context.request.get(state.lastLink.refresh, { maxRedirects: 0 });
  expect(refresh.status()).toBe(307);
  await page.goto(refresh.headers().location);
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  const refreshed = await (await request.get(`${fixture}/onboarding`)).json();
  expect(refreshed.links).toBe(state.links + 1);
  expect(refreshed.creations).toBe(1);
});

test('provider failures are safe to retry and never replace the saved account', async ({ page, request }) => {
  await signIn(page);
  await request.post(`${fixture}/state`, { data: { createError: true } });
  await page.getByRole('button', { name: 'Set Up Seller Payments' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Could not open Stripe onboarding');
  expect((await (await request.get(`${fixture}/onboarding`)).json()).creations).toBe(0);
  await request.post(`${fixture}/state`, { data: { createError: false, bindError: true } });
  await page.getByRole('button', { name: 'Set Up Seller Payments' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Could not open Stripe onboarding');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Setup in progress', exact: true })).toBeVisible();
  await request.post(`${fixture}/state`, { data: { bindError: false, linkError: true } });
  await page.getByRole('button', { name: 'Continue Stripe onboarding' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Could not open Stripe onboarding');
  await page.goto(`${payments}/refresh`);
  await expect(page.locator('p[role="alert"]')).toContainText('could not be refreshed');
  await request.post(`${fixture}/state`, { data: { linkError: false } });
  await page.getByRole('button', { name: 'Continue Stripe onboarding' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  expect((await (await request.get(`${fixture}/onboarding`)).json()).creations).toBe(1);
});

test('restricted accounts display a clear status and unauthenticated refresh cannot provision', async ({ page, request }) => {
  const response = await request.get(`${payments}/refresh`, { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toContain('/login');
  expect((await (await request.get(`${fixture}/onboarding`)).json()).creations).toBe(0);
  await signIn(page);
  await page.getByRole('button', { name: 'Set Up Seller Payments' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  await request.post(`${fixture}/state`, { data: { verification: 'restricted' } });
  await page.goto(payments);
  await expect(page.getByRole('heading', { name: 'Restricted or unavailable', exact: true })).toBeVisible();
});
