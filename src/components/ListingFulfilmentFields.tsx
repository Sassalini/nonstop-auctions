"use client";

import { useState } from "react";
import type { FulfilmentTerms } from "@/lib/transactions";

export function readListingFulfilment(form: FormData): FulfilmentTerms {
  const mode = form.get("fulfilmentMode");
  if (mode !== "delivery" && mode !== "collection" && mode !== "both") {
    throw new Error("Choose delivery, collection or both.");
  }
  const terms: FulfilmentTerms = { mode };
  if (mode !== "collection") {
    const price = String(form.get("postage") ?? "").trim().match(/^(\d{1,6})(?:\.(\d{1,2}))?$/);
    if (!price) throw new Error("Enter postage in pounds and pence, or 0 for free delivery.");
    terms.postage_minor = Number(price[1]) * 100 + Number((price[2] ?? "").padEnd(2, "0"));
    terms.postcode_areas = [...new Set(String(form.get("postcodeAreas") ?? "").toUpperCase().split(/[\s,]+/).filter(Boolean))];
    terms.service = String(form.get("dispatchService") ?? "").trim();
    terms.handling_days = Number(form.get("handlingDays"));
    terms.restrictions = String(form.get("deliveryRestrictions") ?? "").trim();
  }
  if (mode !== "delivery") terms.collection_area = String(form.get("collectionArea") ?? "").trim();
  return terms;
}

export function ListingFulfilmentFields({ terms, fieldClass }: { terms?: FulfilmentTerms | null; fieldClass: string }) {
  const [mode, setMode] = useState(terms?.mode ?? "");
  return <fieldset className="mt-5 min-w-0 space-y-3 rounded-lg border border-white/10 p-4">
    <legend className="px-1 font-semibold text-auction-ivory">Delivery and collection</legend>
    <p className="text-sm text-auction-muted">Buyers see these terms before bidding. Postage is fixed once the listing is published.</p>
    <label className="block space-y-2 text-sm">Fulfilment method
      <select required name="fulfilmentMode" value={mode} onChange={event => setMode(event.target.value)} className={`${fieldClass} h-11`}>
        <option value="">Choose a method</option>
        <option value="delivery">Delivery only</option>
        <option value="collection">Collection only</option>
        <option value="both">Delivery and collection</option>
      </select>
    </label>
    {(mode === "delivery" || mode === "both") && <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-2 text-sm">Postage (GBP)
        <input className={`${fieldClass} h-11`} required name="postage" inputMode="decimal" placeholder="0 for free delivery"
          defaultValue={terms?.postage_minor == null ? "" : (terms.postage_minor / 100).toFixed(2)} />
      </label>
      <label className="space-y-2 text-sm">Dispatch service
        <input className={`${fieldClass} h-11`} required name="dispatchService" maxLength={100} defaultValue={terms?.service} />
      </label>
      <label className="space-y-2 text-sm">Handling time (working days)
        <input className={`${fieldClass} h-11`} required name="handlingDays" type="number" min={1} max={99} defaultValue={terms?.handling_days} />
      </label>
      <label className="space-y-2 text-sm">UK postcode areas (optional)
        <input className={`${fieldClass} h-11`} name="postcodeAreas" maxLength={480}
          placeholder="All UK, or e.g. SW, EH, BT" defaultValue={terms?.postcode_areas?.join(", ")} />
      </label>
      <label className="space-y-2 text-sm sm:col-span-2">Delivery restrictions (optional)
        <textarea className={`${fieldClass} py-2`} name="deliveryRestrictions" maxLength={500}
          placeholder="For example, specialist courier or kerbside delivery for large items" defaultValue={terms?.restrictions} />
      </label>
    </div>}
    {(mode === "collection" || mode === "both") && <label className="block space-y-2 text-sm">Collection town or area
      <input className={`${fieldClass} h-11`} required name="collectionArea" maxLength={80} defaultValue={terms?.collection_area} />
      <span className="block text-xs text-auction-muted">This area is public. Share exact collection details privately once payment is confirmed.</span>
    </label>}
  </fieldset>;
}
