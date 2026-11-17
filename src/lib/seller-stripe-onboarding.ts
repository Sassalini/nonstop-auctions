import "server-only";
import type Stripe from "stripe";
import { stripeTestClients, testSellerAccount } from "./stripe-test";

type Clients = ReturnType<typeof stripeTestClients>;

export class SellerSetupRecoveryRequired extends Error {
  constructor() {
    super("Your seller payment setup needs reconciliation. Contact support; another account will not be created.");
  }
}

export async function requireStripeSandbox(stripe: Clients["stripe"]) {
  // Account objects have no livemode field. Verify the API request's mode using
  // the platform balance, in addition to the sk_test_ configuration guard.
  if ((await stripe.balance.retrieve()).livemode !== false) throw new Error("Sandbox required");
}

function validateProvisionedAccount(account: Stripe.Account, reservationId: string) {
  if (account.country !== "GB" || account.metadata?.nonstop_test_provisioning !== reservationId ||
    account.controller?.fees?.payer !== "account" || account.controller?.losses?.payments !== "stripe" ||
    account.controller?.stripe_dashboard?.type !== "full") throw new SellerSetupRecoveryRequired();
  return account;
}

async function recoverAccount(stripe: Clients["stripe"], reservationId: string) {
  // Bounded scans keep Worker requests finite. An incomplete scan or no match
  // never authorizes another create after the one-hour retry window.
  let cursor: string | undefined;
  let match: Stripe.Account | undefined;
  for (let page = 0; page < 10; page++) {
    const accounts = await stripe.accounts.list({ limit: 100, ...(cursor ? { starting_after: cursor } : {}) });
    for (const account of accounts.data) {
      if (account.metadata?.nonstop_test_provisioning !== reservationId) continue;
      if (match && match.id !== account.id) throw new SellerSetupRecoveryRequired();
      match = validateProvisionedAccount(account, reservationId);
    }
    if (!accounts.has_more) return match;
    cursor = accounts.data.at(-1)?.id;
    if (!cursor) break;
  }
  throw new SellerSetupRecoveryRequired();
}

export async function getOrCreateSellerTestAccount({ stripe, admin }: Clients, sellerId: string) {
  await requireStripeSandbox(stripe);
  const existing = await testSellerAccount(admin, sellerId);
  if (existing) return existing;
  const platform = await stripe.accounts.retrieve(null);
  const { data, error } = await admin.rpc("reserve_seller_stripe_test_account", { p_seller: sellerId, p_platform: platform.id });
  if (error) {
    if (error.message === "Seller setup requires reconciliation") throw new SellerSetupRecoveryRequired();
    throw error;
  }
  const reservation = data as { id?: string; stripe_account?: string; may_create?: boolean } | null;
  if (reservation?.stripe_account) return reservation.stripe_account;
  if (!reservation?.id) throw new SellerSetupRecoveryRequired();
  const reservationId = reservation.id;
  let account: Stripe.Account | undefined;
  if (reservation.may_create === true) {
    try {
      // These v1 parameters must remain immutable for this reservation/version.
      // Full Dashboard / seller fees / Stripe losses supports existing direct
      // charges without introducing Express platform liability or transfers.
      account = await stripe.accounts.create({
        country: "GB",
        controller: { fees: { payer: "account" }, losses: { payments: "stripe" },
          requirement_collection: "stripe", stripe_dashboard: { type: "full" } },
        capabilities: { card_payments: { requested: true } },
        metadata: { nonstop_test_provisioning: reservationId },
      }, { idempotencyKey: `nonstop-test-seller-v1-${reservationId}` });
    } catch {
      // Covers lost responses and cached Stripe 500s; absence is not proof that
      // nothing was created. A later retry uses the same durable key.
      account = await recoverAccount(stripe, reservationId);
      if (!account) throw new Error("Stripe setup could not be confirmed");
    }
  } else {
    account = await recoverAccount(stripe, reservationId);
  }
  if (!account) throw new SellerSetupRecoveryRequired();
  validateProvisionedAccount(account, reservationId);
  const { data: bound, error: bindError } = await admin.rpc("bind_seller_stripe_test_account", {
    p_seller: sellerId, p_reservation: reservationId, p_platform: platform.id, p_account: account.id,
  });
  if (bindError || bound !== account.id) throw new Error("Seller mapping could not be saved");
  return bound;
}

export async function sellerTestAccountLink(stripe: Clients["stripe"], origin: string, accountId: string) {
  const link = await stripe.accountLinks.create({
    account: accountId, type: "account_onboarding",
    refresh_url: `${origin}/account/seller-payments/refresh`,
    return_url: `${origin}/account/seller-payments`,
  });
  const url = new URL(link.url);
  if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com" || url.username || url.password) {
    throw new Error("Invalid onboarding redirect");
  }
  return link.url;
}
