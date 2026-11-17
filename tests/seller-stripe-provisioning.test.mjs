import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { releaseDatabase } from './helpers/release-database.mjs';
import { loadServerModule } from './helpers/load-server-module.mjs';
import { sellerPaymentStatus, sellerCanAcceptTestPayments } from '../src/lib/seller-payment-status.ts';

let db;
const platform = 'acct_platformFixture';
const legacySeller = '00000000-0000-0000-0000-000000000101';
before(async () => {
  db = await releaseDatabase({ throughMigration: 18 });
  await db.query('insert into public.seller_stripe_test_accounts values ($1,$2)', [legacySeller, 'acct_existingFixture']);
  const before = (await db.query('select * from public.seller_stripe_test_accounts')).rows;
  const orders = (await db.query('select * from public.fulfilment_orders')).rows;
  await db.exec(await readFile(new URL('../supabase/migrations/019_seller_stripe_test_provisioning.sql', import.meta.url), 'utf8'));
  assert.deepEqual((await db.query('select * from public.seller_stripe_test_accounts')).rows, before);
  assert.deepEqual((await db.query('select * from public.fulfilment_orders')).rows, orders);
});
after(async () => db?.close());

const service = loadServerModule('../../src/lib/seller-stripe-onboarding.ts', {
  './stripe-test': { testSellerAccount: async (admin, seller) => {
    const { data, error } = await admin.from('seller_stripe_test_accounts').select('stripe_account').eq('seller_id', seller).maybeSingle();
    if (error) throw error;
    return data?.stripe_account;
  } },
});

async function fixture() {
  const seller = randomUUID();
  await db.query('insert into auth.users(id,email_confirmed_at) values ($1,now())', [seller]);
  let failBind = false, failCreate = false, loseResponse = false, mode = false;
  let createRequests = 0, creations = 0, linkCount = 0;
  const accounts = new Map(), keys = new Map();
  const admin = {
    from: table => ({ select() { return this; }, eq(column, value) { this.value = value; return this; }, async maybeSingle() {
      const { rows } = await db.query(`select * from public.${table} where seller_id=$1`, [this.value]);
      return { data: rows[0] ?? null, error: null };
    } }),
    async rpc(name, args) {
      if (name === 'bind_seller_stripe_test_account' && failBind) return { data: null, error: new Error('Synthetic database failure') };
      const values = Object.values(args), placeholders = values.map((_, i) => `$${i+1}`).join(',');
      try { return { data: (await db.query(`select public.${name}(${placeholders}) as result`, values)).rows[0].result, error: null }; }
      catch (error) { return { data: null, error }; }
    },
  };
  const stripe = {
    balance: { retrieve: async () => ({ livemode: mode }) },
    accounts: {
      retrieve: async id => id ? accounts.get(id) : { id: platform },
      async create(params, options) {
        createRequests++;
        assert.equal(params.country, 'GB');
        assert.equal(params.controller.losses.payments, 'stripe');
        assert.equal(params.controller.fees.payer, 'account');
        assert.equal(params.capabilities.card_payments.requested, true);
        assert.equal(params.capabilities.transfers, undefined);
        assert.match(options.idempotencyKey, /^nonstop-test-seller-v1-/);
        if (failCreate) throw new Error('Synthetic Stripe failure');
        if (!keys.has(options.idempotencyKey)) {
          const account = { id: `acct_${randomUUID().replaceAll('-','')}`, ...params, details_submitted: false, charges_enabled: false, payouts_enabled: false };
          creations++; accounts.set(account.id, account); keys.set(options.idempotencyKey, { params: JSON.stringify(params), account });
        }
        await new Promise(resolve => setImmediate(resolve));
        const saved = keys.get(options.idempotencyKey);
        assert.equal(JSON.stringify(params), saved.params);
        if (loseResponse) throw new Error('Synthetic lost Stripe response');
        return saved.account;
      },
      list: async () => ({ data: [...accounts.values()], has_more: false }),
    },
    accountLinks: { create: async params => {
      assert.equal(params.type, 'account_onboarding');
      assert.equal(params.return_url, 'https://auction.invalid/account/seller-payments');
      assert.equal(params.refresh_url, 'https://auction.invalid/account/seller-payments/refresh');
      return { url: `https://connect.stripe.com/setup/synthetic-${++linkCount}` };
    } },
  };
  return { seller, clients: { stripe, admin }, accounts, keys,
    counts: () => ({ createRequests, creations, linkCount }),
    failures: flags => { failBind = flags.bind ?? false; failCreate = flags.create ?? false; loseResponse = flags.lost ?? false; mode = flags.live ?? false; },
    async expire() { await db.query("update public.seller_stripe_test_provisioning set created_at=now()-interval '2 days' where seller_id=$1", [seller]); },
  };
}

test('new seller provisions once, persists the mapping, and repeats reuse it', async () => {
  const f = await fixture();
  const id = await service.getOrCreateSellerTestAccount(f.clients, f.seller);
  assert.equal(await service.getOrCreateSellerTestAccount(f.clients, f.seller), id);
  assert.equal(f.counts().creations, 1);
  assert.equal(f.counts().createRequests, 1);
  assert.equal((await db.query('select stripe_account from public.seller_stripe_test_accounts where seller_id=$1', [f.seller])).rows[0].stripe_account, id);
});

