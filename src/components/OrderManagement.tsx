"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { transactionAction } from "@/app/transaction-actions";
import { formatCurrency } from "@/lib/format";
import { fulfilmentLabel, fulfilmentLabels, paymentLabels, type DeliveryAddress, type FulfilmentOrder, type FulfilmentEvent } from "@/lib/transactions";
import { OrderCheckout } from "./OrderCheckout";
import { buttonStyle, inputStyle, TransactionButton } from "./TransactionControls";

function carrierTrackingLink(service: string, tracking: string) {
  if (!tracking.trim()) return null;
  const code = encodeURIComponent(tracking.trim());
  if (/^royal mail$/i.test(service.trim())) return `https://www.royalmail.com/track-your-item#/tracking-results/${code}`;
  if (/^ups$/i.test(service.trim())) return `https://www.ups.com/track?tracknum=${code}`;
  if (/^fedex$/i.test(service.trim())) return `https://www.fedex.com/fedextrack/?trknbr=${code}`;
  return null;
}

function orderTime(value: string) {
  return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function SellerFulfilmentForm({ order, collection, legacy }: { order: FulfilmentOrder; collection: boolean; legacy: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const currentState = order.shipping_state;
  const editableStates = collection
    ? ["READY_FOR_COLLECTION", ...(currentState === "PREPARING_COLLECTION" ? [] : ["COLLECTION_ARRANGED"]), "EXCEPTION"]
    : [...(order.dispatched_at ? [] : ["AWAITING_DISPATCH"]), "DISPATCHED", ...(legacy && !order.dispatched_at ? ["COLLECTION_ARRANGED"] : []), "EXCEPTION"];
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const result = await transactionAction(collection ? "collection" : "shipping", {
        order: order.id, version: order.version, state: String(fields.get("state") ?? ""),
        service: String(fields.get("service") ?? ""), tracking: String(fields.get("tracking") ?? ""),
        notes: String(fields.get("notes") ?? ""),
      });
      setError(result.error ?? "");
      if (!result.error) router.refresh();
    } finally {
      setBusy(false);
    }
  }
  return <form className="space-y-3" onSubmit={save}>
    <label className="block text-sm">{collection ? "Collection status" : "Shipping status"}
      <select required name="state" className={inputStyle} defaultValue={editableStates.includes(currentState) ? currentState : ""}>
        <option value="" disabled>{fulfilmentLabels[currentState]}</option>
        {editableStates.map(state => <option key={state} value={state}>{state === "EXCEPTION"
          ? collection ? "Collection issue" : "Delivery issue"
          : state === "AWAITING_DISPATCH" ? "Awaiting dispatch" : fulfilmentLabels[state]}</option>)}
      </select>
    </label>
    {!collection && <>
      <label className="block text-sm">Courier / service<input className={inputStyle} name="service" maxLength={100} defaultValue={order.service} /></label>
      <label className="block text-sm">Tracking reference<input className={inputStyle} name="tracking" maxLength={100} defaultValue={order.tracking} /></label>
    </>}
    <label className="block text-sm">{collection ? "Private collection arrangements" : "Delivery notes"}
      <textarea className={inputStyle} name="notes" maxLength={1000} defaultValue={order.delivery_notes} />
    </label>
    <button disabled={busy} className={buttonStyle}>{collection ? "Save collection update" : "Save shipping update"}</button>
    {error && <p role="alert" className="text-red-300">{error}</p>}
  </form>;
}

