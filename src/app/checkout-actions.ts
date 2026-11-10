"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isExpiredUnpaidCheckout, sellerCanAcceptTestPayments, stripeTestClients, stripeTestConfig, stripeTestOrigin, verifiedTestIntent, verifyTestCheckout } from "@/lib/stripe-test";
import { isCheckoutOrder, isUuid } from "@/lib/transactions";

const checkoutWindowSeconds = 2 * 60 * 60;
const creationRetrySeconds = 60 * 60;

export async function startTestCheckout(form: FormData) {
  const config = stripeTestConfig();
  const origin = stripeTestOrigin();
  if (!config || !origin) return { error: "Online payments are currently unavailable." };
  const lotId = form.get("lot");
  const method = form.get("method");
  const address = form.get("address");
  if (!isUuid(lotId) || (method !== "delivery" && method !== "collection")) {
    return { error: "Choose a valid delivery or collection method." };
  }

  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Sign in as the winning bidder." };
  const { data: order } = await client.from("fulfilment_orders")
    .select("id,seller_id,winning_minor,payment_state,shipping_state,terms_snapshot,fulfilment_method")
    .eq("lot_id", lotId).eq("buyer_id", user.id).maybeSingle();
  if (!order || order.winning_minor == null) return { error: "Order unavailable." };
  if (!isCheckoutOrder(order)) {
    return { error: "This order is not eligible for checkout." };
  }
  if (method === "delivery" && !(address === null && order.fulfilment_method === "delivery") && !isUuid(address)) {
    return { error: "Please select a delivery address" };
  }

  const { stripe, admin } = stripeTestClients(config);
  const returnUrl = `${origin}/orders/${lotId}`;
  let checkoutUrl: string;
  try {
    const { data: current, error: lookupError } = await admin.from("stripe_checkout_attempts")
      .select("stripe_account,session_id").eq("order_id", order.id).is("released_at", null).maybeSingle();
    if (lookupError) throw lookupError;
    let accountId = current?.stripe_account;
    if (!accountId) {
      const { data: seller, error } = await admin.from("seller_stripe_test_accounts")
        .select("stripe_account").eq("seller_id", order.seller_id).maybeSingle();
      if (error) throw error;
      accountId = seller?.stripe_account;
    }
    if (!accountId) return { error: "The seller has not set up test payments." };
    if (!current?.session_id && !sellerCanAcceptTestPayments(await stripe.accounts.retrieve(accountId))) {
      return { error: "The seller’s Stripe account is not ready to accept payments." };
    }
    const { data: attempt, error: reserveError } = await admin.rpc("reserve_test_checkout", {
      p_buyer: user.id, p_order: order.id, p_method: method,
      p_address: method === "delivery" && isUuid(address) ? address : null, p_account: accountId,
    });
    if (reserveError?.message === "Choose your own saved address") return { error: "Please select a delivery address" };
    if (reserveError) return { error: reserveError.code === "P0001" ? reserveError.message : "Checkout is temporarily unavailable." };
    if (!attempt || attempt.stripe_account !== accountId) return { error: "Checkout changed. Please refresh and retry." };

    const created = Math.floor(new Date(attempt.created_at).getTime() / 1000);
    const stripeAccount = attempt.stripe_account;
    const metadata = { nonstop_test_attempt: attempt.id };
    const item = (name: string, amount: number) => ({
      quantity: 1,
      price_data: { currency: "gbp", unit_amount: amount, product_data: { name } },
    });
    // The key and request parameters remain stable across concurrent calls and
    // timeouts. Never issue a new create outside the safe retry window.
    if (!attempt.session_id && Date.now() / 1000 > created + creationRetrySeconds) {
      return { error: "The previous checkout needs reconciliation before another payment can be attempted." };
    }
    let session = attempt.session_id
      ? await stripe.checkout.sessions.retrieve(attempt.session_id, { expand: ["payment_intent"] }, { stripeAccount })
      : await stripe.checkout.sessions.create({
        mode: "payment", allowed_payment_method_types: ["card"], locale: "en-GB",
        adaptive_pricing: { enabled: false },
        expires_at: created + checkoutWindowSeconds,
        success_url: `${returnUrl}?checkout=returned`, cancel_url: returnUrl,
        line_items: [item("Winning auction bid", attempt.total_minor - attempt.postage_minor),
          ...(attempt.postage_minor ? [item("Delivery", attempt.postage_minor)] : [])],
        metadata, payment_intent_data: { metadata },
      }, { stripeAccount, idempotencyKey: `nonstop-test-checkout-${attempt.id}` });
    verifyTestCheckout(session, attempt);
    if (!attempt.session_id && session.status === "expired") {
      session = await stripe.checkout.sessions.retrieve(session.id, { expand: ["payment_intent"] }, { stripeAccount });
      verifyTestCheckout(session, attempt);
    }
    const { data: bound, error: bindError } = await admin.rpc("bind_test_checkout", { p_attempt: attempt.id, p_session: session.id });
    if (bindError || !bound) throw new Error("Could not bind Stripe session");
    if (session.status === "expired") {
      const intent = verifiedTestIntent(session, attempt);
      if (!isExpiredUnpaidCheckout(session, intent)) return { error: "Stripe is still reconciling this payment. Please check again shortly." };
      const { error } = await admin.rpc("record_test_payment", {
        p_event: `reconciled-expiry:${session.id}`, p_attempt: attempt.id, p_account: stripeAccount, p_session: session.id,
        p_intent: intent?.id ?? null, p_total: attempt.total_minor, p_kind: "expired",
      });
      if (error) throw error;
      return { error: "Checkout expired. Review your order and try again." };
    }
    if (session.status === "complete") {
      checkoutUrl = `${returnUrl}?checkout=returned`;
    } else {
      if (session.status !== "open" || session.payment_status !== "unpaid" || !session.url) throw new Error("Checkout unavailable");
      if (current?.session_id && !sellerCanAcceptTestPayments(await stripe.accounts.retrieve(stripeAccount))) {
        return { error: "The seller’s Stripe account is not ready to accept payments." };
      }
      checkoutUrl = session.url;
    }
  } catch {
    return { error: "Could not open Stripe Checkout. Retry to resume the same payment attempt." };
  }
  redirect(checkoutUrl);
}

export async function openSellerTestOnboarding() {
  const config = stripeTestConfig();
  const origin = stripeTestOrigin();
  if (!config || !origin) return { error: "Stripe test onboarding is unavailable." };
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Sign in to manage your seller account." };
  const { stripe, admin } = stripeTestClients(config);
  const { data: mapping } = await admin.from("seller_stripe_test_accounts").select("stripe_account").eq("seller_id", user.id).maybeSingle();
  if (!mapping) return { error: "An operator must assign a Stripe sandbox account before onboarding." };
  let url: string;
  try {
    const returnUrl = `${origin}/account/seller-payments`;
    const link = await stripe.accountLinks.create({
      account: mapping.stripe_account, type: "account_onboarding",
      refresh_url: returnUrl, return_url: returnUrl,
    });
    url = link.url;
  } catch {
    return { error: "Could not open Stripe onboarding. Please try again." };
  }
  redirect(url);
}
