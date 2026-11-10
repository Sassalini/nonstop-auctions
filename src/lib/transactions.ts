export type AddressDetails = { recipient: string; line1: string; line2: string; city: string; region: string; postcode: string; country: string; instructions: string };
export type DeliveryAddress = { id: string; user_id: string; details: AddressDetails; is_default: boolean; created_at: string };
export type FulfilmentMethod = "delivery" | "collection";
export type FulfilmentTerms = {
  mode: FulfilmentMethod | "both";
  postage_minor?: number;
  country?: "GB";
  postcode_areas?: string[];
  service?: string;
  handling_days?: number;
  restrictions?: string;
  collection_area?: string;
};
export type PaymentState = "NOT_RECORDED" | "UNPAID" | "PENDING" | "PAID" | "FAILED" | "PARTIALLY_REFUNDED" | "REFUNDED" | "DISPUTED";
export const paymentLabels: Record<PaymentState, string> = {
  NOT_RECORDED: "Payment not recorded",
  UNPAID: "Awaiting payment",
  PENDING: "Payment pending",
  PAID: "Paid",
  FAILED: "Payment failed or checkout expired",
  PARTIALLY_REFUNDED: "Partially refunded",
  REFUNDED: "Refunded",
  DISPUTED: "Payment disputed",
};
export type FulfilmentOrder = {
  id: string; lot_id: string; preview_started_at: string; buyer_id: string; seller_id: string;
  payment_state: PaymentState; shipping_state: string; terms_snapshot: FulfilmentTerms | null;
  winning_minor: number | null; fulfilment_method: FulfilmentMethod | null; postage_minor: number | null;
  refunded_minor: number; seller_handover_at: string | null; address_snapshot: AddressDetails | null;
  service: string; tracking: string; delivery_notes: string; dispatched_at: string | null;
  buyer_received_at: string | null; seller_delivery_reported_at: string | null; version: number; created_at: string;
};
export const fulfilmentLabels: Record<string, string> = {
  AWAITING_ADDRESS: "Awaiting address",
  AWAITING_PAYMENT: "Awaiting payment",
  AWAITING_DISPATCH: "Preparing for dispatch",
  DISPATCHED: "Dispatched",
  DELIVERED: "Buyer confirmed receipt",
  PREPARING_COLLECTION: "Preparing for collection",
  READY_FOR_COLLECTION: "Ready for collection",
  COLLECTION_ARRANGED: "Collection arranged",
  EXCEPTION: "Fulfilment issue",
  CANCELLED: "Cancelled",
};
export function fulfilmentLabel(order: Pick<FulfilmentOrder, "shipping_state" | "fulfilment_method">) {
  if (order.shipping_state === "DELIVERED" && order.fulfilment_method === "collection") return "Collected";
  return fulfilmentLabels[order.shipping_state] ?? order.shipping_state;
}

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(value);
}

export function isCheckoutOrder(order: Pick<FulfilmentOrder, "terms_snapshot" | "winning_minor" | "shipping_state" | "payment_state">) {
  return Boolean(order.terms_snapshot && order.winning_minor != null && order.shipping_state === "AWAITING_PAYMENT" &&
    ["UNPAID", "PENDING", "FAILED"].includes(order.payment_state));
}

// Presentation check only. Checkout revalidates the address and price in Postgres.
export function eligibleDeliveryAddress(address: AddressDetails, terms: FulfilmentTerms) {
  const country = address.country.trim().toLowerCase();
  const postcode = address.postcode.toUpperCase().replace(/\s/g, "");
  if (!["united kingdom", "uk", "gb", "england", "scotland", "wales", "northern ireland"].includes(country) ||
    !/^([A-Z]{1,2}[0-9][0-9A-Z]?|GIR)[0-9][A-Z]{2}$/.test(postcode) || /^(GY|JE|IM)[0-9]/.test(postcode)) return false;
  return !terms.postcode_areas?.length || terms.postcode_areas.includes(postcode.match(/^[A-Z]{1,2}/)?.[0] ?? "");
}
export type StripeCheckoutAttempt = {
  id: string; order_id: string; stripe_account: string; session_id: string | null; payment_intent_id: string | null;
  method: FulfilmentMethod; postage_minor: number; total_minor: number;
  pending_address: AddressDetails | null; created_at: string; released_at: string | null;
};
export type Conversation = { id: string; lot_id: string; buyer_id: string; seller_id: string; buyer_read_at: string; seller_read_at: string; created_at: string };
export type PrivateMessage = { id: string; conversation_id: string; sender_id: string; body: string; client_key: string; created_at: string; deleted_at: string | null };
export type FulfilmentEvent = { id: string; order_id: string; actor_id: string | null; kind: string; version: number; created_at: string };
