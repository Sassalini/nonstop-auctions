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
  await expect(page.getByRole('heading', { name: 'Verification required', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Continue Stripe onboarding' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  await request.post(`${fixture}/state`, { data: { verification: 'ready' } });
  await page.goto(payments);
  await expect(page.getByRole('heading', { name: 'Ready to accept payments', exact: true })).toBeVisible();
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
  await expect(page.getByRole('heading', { name: 'Restricted', exact: true })).toBeVisible();
});

for (const [verification, title] of [['incomplete', 'Setup in progress'], ['additional', 'Verification required'], ['ready', 'Ready to accept payments']]) {
  test(`existing ${verification} seller uses their mapping without provisioning`, async ({ page, request }) => {
    await request.post(`${fixture}/state`, { data: { existingOnboarding: verification } });
    await signIn(page);
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const nav = page.getByRole('navigation', { name: 'My Account', exact: true });
    await expect(nav.getByRole('link', { name: 'Seller Payments', exact: true })).toHaveAttribute('aria-current', 'page');
    await page.locator('header summary').click();
    await page.getByRole('navigation', { name: 'Account settings' }).getByRole('link', { name: 'Seller Payments', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    if (verification === 'ready') {
      await expect(page.getByRole('button', { name: 'Continue Stripe onboarding' })).toHaveCount(0);
    } else {
      await page.getByRole('button', { name: 'Continue Stripe onboarding' }).click();
      await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
    }
    const state = await (await request.get(`${fixture}/onboarding`)).json();
    expect(state.creations).toBe(0);
    expect(state.mappings).toEqual([['00000000-0000-0000-0000-000000000103', 'acct_existingOnboarding']]);
    if (verification !== 'ready') expect(state.lastLink.account).toBe('acct_existingOnboarding');
  });
}

test('status lookup failures do not report a Stripe restriction or allow replacement', async ({ page, request }) => {
  await request.post(`${fixture}/state`, { data: { existingOnboarding: 'ready', statusError: true } });
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Status unavailable', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /onboarding|Set Up Seller Payments/ })).toHaveCount(0);
  await request.post(`${fixture}/state`, { data: { statusError: false } });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ready to accept payments', exact: true })).toBeVisible();
  expect((await (await request.get(`${fixture}/onboarding`)).json()).creations).toBe(0);
});

test('another signed-in account cannot view or resume an existing seller mapping', async ({ page, request }) => {
  await request.post(`${fixture}/state`, { data: { existingOnboarding: 'ready' } });
  await signIn(page, 'one@example.test');
  await expect(page.getByRole('heading', { name: 'Not set up', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Set Up Seller Payments', exact: true })).toBeVisible();
  const refresh = await page.request.get(`${payments}/refresh`, { maxRedirects: 0 });
  expect(refresh.headers().location).toContain('onboarding=retry');
  const state = await (await request.get(`${fixture}/onboarding`)).json();
  expect(state.links).toBe(0);
  expect(state.creations).toBe(0);
});

test('interrupted provisioning recovers the original account after the retry window', async ({ page, request }) => {
  await signIn(page);
  await request.post(`${fixture}/state`, { data: { bindError: true } });
  await page.getByRole('button', { name: 'Set Up Seller Payments' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Could not open Stripe onboarding');
  const interrupted = await (await request.get(`${fixture}/onboarding`)).json();
  expect(interrupted.creations).toBe(1);
  expect(interrupted.mappings).toHaveLength(0);
  await request.post(`${fixture}/state`, { data: { bindError: false, expireReservation: true } });
  await page.reload();
  await page.getByRole('button', { name: 'Continue Stripe onboarding' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  const recovered = await (await request.get(`${fixture}/onboarding`)).json();
  expect(recovered.creations).toBe(1);
  expect(recovered.createRequests).toBe(interrupted.createRequests);
  expect(recovered.mappings).toEqual([['00000000-0000-0000-0000-000000000103', 'acct_onboarding1']]);
});

test('expired unresolved provisioning reports its support code without making another account request', async ({ page, request }) => {
  await signIn(page);
  await request.post(`${fixture}/state`, { data: { createError: true } });
  await page.getByRole('button', { name: 'Set Up Seller Payments' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Could not open Stripe onboarding');
  const failed = await (await request.get(`${fixture}/onboarding`)).json();
  await request.post(`${fixture}/state`, { data: { createError: false, expireReservation: true } });
  await page.reload();
  await expect(page.getByText('A setup request is saved. Continue to check and resume it safely.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue Stripe onboarding' }).click();
  await expect(page.locator('p[role="alert"]')).toContainText('Support code: expired_unresolved');
  const blocked = await (await request.get(`${fixture}/onboarding`)).json();
  expect(blocked.creations).toBe(0);
  expect(blocked.createRequests).toBe(failed.createRequests);
  expect(blocked.links).toBe(0);
});

test('ownership inconsistency blocks status and expired-link refresh without changing mappings', async ({ page, request }) => {
  await signIn(page);
  await page.getByRole('button', { name: 'Set Up Seller Payments' }).click();
  await expect(page.getByRole('heading', { name: 'Stripe onboarding fixture' })).toBeVisible();
  const original = await (await request.get(`${fixture}/onboarding`)).json();
  await request.post(`${fixture}/state`, { data: { tamperOwnership: true } });
  await page.goto(payments);
  await expect(page.getByRole('heading', { name: 'Setup needs review', exact: true })).toBeVisible();
  await expect(page.getByText(/Support code: account_mismatch/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue Stripe onboarding' })).toHaveCount(0);
  const refresh = await page.request.get(`${payments}/refresh`, { maxRedirects: 0 });
  expect(refresh.headers().location).toContain('onboarding=retry');
  const blocked = await (await request.get(`${fixture}/onboarding`)).json();
  expect(blocked.mappings).toEqual(original.mappings);
  expect(blocked.createRequests).toBe(original.createRequests);
  expect(blocked.links).toBe(original.links);
});
