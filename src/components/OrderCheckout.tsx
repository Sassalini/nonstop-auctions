"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { startTestCheckout } from "@/app/checkout-actions";
import { formatCurrency } from "@/lib/format";
import { eligibleDeliveryAddress, type DeliveryAddress, type FulfilmentMethod, type FulfilmentOrder } from "@/lib/transactions";
import { buttonStyle, inputStyle } from "./TransactionControls";

export function OrderCheckout({ order, addresses, enabled }: {
  order: FulfilmentOrder; addresses: DeliveryAddress[]; enabled: boolean;
}) {
  const router = useRouter();
  const terms = order.terms_snapshot;
  const locked = Boolean(order.fulfilment_method);
  const [method, setMethod] = useState<FulfilmentMethod>(order.fulfilment_method ?? (terms?.mode === "collection" ? "collection" : "delivery"));
  const eligible = terms ? addresses.filter(item => eligibleDeliveryAddress(item.details, terms)) : [];
  const [address, setAddress] = useState(eligible.find(item => item.is_default)?.id ?? eligible[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!terms || order.winning_minor == null) return null;

  const postage = order.postage_minor ?? (method === "delivery" ? terms.postage_minor ?? 0 : 0);
  const total = order.winning_minor + postage;
  const validTotal = total >= 30 && total <= 99999999;
  return <section className="premium-card min-w-0 space-y-4 rounded-lg p-5 lg:col-span-2" id="checkout">
    <h2 className="text-lg font-semibold">Checkout</h2>
    <form className="space-y-4" onSubmit={async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      setBusy(true);
      setError("");
      try {
        const result = await startTestCheckout(form);
        setError(result.error);
        router.refresh();
      } finally {
        setBusy(false);
      }
    }}>
      <input type="hidden" name="lot" value={order.lot_id} />
      {!locked && terms.mode === "both" ? <label className="block max-w-sm text-sm">Fulfilment method
        <select className={inputStyle} name="method" value={method} onChange={event => setMethod(event.target.value as FulfilmentMethod)}>
          <option value="delivery">Delivery</option><option value="collection">Free collection</option>
        </select>
      </label> : <><input type="hidden" name="method" value={method} />
        <p className="text-sm">{method === "delivery" ? "Delivery" : "Free collection"}</p></>}
      {method === "delivery" && !locked && <div className="space-y-2">
        <label className="block max-w-sm text-sm">Saved delivery address
          <select name="address" required className={inputStyle} value={address} onChange={event => setAddress(event.target.value)}>
            <option value="">Choose an address</option>
            {addresses.map(item => {
              const allowed = eligibleDeliveryAddress(item.details, terms);
              return <option key={item.id} value={item.id} disabled={!allowed}>
                {item.details.recipient} · {item.details.line1} · {item.details.postcode}{allowed ? "" : " · Outside delivery area"}
              </option>;
            })}
          </select>
        </label>
        <Link prefetch={false} className="inline-block text-sm text-auction-gold underline" href={`/account/addresses?order=${order.lot_id}`}>Add or manage a delivery address</Link>
        <p className="text-sm text-auction-muted">The seller receives the order address after payment is confirmed.</p>
      </div>}
      {locked && <p className="text-sm text-auction-muted">The method and address are fixed for this checkout attempt. An expired session must be confirmed before starting another.</p>}
      <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-2 text-sm">
        <dt>Winning bid</dt><dd>{formatCurrency(order.winning_minor / 100)}</dd>
        <dt>{method === "collection" ? "Collection" : "Postage"}</dt><dd>{postage === 0 ? "Free" : formatCurrency(postage / 100)}</dd>
        <dt className="font-semibold">Total payable</dt><dd className="font-semibold">{formatCurrency(total / 100)}</dd>
      </dl>
      <button disabled={!enabled || !validTotal || busy || (!locked && method === "delivery" && !eligible.some(item => item.id === address))} className={buttonStyle}>
        {busy ? "Opening checkout…" : locked ? "Resume checkout" : "Pay now"}
      </button>
      {!enabled && <p className="text-sm text-auction-muted">Online payments are currently unavailable.</p>}
      {enabled && <p className="text-sm text-auction-muted">Stripe test mode. Use a test card.</p>}
      {!validTotal && <p className="text-sm text-auction-muted">This total is outside the supported card payment range.</p>}
      {error && <p role="alert" className="text-sm text-auction-ember">{error}</p>}
    </form>
  </section>;
}
