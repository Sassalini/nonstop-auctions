import "server-only";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./supabase/types";

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

export function stripeTestClients(config: NonNullable<ReturnType<typeof stripeTestConfig>>) {
  return {
    stripe: new Stripe(config.secret, { httpClient: Stripe.createFetchHttpClient(), timeout: 10000, maxNetworkRetries: 1 }),
    admin: createClient<Database>(config.url, config.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: (input, init) => fetch(input, { ...init, cache: "no-store" }) },
    }),
  };
}

export function sellerCanAcceptTestPayments(account: Stripe.Account) {
  return account.country === "GB" && account.details_submitted && account.charges_enabled && account.payouts_enabled &&
    account.capabilities?.card_payments === "active" && !account.requirements?.disabled_reason;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}
