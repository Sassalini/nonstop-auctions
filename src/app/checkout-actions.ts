"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isUuid, sellerCanAcceptTestPayments, stripeTestClients, stripeTestConfig, stripeTestOrigin } from "@/lib/stripe-test";

const checkoutWindowSeconds = 2 * 60 * 60;
const creationRetrySeconds = 60 * 60;

export async function startTestCheckout(form: FormData) {
  const config = stripeTestConfig();
  const origin = stripeTestOrigin();
  if (!config || !origin) return { error: "Online payments are currently unavailable." };
  const lotId = form.get("lot");
  const method = form.get("method");
  const address = form.get("address");
  if (!isUuid(lotId) || (method !== "delivery" && method !== "collection" && method !== null) ||
    (address !== null && address !== "" && !isUuid(address))) return { error: "Choose a valid fulfilment method and address." };

  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) return { error: "Sign in as the winning bidder." };
  const { data: order } = await client.from("fulfilment_orders")
    .select("id,seller_id,winning_minor,payment_state,shipping_state")
    .eq("lot_id", lotId).eq("buyer_id", user.id).maybeSingle();
  if (!order || order.winning_minor == null) return { error: "Order unavailable." };
  if (order.shipping_state !== "AWAITING_PAYMENT" || !["UNPAID", "PENDING", "FAILED"].includes(order.payment_state)) {
    return { error: "This order is not eligible for checkout." };
  }

  const { stripe, admin } = stripeTestClients(config);
  let checkoutUrl: string;
  try {
    const { data: current, error: lookupError } = await admin.from("stripe_checkout_attempts")
      .select("stripe_account").eq("order_id", order.id).is("released_at", null).maybeSingle();
    if (lookupError) throw lookupError;
    let accountId = current?.stripe_account;
    if (!accountId) {
      const { data: seller, error } = await admin.from("seller_stripe_test_accounts")
        .select("stripe_account").eq("seller_id", order.seller_id).maybeSingle();
      if (error) throw error;
      accountId = seller?.stripe_account;
    }
    if (!accountId) return { error: "The seller has not set up test payments." };
    const account = await stripe.accounts.retrieve(accountId);
    if (!sellerCanAcceptTestPayments(account)) return { error: "The seller’s Stripe account is not ready to accept payments." };
    const { data: attempt, error: reserveError } = await admin.rpc("reserve_test_checkout", {
      p_buyer: user.id, p_order: order.id, p_method: method, p_address: isUuid(address) ? address : null, p_account: accountId,
    });
    if (reserveError) return { error: reserveError.code === "P0001" ? reserveError.message : "Checkout is temporarily unavailable." };
    if (!attempt || attempt.stripe_account !== accountId) return { error: "Checkout changed. Please refresh and retry." };

    const created = Math.floor(new Date(attempt.created_at).getTime() / 1000);
    const stripeAccount = attempt.stripe_account;
    const returnUrl = `${origin}/orders/${lotId}`;
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
    const session = attempt.session_id
      ? await stripe.checkout.sessions.retrieve(attempt.session_id, {}, { stripeAccount })
      : await stripe.checkout.sessions.create({
        mode: "payment", allowed_payment_method_types: ["card"], locale: "en-GB",
        adaptive_pricing: { enabled: false },
        expires_at: created + checkoutWindowSeconds,
        success_url: `${returnUrl}?checkout=returned`, cancel_url: returnUrl,
        line_items: [item("Winning auction bid", attempt.total_minor - attempt.postage_minor),
          ...(attempt.postage_minor ? [item("Delivery", attempt.postage_minor)] : [])],
        metadata, payment_intent_data: { metadata },
      }, { stripeAccount, idempotencyKey: `nonstop-test-checkout-${attempt.id}` });
    if (session.livemode || session.currency !== "gbp" || session.amount_total !== attempt.total_minor ||
      session.payment_method_types.length !== 1 || session.payment_method_types[0] !== "card" ||
      session.metadata?.nonstop_test_attempt !== attempt.id) throw new Error("Stripe session mismatch");
    if (session.status !== "open" || !session.url) {
      return { error: "Stripe has closed this checkout. Refresh the order once the payment status has updated." };
    }
    const { data: bound, error: bindError } = await admin.rpc("bind_test_checkout", { p_attempt: attempt.id, p_session: session.id });
    if (bindError || !bound) throw new Error("Could not bind Stripe session");
    checkoutUrl = session.url;
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
