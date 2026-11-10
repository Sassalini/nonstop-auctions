"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type ReactNode } from "react";
import { startTestCheckout } from "@/app/checkout-actions";
import { formatCurrency } from "@/lib/format";
import { eligibleDeliveryAddress, isUuid, type DeliveryAddress, type FulfilmentMethod, type FulfilmentOrder } from "@/lib/transactions";
import { buttonStyle, inputStyle } from "./TransactionControls";

const formId = "order-checkout-form";

export function OrderCheckout({ order, addresses, unavailable, processing, children }: {
  order: FulfilmentOrder; addresses: DeliveryAddress[]; unavailable: string | null; processing: boolean;
  children: (paymentPrompt: ReactNode) => ReactNode;
}) {
  const router = useRouter();
  const terms = order.terms_snapshot;
  const locked = Boolean(order.fulfilment_method);
  const [method, setMethod] = useState<FulfilmentMethod>(order.fulfilment_method ?? (terms?.mode === "collection" ? "collection" : "delivery"));
  const eligible = terms ? addresses.filter(item => eligibleDeliveryAddress(item.details, terms)) : [];
  const [address, setAddress] = useState(eligible.find(item => item.is_default)?.id ?? eligible[0]?.id ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  if (!terms || order.winning_minor == null) return children(null);

  const postage = order.postage_minor ?? (method === "delivery" ? terms.postage_minor ?? 0 : 0);
  const total = order.winning_minor + postage;
  const validTotal = total >= 30 && total <= 99999999;
  const needsAddress = !locked && method === "delivery" && !eligible.some(item => isUuid(item.id) && item.id === address);
  const requirement = unavailable ?? (!validTotal ? "This total is outside the supported card payment range." :
    needsAddress ? "Please select a delivery address" : null);
  const label = busy ? "Opening Stripe Checkout…" : locked ?
    (order.payment_state === "FAILED" ? "Retry payment" : "Resume checkout") : "Pay Now with Stripe";
  const action = (className: string) => !unavailable && !processing && <button type="submit" form={formId}
    disabled={busy || !validTotal || needsAddress} aria-describedby="checkout-requirement" className={className}>{label}</button>;
  return <>
    <section className="premium-card min-w-0 space-y-4 rounded-lg border-auction-gold/40 p-5 lg:col-span-2" id="checkout">
      <h2 className="text-lg font-semibold">Pay for your auction win</h2>
      <form id={formId} className="grid gap-5 lg:grid-cols-2" onSubmit={async event => {
        event.preventDefault();
        if (submitting.current || requirement || processing) return;
        const form = new FormData(event.currentTarget);
        submitting.current = true;
        setBusy(true);
        setError("");
        try {
          const result = await startTestCheckout(form);
          if (result?.error) {
            setError(result.error);
            router.refresh();
          }
        } finally {
          submitting.current = false;
          setBusy(false);
        }
      }}>
        <input type="hidden" name="lot" value={order.lot_id} />
        <div className="min-w-0 space-y-3">
          <dl className="grid max-w-sm grid-cols-[1fr_auto] gap-2 text-sm">
            <dt>Winning bid</dt><dd>{formatCurrency(order.winning_minor / 100)}</dd>
            <dt>{method === "collection" ? "Collection" : "Delivery charge"}</dt><dd>{postage === 0 ? "Free" : formatCurrency(postage / 100)}</dd>
            <dt className="font-semibold">Total payable</dt><dd className="font-semibold">{formatCurrency(total / 100)}</dd>
          </dl>
          {action("min-h-11 w-full rounded bg-auction-gold px-5 py-3 font-semibold text-black hover:brightness-110 focus-visible:outline-auction-ivory disabled:opacity-50 sm:w-auto")}
          <p id="checkout-requirement" className="text-sm text-auction-muted">{requirement ?? "Stripe test mode. Use a test card."}</p>
          {error && <p id="checkout-error" role="alert" className="text-sm text-auction-ember">{error}</p>}
        </div>
        <fieldset disabled={busy || processing} className="min-w-0 space-y-3">
          {!locked && terms.mode === "both" ? <label className="block max-w-sm text-sm">Fulfilment method
            <select className={inputStyle} name="method" value={method} onChange={event => setMethod(event.target.value as FulfilmentMethod)}>
              <option value="delivery">Delivery</option><option value="collection">Free collection</option>
            </select>
          </label> : <>
            <input type="hidden" name="method" value={method} />
            <p className="text-sm">{method === "delivery" ? "Delivery" : "Free collection"}</p>
          </>}
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
            <Link prefetch={false} className="inline-block text-sm text-auction-gold underline" href={`/account/addresses?order=${order.lot_id}#add-address`}>Add New Address</Link>
            <p className="text-sm text-auction-muted">Paying confirms this delivery address. The seller receives it after payment is verified.</p>
          </div>}
          {locked && !processing && <p className="text-sm text-auction-muted">Resume the same checkout with the method and address already selected. If it expired, we’ll verify that before you can start again.</p>}
        </fieldset>
      </form>
    </section>
    {children(!processing && <div className="space-y-2 border-t border-white/10 pt-4">
      <p className="text-sm text-auction-muted">{requirement ?? (locked ? "Resume your existing Stripe checkout." : "Pay securely with Stripe to start fulfilment.")}</p>
      {action(buttonStyle)}
      {error && <a className="block text-sm text-auction-gold underline" href="#checkout-error">View the checkout message</a>}
    </div>)}
  </>;
}
