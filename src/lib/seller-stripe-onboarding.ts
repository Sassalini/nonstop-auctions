import "server-only";
import type Stripe from "stripe";
import { stripeTestClients, testSellerAccount } from "./stripe-test";

type Clients = ReturnType<typeof stripeTestClients>;
type Reservation = { id?: string; stripe_account?: string; may_create?: boolean; new_reservation?: boolean };

type RecoveryReason = "platform_mismatch" | "invalid_reservation" | "account_mismatch" |
  "ambiguous_accounts" | "incomplete_scan" | "expired_unresolved";

export class SellerSetupRecoveryRequired extends Error {
  constructor(readonly reason: RecoveryReason = "invalid_reservation") {
    super(`Your seller payment setup needs reconciliation. Contact support; another account will not be created. Support code: ${reason}.`);
    this.name = "SellerSetupRecoveryRequired";
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
    account.controller?.requirement_collection !== "stripe" ||
    account.controller?.stripe_dashboard?.type !== "full") throw new SellerSetupRecoveryRequired("account_mismatch");
  return account;
}

// Read-only: also used by the status page and expired-link refresh. A mapping
// alone must not bypass ownership/platform checks for automatically made accounts.
export async function readSellerTestAccount({ stripe, admin }: Clients, sellerId: string) {
  const accountId = await testSellerAccount(admin, sellerId);
  if (!accountId) return null;
  const { data: intent, error } = await admin.from("seller_stripe_test_provisioning")
    .select("id,platform_account,stripe_account").eq("seller_id", sellerId).maybeSingle();
  if (error) throw error;
  // Check platform identity first: a wrong sandbox often returns resource_missing
  // for the connected account, which would otherwise hide the actionable cause.
  if (intent && (await stripe.accounts.retrieve(null)).id !== intent.platform_account) {
    throw new SellerSetupRecoveryRequired("platform_mismatch");
  }
  const account = await stripe.accounts.retrieve(accountId);
  if (account.id !== accountId) throw new SellerSetupRecoveryRequired("account_mismatch");
  if (intent) {
    if (intent.stripe_account && intent.stripe_account !== accountId) throw new SellerSetupRecoveryRequired("account_mismatch");
    validateProvisionedAccount(account, intent.id);
  } else if (account.metadata?.nonstop_test_provisioning) {
    // A generated account without this seller's intent cannot be treated as an
    // operator mapping. Preserve the row and require an ownership investigation.
    throw new SellerSetupRecoveryRequired("account_mismatch");
  }
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
      if (match && match.id !== account.id) throw new SellerSetupRecoveryRequired("ambiguous_accounts");
      match = validateProvisionedAccount(account, reservationId);
    }
    if (!accounts.has_more) return match;
    cursor = accounts.data.at(-1)?.id;
    if (!cursor) break;
  }
  throw new SellerSetupRecoveryRequired("incomplete_scan");
}

export async function getOrCreateSellerTestAccount({ stripe, admin }: Clients, sellerId: string) {
  await requireStripeSandbox(stripe);
  const clients = { stripe, admin };
  const existing = await readSellerTestAccount(clients, sellerId);
  if (existing) return existing.id;
  const platform = await stripe.accounts.retrieve(null);
  const { data, error } = await admin.rpc("reserve_seller_stripe_test_account", { p_seller: sellerId, p_platform: platform.id });
  if (error) {
    if (error.message === "Seller setup requires reconciliation") throw new SellerSetupRecoveryRequired("platform_mismatch");
    throw error;
  }
  const reservation = data as Reservation | null;
  if (reservation?.stripe_account) {
    // Another request may have completed binding between our lookup and reserve.
    const mapped = await readSellerTestAccount(clients, sellerId);
    if (!mapped || mapped.id !== reservation.stripe_account) throw new SellerSetupRecoveryRequired("account_mismatch");
    return mapped.id;
  }
  if (!reservation?.id) throw new SellerSetupRecoveryRequired();
  const reservationId = reservation.id;
  // Prefer recovery even within the retry window: a previous Worker may have
  // created the account and died before binding. Never replay a known success.
  // Migration 020 identifies the sole inserting request. Missing this flag
  // (migration 019) safely falls back to recovery before any creation retry.
  let account = reservation.new_reservation === true ? undefined : await recoverAccount(stripe, reservationId);
  if (!account && reservation.may_create === true) {
    // Refresh the database's decision after the potentially slow account scan.
    // This reuses the same intent; it never renews its creation window.
    const { data: retryData, error: retryError } = await admin.rpc("reserve_seller_stripe_test_account", { p_seller: sellerId, p_platform: platform.id });
    if (retryError) {
      if (retryError.message === "Seller setup requires reconciliation") throw new SellerSetupRecoveryRequired("platform_mismatch");
      throw retryError;
    }
    const retry = retryData as Reservation | null;
    if (retry?.stripe_account) {
      const mapped = await readSellerTestAccount(clients, sellerId);
      if (!mapped || mapped.id !== retry.stripe_account) throw new SellerSetupRecoveryRequired("account_mismatch");
      return mapped.id;
    }
    if (retry?.id !== reservationId || retry?.may_create !== true) throw new SellerSetupRecoveryRequired("expired_unresolved");
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
  }
  if (!account) throw new SellerSetupRecoveryRequired("expired_unresolved");
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
