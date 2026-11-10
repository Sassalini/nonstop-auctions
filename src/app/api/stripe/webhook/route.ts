import Stripe from "stripe";
import { isExpiredUnpaidCheckout, stripeTestClients, stripeTestConfig, verifiedTestIntent, verifyTestCheckout } from "@/lib/stripe-test";
import { isUuid } from "@/lib/transactions";

function providerId(value: string | { id: string } | null | undefined) {
  return typeof value === "string" ? value : value?.id;
}

async function recordEvent(event: Stripe.Event, { stripe, admin }: ReturnType<typeof stripeTestClients>) {
  if (event.livemode || !event.account) return;
  const stripeAccount = event.account;
  const scope = { stripeAccount };
  let sessionId: string | undefined;
  let intentId: string | undefined;
  let attemptId: string | undefined;
  let disputeId: string | undefined;
  let refundId: string | undefined;

  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.expired":
      sessionId = event.data.object.id;
      attemptId = event.data.object.metadata?.nonstop_test_attempt;
      break;
    case "payment_intent.payment_failed":
    case "payment_intent.succeeded":
      intentId = event.data.object.id;
      attemptId = event.data.object.metadata.nonstop_test_attempt;
      break;
    case "refund.created":
    case "refund.updated":
    case "refund.failed":
      intentId = providerId(event.data.object.payment_intent);
      refundId = event.data.object.id;
      break;
    case "charge.dispute.created":
    case "charge.dispute.updated":
    case "charge.dispute.closed":
      intentId = providerId(event.data.object.payment_intent);
      disputeId = event.data.object.id;
      break;
    default:
      return;
  }
  if (!attemptId && !intentId) return;
  const processed = await admin.from("stripe_payment_events").select("id").eq("id", event.id).maybeSingle();
  if (processed.error) throw processed.error;
  if (processed.data) return;
  if (!attemptId && intentId) {
    const intent = await stripe.paymentIntents.retrieve(intentId, {}, scope);
    attemptId = intent.metadata.nonstop_test_attempt;
  }
  if (!isUuid(attemptId)) return;
  const { data: attempt, error } = await admin.from("stripe_checkout_attempts")
    .select("id,stripe_account,session_id,total_minor").eq("id", attemptId).maybeSingle();
  if (error) throw error;
  if (!attempt || attempt.stripe_account !== stripeAccount) return;
  sessionId ??= attempt.session_id ?? undefined;
  if (!sessionId) throw new Error("Checkout session not bound yet");

  const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] }, scope);
  verifyTestCheckout(session, attempt);
  const intent = verifiedTestIntent(session, attempt);
  if (intentId && intent?.id !== intentId) throw new Error("Payment intent does not match checkout");

  let kind: string;
  let refunded: number | undefined;
  let adjustmentStatus: string | undefined;
  if (session.payment_status === "paid" && session.status === "complete" && intent?.status === "succeeded" &&
    intent.amount_received === attempt.total_minor) {
    kind = "paid";
    if (refundId) {
      kind = "refund";
      const refund = await stripe.refunds.retrieve(refundId, {}, scope);
      if (refund.currency !== "gbp" || providerId(refund.payment_intent) !== intent.id) throw new Error("Refund does not match payment");
      refunded = refund.amount;
      adjustmentStatus = refund.status === "succeeded" ? "SUCCEEDED" :
        ["failed", "canceled"].includes(refund.status ?? "") ? "FAILED" : "PENDING";
    }
    if (disputeId) {
      kind = "dispute";
      const dispute = await stripe.disputes.retrieve(disputeId, {}, scope);
      if (providerId(dispute.payment_intent) !== intent.id) throw new Error("Dispute does not match payment");
      adjustmentStatus = dispute.status === "lost" ? "LOST" :
        ["won", "warning_closed", "prevented"].includes(dispute.status) ? "RESOLVED" : "OPEN";
    }
  } else if (isExpiredUnpaidCheckout(session, intent)) {
    kind = "expired";
  } else if (event.type === "payment_intent.payment_failed" && session.status === "open" && session.payment_status === "unpaid" &&
    intent?.status === "requires_payment_method") {
    kind = "failed";
  } else {
    throw new Error("Stripe payment is awaiting reconciliation");
  }

  const result = await admin.rpc("record_test_payment", {
    p_event: event.id, p_attempt: attemptId, p_account: stripeAccount, p_session: session.id,
    p_intent: intent?.id ?? null, p_total: attempt.total_minor, p_kind: kind,
    p_refund_amount: refunded, p_adjustment: refundId ?? disputeId, p_adjustment_status: adjustmentStatus,
  });
  if (result.error) throw result.error;
}

export async function POST(request: Request) {
  const config = stripeTestConfig();
  if (!config) return new Response("Stripe test webhook unavailable", { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing Stripe signature", { status: 400 });
  if (signature.length > 4096 || Number(request.headers.get("content-length")) > 1024 * 1024) {
    return new Response("Stripe webhook payload too large", { status: 413 });
  }
  const clients = stripeTestClients(config);
  let event: Stripe.Event;
  try {
    const body = await request.text();
    if (body.length > 1024 * 1024) return new Response("Stripe webhook payload too large", { status: 413 });
    event = await clients.stripe.webhooks.constructEventAsync(
      body, signature, config.signingSecret, undefined, Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return new Response("Invalid Stripe signature or payload", { status: 400 });
  }
  try {
    await recordEvent(event, clients);
    return new Response(null, { status: 204 });
  } catch {
    // Keep provider data and credentials out of logs. Stripe can retry 5xx.
    console.error("Stripe test webhook requires reconciliation", event.id, event.type);
    return new Response("Payment event could not be recorded", { status: 503 });
  }
}
