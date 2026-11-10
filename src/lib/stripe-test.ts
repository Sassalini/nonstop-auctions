import "server-only";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";
import type { StripeCheckoutAttempt } from "./transactions";

export function stripeTestConfig() {
  const secret = process.env.STRIPE_TEST_SECRET_KEY;
  const signingSecret = process.env.STRIPE_TEST_WEBHOOK_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret?.startsWith("sk_test_") || !signingSecret?.startsWith("whsec_") || !url ||
    url !== process.env.STRIPE_TEST_SUPABASE_URL || !serviceKey) return null;
  return { secret, signingSecret, url, serviceKey };
}

export function stripeTestOrigin() {
  if (process.env.STRIPE_TEST_CHECKOUT_ENABLED !== "true" || !stripeTestConfig()) return null;
  try {
    const url = new URL(process.env.STRIPE_TEST_APP_ORIGIN ?? "");
    const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1";
    if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) return null;
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function stripeTestCheckoutSetup() {
  if (process.env.STRIPE_TEST_CHECKOUT_ENABLED !== "true") {
    return { error: "Online payments are currently unavailable. Stripe test checkout is disabled for this environment." };
  }
  const config = stripeTestConfig();
  if (!config) return { error: "Online payments are unavailable because the Stripe sandbox or staging database configuration is incomplete. Contact support." };
  const origin = stripeTestOrigin();
  if (!origin) return { error: "Online payments are unavailable because the checkout return address is misconfigured. Contact support." };
  return { config, origin };
}

export function stripeTestClients(config: NonNullable<ReturnType<typeof stripeTestConfig>>,
  options?: Pick<Stripe.StripeConfig, "timeout" | "maxNetworkRetries">) {
  return {
    stripe: new Stripe(config.secret, { httpClient: Stripe.createFetchHttpClient(), timeout: 10000, maxNetworkRetries: 1, ...options }),
    admin: createClient<Database>(config.url, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    }),
  };
}

type PaymentAdmin = ReturnType<typeof stripeTestClients>["admin"];

export async function activeTestCheckout(admin: PaymentAdmin, orderId: string) {
  const { data, error } = await admin.from("stripe_checkout_attempts")
    .select("id,stripe_account,session_id,total_minor,method,created_at").eq("order_id", orderId).is("released_at", null).maybeSingle();
  if (error) throw error;
  return data;
}

export async function testSellerAccount(admin: PaymentAdmin, sellerId: string) {
  const { data, error } = await admin.from("seller_stripe_test_accounts").select("stripe_account").eq("seller_id", sellerId).maybeSingle();
  if (error) throw error;
  return data?.stripe_account;
}

export function testCheckoutCreatedAt(attempt: Pick<StripeCheckoutAttempt, "created_at">) {
  return Math.floor(new Date(attempt.created_at).getTime() / 1000);
}

export function canRetryTestCheckoutCreation(attempt: Pick<StripeCheckoutAttempt, "created_at">) {
  return Date.now() / 1000 <= testCheckoutCreatedAt(attempt) + 60 * 60;
}

export function sellerCanAcceptTestPayments(account: Stripe.Account) {
  return account.country === "GB" && account.details_submitted && account.charges_enabled && account.payouts_enabled &&
    account.capabilities?.card_payments === "active" && !account.requirements?.disabled_reason;
}

export function verifyTestCheckout(session: Stripe.Checkout.Session, attempt: Pick<StripeCheckoutAttempt, "id" | "session_id" | "total_minor">) {
  if (session.livemode || session.mode !== "payment" || session.currency !== "gbp" ||
    session.payment_method_types.length !== 1 || session.payment_method_types[0] !== "card" ||
    session.amount_total !== attempt.total_minor || session.metadata?.nonstop_test_attempt !== attempt.id ||
    (attempt.session_id && attempt.session_id !== session.id)) throw new Error("Checkout details do not match");
}

export function verifiedTestIntent(session: Stripe.Checkout.Session, attempt: Pick<StripeCheckoutAttempt, "id" | "total_minor">) {
  const intent = session.payment_intent;
  if (typeof intent === "string" || (intent && (intent.livemode || intent.currency !== "gbp" ||
    intent.amount !== attempt.total_minor || intent.metadata.nonstop_test_attempt !== attempt.id))) {
    throw new Error("Payment intent details do not match");
  }
  return intent;
}

export function isExpiredUnpaidCheckout(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent | null) {
  return session.status === "expired" && session.payment_status === "unpaid" &&
    (!intent || ["canceled", "requires_payment_method"].includes(intent.status));
}

export function testCheckoutSessionState(session: Stripe.Checkout.Session, intent: Stripe.PaymentIntent | null) {
  if (isExpiredUnpaidCheckout(session, intent)) return "expired";
  if (session.status === "complete" || session.payment_status === "paid" ||
    (intent && ["processing", "succeeded", "requires_capture"].includes(intent.status))) return "processing";
  if (session.status === "open" && session.payment_status === "unpaid" && session.url) return "open";
  throw new Error("Checkout session status is unverified");
}