export function OrderManagement({ order, buyer, addresses, events, checkoutEnabled, returned }: {
  order: FulfilmentOrder; buyer: boolean; addresses: DeliveryAddress[]; events: FulfilmentEvent[];
  checkoutEnabled: boolean; returned: boolean;
}) {
  const [address, setAddress] = useState(addresses.find(item => item.is_default)?.id ?? addresses[0]?.id ?? "");
  const [reason, setReason] = useState("");
  const terms = order.terms_snapshot;
  const legacy = !terms;
  const collection = order.fulfilment_method === "collection";
  const shipping = order.shipping_state;
  const paid = order.payment_state === "PAID" || order.payment_state === "PARTIALLY_REFUNDED";
  const canFulfil = (paid || legacy) && shipping !== "CANCELLED";
  const canCheckout = buyer && terms && shipping === "AWAITING_PAYMENT" && order.winning_minor != null &&
    ["UNPAID", "PENDING", "FAILED"].includes(order.payment_state);
  const payload = { order: order.id, version: order.version };
  const link = carrierTrackingLink(order.service, order.tracking);
  const canConfirmReceipt = buyer && canFulfil && !collection && (shipping === "DISPATCHED" ||
    (legacy && shipping === "COLLECTION_ARRANGED") || (shipping === "EXCEPTION" && Boolean(order.dispatched_at)));
  const confirmed = collection ? "Collected" : fulfilmentLabels.DELIVERED;

  return <div className="grid gap-5 lg:grid-cols-2">
    <section className="premium-card min-w-0 space-y-4 rounded-lg p-5">
      <h2 className="text-lg font-semibold">Order progress</h2>
      <p className="text-sm">Payment · {paymentLabels[order.payment_state]}</p>
      <p className="text-sm">Fulfilment · {fulfilmentLabel(order)}</p>
      {returned && canCheckout && <p role="status" className="text-sm text-auction-gold">Waiting for Stripe confirmation. Refresh this page to check for an update.</p>}
      {order.refunded_minor > 0 && <p className="text-sm">Refunded · {formatCurrency(order.refunded_minor / 100)}</p>}
      {order.fulfilment_method && order.winning_minor != null && order.postage_minor != null &&
        <p className="text-sm">Order total · {formatCurrency((order.winning_minor + order.postage_minor) / 100)}</p>}
      {legacy && <p className="text-sm text-auction-muted">This sale predates online checkout. Its existing fulfilment history is available here.</p>}
      {terms && <div className="space-y-2 text-sm">
        <h3 className="font-semibold">Agreed listing terms</h3>
        {terms.mode !== "collection" && <p className="break-words">
          {terms.postage_minor ? `${formatCurrency(terms.postage_minor / 100)} delivery` : "Free delivery"} ·
          {terms.postcode_areas?.length ? ` UK postcode areas ${terms.postcode_areas.join(", ")}` : " United Kingdom"} ·
          {" "}{terms.service} · Dispatch within {terms.handling_days} working day(s). {terms.restrictions}
        </p>}
        {terms.collection_area && <p>Free collection in {terms.collection_area}. Arrange the handover privately after payment.</p>}
      </div>}
      {!collection && (legacy || order.address_snapshot) && <>
        <h3 className="font-semibold">Order delivery address</h3>
        {order.address_snapshot ? <address className="whitespace-pre-line break-words text-sm not-italic leading-6">
          {(["recipient", "line1", "line2", "city", "region", "postcode", "country", "instructions"] as const)
            .map(key => order.address_snapshot?.[key]).filter(Boolean).join("\n")}
        </address> : <p className="text-sm">No address confirmed.</p>}
      </>}
      {legacy && buyer && ["AWAITING_ADDRESS", "AWAITING_DISPATCH"].includes(shipping) && !order.dispatched_at && <div className="space-y-3">
        <label className="block text-sm">Select or correct delivery address
          <select className={`${inputStyle} mt-2`} value={address} onChange={event => setAddress(event.target.value)}>
            <option value="">Choose an address</option>
            {addresses.map(item => <option key={item.id} value={item.id}>{item.details.recipient} · {item.details.line1} · {item.details.postcode}</option>)}
          </select>
        </label>
        <TransactionButton action="select_address" payload={{ ...payload, address }}>Confirm order address</TransactionButton>
        <Link className="block text-sm text-auction-gold underline" href="/account/addresses">Manage delivery addresses</Link>
        <p className="text-xs text-auction-muted">Corrections notify the seller and are locked after dispatch.</p>
      </div>}
      <TransactionButton action="conversation" payload={{ lot: order.lot_id }}>Contact {buyer ? "seller" : "buyer"}</TransactionButton>
      {canConfirmReceipt && <TransactionButton action="receipt" payload={payload}>Confirm I have received this item</TransactionButton>}
      {collection && buyer && canFulfil && shipping !== "DELIVERED" && order.seller_handover_at &&
        <TransactionButton action="collection_confirm" payload={payload}>Confirm I collected this item</TransactionButton>}
      {order.buyer_received_at && <p className="text-sm">{confirmed} on {orderTime(order.buyer_received_at)}.</p>}
    </section>

    <section className="premium-card min-w-0 space-y-4 rounded-lg p-5">
      <h2 className="text-lg font-semibold">{collection ? "Collection arrangements" : "Delivery management"}</h2>
      {!collection && (legacy || order.fulfilment_method === "delivery") && <>
        <p className="break-words text-sm">Service: {order.service || "Not provided"}<br />Tracking reference: {order.tracking || "Not provided"}</p>
        {order.dispatched_at && <p className="text-sm">Dispatched: {orderTime(order.dispatched_at)}</p>}
        {link && <a className="inline-block text-auction-gold underline" target="_blank" rel="noopener noreferrer" href={link}>Track with carrier (opens in a new tab)</a>}
        {order.seller_delivery_reported_at && <p className="text-sm">Seller reports delivery. This is not independently verified.</p>}
      </>}
      {collection && order.seller_handover_at && <p className="text-sm">Seller recorded handover on {orderTime(order.seller_handover_at)}.</p>}
      {order.delivery_notes && <p className="whitespace-pre-wrap break-words text-sm">{order.delivery_notes}</p>}
      {!canFulfil && shipping !== "CANCELLED" && <p className="text-sm text-auction-muted">Fulfilment updates require confirmed payment.</p>}
      {!buyer && canFulfil && shipping !== "DELIVERED" && !order.seller_handover_at &&
        <SellerFulfilmentForm key={order.version} order={order} collection={collection} legacy={legacy} />}
      {!buyer && canFulfil && collection && shipping === "COLLECTION_ARRANGED" && !order.seller_handover_at &&
        <TransactionButton action="collection_confirm" payload={payload}>Record handover to buyer</TransactionButton>}
      {!buyer && canFulfil && order.dispatched_at && !order.seller_delivery_reported_at &&
        <TransactionButton action="seller_delivery_report" payload={payload}>Report delivery (seller statement)</TransactionButton>}
      <details>
        <summary className="cursor-pointer text-sm text-auction-gold">Report a {collection ? "collection" : "delivery"} issue</summary>
        <label className="block text-sm">Describe the issue<textarea required maxLength={1000} value={reason} onChange={event => setReason(event.target.value)} className={inputStyle} /></label>
        <TransactionButton action="report_order" payload={{ order: order.id, reason }}>Submit issue report</TransactionButton>
        <p className="mt-2 text-xs text-auction-muted">Recorded for manual review. Refunds and payment disputes are handled separately.</p>
      </details>
    </section>
    {canCheckout && <OrderCheckout key={order.fulfilment_method ?? "new"} order={order} addresses={addresses} enabled={checkoutEnabled} />}
    <section className="premium-card rounded-lg p-5 lg:col-span-2">
      <h2 className="font-semibold">Order activity</h2>
      <ol className="mt-3 space-y-2 text-sm text-auction-muted">{events.map(event =>
        <li key={event.id}>{event.kind.replaceAll("_", " ")} · {orderTime(event.created_at)}</li>)}</ol>
    </section>
  </div>;
}