test('simultaneous onboarding requests share one durable intent and one Stripe account', async () => {
  const f = await fixture();
  const ids = await Promise.all(Array.from({ length: 8 }, () => service.getOrCreateSellerTestAccount(f.clients, f.seller)));
  assert.equal(new Set(ids).size, 1);
  assert.equal(f.counts().creations, 1);
  assert.equal((await db.query('select count(*) from public.seller_stripe_test_provisioning where seller_id=$1', [f.seller])).rows[0].count, 1);
});

test('lost Stripe response is reconciled by reservation metadata', async () => {
  const f = await fixture(); f.failures({ lost: true });
  assert.ok(await service.getOrCreateSellerTestAccount(f.clients, f.seller));
  assert.equal(f.counts().creations, 1);
});

test('failed mapping write retries the same account and creation parameters', async () => {
  const f = await fixture(); f.failures({ bind: true });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /mapping could not be saved/);
  f.failures({});
  const id = await service.getOrCreateSellerTestAccount(f.clients, f.seller);
  assert.equal(id, [...f.accounts.keys()][0]);
  assert.equal(f.counts().creations, 1);
});

test('after idempotency retention, recovery finds the orphan without another create', async () => {
  const f = await fixture(); f.failures({ bind: true });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller));
  await f.expire(); f.failures({});
  assert.equal(await service.getOrCreateSellerTestAccount(f.clients, f.seller), [...f.accounts.keys()][0]);
  assert.equal(f.counts().createRequests, 1);
});

test('Stripe error retains the intent; expired unknown attempts never create again', async () => {
  const f = await fixture(); f.failures({ create: true });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /could not be confirmed/);
  const intent = (await db.query('select id from public.seller_stripe_test_provisioning where seller_id=$1', [f.seller])).rows[0].id;
  await f.expire(); f.failures({});
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /needs reconciliation/);
  assert.equal(f.counts().createRequests, 1);
  assert.equal((await db.query('select id from public.seller_stripe_test_provisioning where seller_id=$1', [f.seller])).rows[0].id, intent);
});

test('recovery refuses ambiguous duplicate metadata or an incomplete scan', async () => {
  const f = await fixture(); f.failures({ bind: true });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller));
  await f.expire(); f.failures({});
  const account = [...f.accounts.values()][0];
  f.accounts.set('acct_duplicate', { ...account, id: 'acct_duplicate' });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /needs reconciliation/);
  f.accounts.delete('acct_duplicate');
  f.clients.stripe.accounts.list = async () => ({ data: [account], has_more: true });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /needs reconciliation/);
  assert.equal(f.counts().creations, 1);
});

test('recovery follows pagination and a changed platform cannot create a replacement', async () => {
  const f = await fixture(); f.failures({ bind: true });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller));
  f.failures({});
  f.clients.stripe.accounts.retrieve = async () => ({ id: 'acct_changedPlatform' });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /needs reconciliation/);
  assert.equal(f.counts().createRequests, 1);
  f.clients.stripe.accounts.retrieve = async () => ({ id: platform });
  await f.expire();
  const account = [...f.accounts.values()][0];
  f.clients.stripe.accounts.list = async params => params.starting_after
    ? { data: [account], has_more: false }
    : { data: [{ id: 'acct_unrelated', metadata: {} }], has_more: true };
  assert.equal(await service.getOrCreateSellerTestAccount(f.clients, f.seller), account.id);
  assert.equal(f.counts().createRequests, 1);
});

test('a failed mapping lookup cannot authorize account creation', async () => {
  const f = await fixture();
  f.clients.admin.from = () => ({ select() { return this; }, eq() { return this; },
    maybeSingle: async () => ({ data: null, error: new Error('Synthetic read failure') }) });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /Synthetic read failure/);
  assert.equal(f.counts().createRequests, 0);
});

test('live API mode is rejected before database provisioning or account creation', async () => {
  const f = await fixture(); f.failures({ live: true });
  await assert.rejects(service.getOrCreateSellerTestAccount(f.clients, f.seller), /Sandbox required/);
  assert.equal(f.counts().createRequests, 0);
  assert.equal((await db.query('select count(*) from public.seller_stripe_test_provisioning where seller_id=$1', [f.seller])).rows[0].count, 0);
});

test('existing operator mappings are reused without provisioning or replacing accounts', async () => {
  const f = await fixture();
  assert.equal(await service.getOrCreateSellerTestAccount(f.clients, legacySeller), 'acct_existingFixture');
  assert.equal(f.counts().createRequests, 0);
});

