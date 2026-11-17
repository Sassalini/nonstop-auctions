import assert from 'node:assert/strict';
import test from 'node:test';
import { loadServerModule } from './helpers/load-server-module.mjs';

function fixture({ user = { id: 'authenticated-seller' }, enabled = true, failure = false } = {}) {
  let provisions = 0, links = 0, clients = 0, seller;
  const redirect = url => { throw Object.assign(new Error('Next redirect'), { redirectUrl: url }); };
  class SellerSetupRecoveryRequired extends Error {}
  const dependencies = {
    'next/navigation': { redirect },
    '@/lib/supabase/server': { createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    '@/lib/stripe-test': {
      stripeTestConfig: () => enabled ? {} : null,
      stripeTestOrigin: () => enabled ? 'https://auction.invalid' : null,
      stripeTestClients: () => { clients++; return { stripe: {}, admin: {} }; },
      testSellerAccount: async () => 'acct_authenticatedSeller',
    },
    '@/lib/transactions': {},
    '@/lib/seller-stripe-onboarding': {
      SellerSetupRecoveryRequired,
      requireStripeSandbox: async () => {},
      getOrCreateSellerTestAccount: async (_clients, id) => {
        provisions++; seller = id;
        if (failure) throw new Error('Synthetic provider failure with confidential details');
        return 'acct_authenticatedSeller';
      },
      sellerTestAccountLink: async () => { links++; return 'https://connect.stripe.com/setup/synthetic'; },
    },
  };
  return { dependencies, counts: () => ({ provisions, links, clients, seller }),
    action: loadServerModule('../../src/app/checkout-actions.ts', dependencies).openSellerTestOnboarding,
    refresh: loadServerModule('../../src/app/account/seller-payments/refresh/route.ts', dependencies).GET };
}

test('unauthenticated server action cannot provision or obtain an Account Link', async () => {
  const f = fixture({ user: null });
  assert.equal((await f.action()).error, 'Sign in to manage your seller account.');
  assert.equal(f.counts().clients, 0);
  assert.equal(f.counts().provisions, 0);
});

test('server action uses verified session identity and ignores supplied seller/account IDs', async () => {
  const f = fixture();
  await assert.rejects(f.action({ seller_id: 'victim', stripe_account: 'acct_attacker' }), error => error.redirectUrl === 'https://connect.stripe.com/setup/synthetic');
  assert.equal(f.counts().seller, 'authenticated-seller');
  assert.equal(f.counts().provisions, 1);
  assert.equal(f.counts().links, 1);
});

test('disabled sandbox blocks server action and provider failures do not expose details', async () => {
  const disabled = fixture({ enabled: false });
  assert.equal((await disabled.action()).error, 'Stripe test onboarding is unavailable.');
  assert.equal(disabled.counts().clients, 0);
  const failed = fixture({ failure: true });
  const result = await failed.action();
  assert.match(result.error, /Please try again/);
  assert.ok(!result.error.includes('confidential'));
  assert.equal(failed.counts().links, 0);
});

test('refresh authenticates, creates a new link for the mapped seller, and never provisions', async () => {
  const anonymous = fixture({ user: null });
  await assert.rejects(anonymous.refresh(), error => error.redirectUrl.startsWith('/login?'));
  assert.equal(anonymous.counts().clients, 0);
  const authenticated = fixture();
  await assert.rejects(authenticated.refresh(), error => error.redirectUrl === 'https://connect.stripe.com/setup/synthetic');
  assert.equal(authenticated.counts().provisions, 0);
  assert.equal(authenticated.counts().links, 1);
  const disabled = fixture({ enabled: false });
  await assert.rejects(disabled.refresh(), error => error.redirectUrl === '/account/seller-payments?onboarding=retry');
  assert.equal(disabled.counts().links, 0);
});

test('actual configuration rejects live credentials and mismatched sandbox settings', () => {
  const config = loadServerModule('../../src/lib/stripe-test.ts', { './seller-payment-status': {} });
  const values = { STRIPE_TEST_SECRET_KEY: 'sk_test_synthetic', STRIPE_TEST_WEBHOOK_SECRET: 'whsec_synthetic',
    NEXT_PUBLIC_SUPABASE_URL: 'https://sandbox.invalid', STRIPE_TEST_SUPABASE_URL: 'https://sandbox.invalid',
    SUPABASE_SERVICE_ROLE_KEY: 'synthetic', STRIPE_TEST_CHECKOUT_ENABLED: 'true', STRIPE_TEST_APP_ORIGIN: 'https://auction.invalid' };
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]));
  try {
    Object.assign(process.env, values);
    assert.ok(config.stripeTestConfig());
    assert.equal(config.stripeTestOrigin(), 'https://auction.invalid');
    process.env.STRIPE_TEST_SECRET_KEY = 'sk_live_synthetic';
    assert.equal(config.stripeTestConfig(), null);
    process.env.STRIPE_TEST_SECRET_KEY = values.STRIPE_TEST_SECRET_KEY;
    process.env.STRIPE_TEST_SUPABASE_URL = 'https://different.invalid';
    assert.equal(config.stripeTestConfig(), null);
    process.env.STRIPE_TEST_SUPABASE_URL = values.STRIPE_TEST_SUPABASE_URL;
    process.env.STRIPE_TEST_CHECKOUT_ENABLED = 'false';
    assert.equal(config.stripeTestOrigin(), null);
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
