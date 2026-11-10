import "server-only";
import {
  activeTestCheckout, canRetryTestCheckoutCreation, sellerCanAcceptTestPayments, stripeTestCheckoutSetup,
  stripeTestClients, testCheckoutSessionState, testSellerAccount, verifiedTestIntent, verifyTestCheckout,
} from "./stripe-test";
import type { BuyerCheckoutStatus, FulfilmentOrder } from "./transactions";

// Called only after the server has authenticated the winning buyer and checked order eligibility.
export async function buyerCheckoutStatus(order: FulfilmentOrder): Promise<BuyerCheckoutStatus> {
  const unavailable = (reason: string): BuyerCheckoutStatus => ({ kind: "unavailable", reason });
  const setup = stripeTestCheckoutSetup();
  if (setup.error !== undefined) return unavailable(setup.error);
  const { stripe, admin } = stripeTestClients(setup.config, { timeout: 4000, maxNetworkRetries: 0 });
  try {
    const attempt = await activeTestCheckout(admin, order.id);
    if ((attempt?.method ?? null) !== order.fulfilment_method || (order.payment_state === "PENDING" && !attempt)) {
      return unavailable("The order or its checkout has changed. Refresh the order to check payment status. Contact support if this persists.");
    }
    if (attempt?.session_id) {
      const session = await stripe.checkout.sessions.retrieve(attempt.session_id, { expand: ["payment_intent"] }, { stripeAccount: attempt.stripe_account });
      verifyTestCheckout(session, attempt);
      const state = testCheckoutSessionState(session, verifiedTestIntent(session, attempt));
      if (state === "processing") return { kind: "processing" };
      if (state === "expired") return { kind: "retry" };
    }
    if (attempt && !attempt.session_id && !canRetryTestCheckoutCreation(attempt)) {
      return unavailable("Support must verify the previous payment attempt with Stripe before checkout can be retried.");
    }

    const accountId = attempt?.stripe_account ?? await testSellerAccount(admin, order.seller_id);
    if (!accountId) return unavailable("Online payments are unavailable until the seller sets up Stripe. Contact the seller.");
    if (!sellerCanAcceptTestPayments(await stripe.accounts.retrieve(accountId))) {
      return unavailable("The seller’s Stripe account cannot accept payments yet. Contact the seller to complete or review their Stripe setup.");
    }
    if (attempt) return { kind: attempt.session_id ? "continue" : "recover" };
    return { kind: order.payment_state === "FAILED" ? "retry" : "pay" };
  } catch {
    return unavailable("We couldn’t verify checkout availability. Refresh the order or contact support if this persists.");
  }
}