test('every onboarding continuation or expired-link refresh gets a fresh Account Link', async () => {
  const f = await fixture();
  const id = await service.getOrCreateSellerTestAccount(f.clients, f.seller);
  const first = await service.sellerTestAccountLink(f.clients.stripe, 'https://auction.invalid', id);
  const second = await service.sellerTestAccountLink(f.clients.stripe, 'https://auction.invalid', id);
  assert.notEqual(first, second);
  assert.equal(f.counts().creations, 1);
  f.clients.stripe.accountLinks.create = async () => ({ url: 'https://malicious.invalid/' });
  await assert.rejects(service.sellerTestAccountLink(f.clients.stripe, 'https://auction.invalid', id), /Invalid onboarding redirect/);
});

test('seller payment status reflects actual capabilities and requirements', () => {
  const account = { country: 'GB', details_submitted: false, capabilities: {}, requirements: {} };
  assert.equal(sellerPaymentStatus(null).title, 'Not set up');
  assert.equal(sellerPaymentStatus(null, true).title, 'Setup in progress');
  assert.equal(sellerPaymentStatus(account).title, 'Setup in progress');
  account.details_submitted = true; account.requirements.currently_due = ['representative.verification.document'];
  assert.equal(sellerPaymentStatus(account).title, 'Verification required');
  account.requirements = { pending_verification: ['representative.verification.document'] };
  assert.equal(sellerPaymentStatus(account).title, 'Setup in progress');
  account.requirements = {}; account.charges_enabled = true; account.payouts_enabled = true; account.capabilities.card_payments = 'active';
  assert.equal(sellerPaymentStatus(account).title, 'Ready to accept payments');
  account.requirements = { disabled_reason: 'rejected.fraud' };
  assert.equal(sellerPaymentStatus(account).title, 'Restricted');
});

test('direct card checkout requires charge and payout eligibility and active cards, without platform transfers', () => {
  const ready = { country: 'GB', details_submitted: true, charges_enabled: true, payouts_enabled: true,
    capabilities: { card_payments: 'active' }, requirements: {} };
  assert.equal(sellerCanAcceptTestPayments(ready), true);
  for (const overrides of [{ charges_enabled: false }, { payouts_enabled: false }, { details_submitted: false },
    { capabilities: { card_payments: 'pending' } }, { capabilities: {} }, { country: 'US' },
    { requirements: { disabled_reason: 'requirements.past_due' } }]) {
    const account = { ...ready, ...overrides };
    assert.equal(sellerCanAcceptTestPayments(account), false);
    assert.notEqual(sellerPaymentStatus(account).title, 'Ready to accept payments');
  }
});

test('RLS and grants deny browser roles all mapping/intent access and provisioning RPCs', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const sql of [
      'select * from public.seller_stripe_test_accounts',
      'select * from public.seller_stripe_test_provisioning',
      `insert into public.seller_stripe_test_accounts values ('${legacySeller}','acct_attack')`,
      `update public.seller_stripe_test_accounts set stripe_account='acct_attack'`,
      'delete from public.seller_stripe_test_accounts',
      `select public.reserve_seller_stripe_test_account('${legacySeller}','${platform}')`,
      `select public.bind_seller_stripe_test_account('${legacySeller}','${randomUUID()}','${platform}','acct_attack')`,
    ]) {
      await db.exec('begin');
      try { await db.exec(`set local role ${role}`); await assert.rejects(db.exec(sql), /permission denied/); }
      finally { await db.exec('rollback'); }
    }
  }
  const tables = await db.query("select relname,relrowsecurity from pg_class where relname in ('seller_stripe_test_accounts','seller_stripe_test_provisioning')");
  assert.ok(tables.rows.every(row => row.relrowsecurity));
});

test('service RPCs preserve reservation scope, refuse replacements, and permit safe repeated binding', async () => {
  const f = await fixture();
  await db.exec('begin; set local role service_role');
  try {
    const reserved = (await f.clients.admin.rpc('reserve_seller_stripe_test_account', { p_seller: f.seller, p_platform: platform })).data;
    assert.equal(reserved.may_create, true);
    const args = { p_seller: f.seller, p_reservation: reserved.id, p_platform: platform, p_account: 'acct_boundFixture' };
    assert.equal((await f.clients.admin.rpc('bind_seller_stripe_test_account', args)).data, args.p_account);
    assert.equal((await f.clients.admin.rpc('bind_seller_stripe_test_account', args)).data, args.p_account);
    await db.exec('savepoint rejection');
    assert.ok((await f.clients.admin.rpc('bind_seller_stripe_test_account', { ...args, p_account: 'acct_replacement' })).error);
    await db.exec('rollback to savepoint rejection');
    await assert.rejects(db.exec("update public.seller_stripe_test_provisioning set created_at=now()"), /permission denied/);
  } finally { await db.exec('rollback'); }
  await f.clients.admin.rpc('reserve_seller_stripe_test_account', { p_seller: f.seller, p_platform: platform });
  assert.ok((await f.clients.admin.rpc('reserve_seller_stripe_test_account', { p_seller: f.seller, p_platform: 'acct_otherPlatform' })).error);
  assert.ok((await f.clients.admin.rpc('bind_seller_stripe_test_account', { p_seller: f.seller, p_reservation: randomUUID(), p_platform: platform, p_account: 'acct_wrongIntent' })).error);
});
