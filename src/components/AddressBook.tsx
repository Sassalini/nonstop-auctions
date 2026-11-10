"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { AddressDetails, DeliveryAddress } from "@/lib/transactions";
import { transactionAction } from "@/app/transaction-actions";
import { inputStyle, buttonStyle, TransactionButton } from "./TransactionControls";

const empty: AddressDetails = { recipient: "", line1: "", line2: "", city: "", region: "", postcode: "", country: "", instructions: "" };
const fields: [keyof AddressDetails, string, boolean, string][] = [
  ["recipient", "Full recipient name", true, "shipping name"],
  ["line1", "Address line 1", true, "shipping address-line1"],
  ["line2", "Address line 2", false, "shipping address-line2"],
  ["city", "Town / city", true, "shipping address-level2"],
  ["region", "County / region", false, "shipping address-level1"],
  ["postcode", "Postcode", true, "shipping postal-code"],
  ["country", "Country", true, "shipping country-name"],
  ["instructions", "Delivery instructions", false, "off"],
];

export function AddressBook({ addresses }: { addresses: DeliveryAddress[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<DeliveryAddress | null>(null);
  const [details, setDetails] = useState(empty);
  const [isDefault, setDefault] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  function resetForm() {
    setEditing(null); setDetails(empty); setDefault(false); setError("");
  }

  return (
    <div className="grid items-start gap-6 lg:grid-cols-2">
      <div className="min-w-0 space-y-4">
        {addresses.map(address => (
          <article key={address.id} aria-label={`Address for ${address.details.recipient}`} className="premium-card break-words rounded-lg p-5">
            <h2 className="font-semibold">{address.details.recipient}{address.is_default ? " · Default" : ""}</h2>
            <p className="mt-2 whitespace-pre-line text-sm text-auction-muted">{[address.details.line1, address.details.line2, address.details.city, address.details.region, address.details.postcode, address.details.country].filter(Boolean).join("\n")}</p>
            {address.details.instructions ? <p className="mt-2 whitespace-pre-line text-sm text-auction-muted">Delivery instructions: {address.details.instructions}</p> : null}
            <div className="mt-4 flex flex-wrap gap-3">
              <button type="button" className={buttonStyle} disabled={busy} onClick={() => {
                setEditing(address); setDetails(address.details); setDefault(address.is_default); setError(""); setStatus("");
              }}>Edit</button>
              {!address.is_default ? <TransactionButton action="save_address" payload={{ id: address.id, details: address.details, default: true }}>Set default</TransactionButton> : null}
              <TransactionButton action="delete_address" payload={{ id: address.id }}>Delete saved address</TransactionButton>
            </div>
          </article>
        ))}
        {!addresses.length ? <p className="text-sm text-auction-muted">No saved addresses yet. Add your first delivery address.</p> : null}
      </div>
      <form id="add-address" className="premium-card min-w-0 rounded-lg p-5" onSubmit={async event => {
        event.preventDefault();
        setBusy(true); setError(""); setStatus("");
        try {
          const result = await transactionAction("save_address", { id: editing?.id ?? null, details, default: isDefault });
          if (result.error) setError(result.error);
          else { resetForm(); setStatus("Delivery address saved."); router.refresh(); }
        } catch {
          setError("Could not save your address. Please try again.");
        } finally {
          setBusy(false);
        }
      }}>
        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <legend className="mb-4 font-semibold">{editing ? "Edit address" : "Add an address"}</legend>
          {fields.map(([key, label, required, autoComplete]) => (
            <label key={key} className="block text-sm">
              {label}{required ? " *" : " (optional)"}
              <input name={key} autoComplete={autoComplete} className={`${inputStyle} mt-1`} required={required} maxLength={key === "instructions" ? 500 : key === "postcode" ? 30 : key === "recipient" ? 150 : key === "line1" ? 200 : 100} value={details[key]} onChange={event => setDetails({ ...details, [key]: event.target.value })} />
            </label>
          ))}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={isDefault} onChange={event => setDefault(event.target.checked)} />Default delivery address</label>
          <div className="flex flex-wrap gap-3">
            <button type="submit" className={buttonStyle}>{busy ? "Saving address…" : "Save address"}</button>
            {editing ? <button type="button" className={buttonStyle} onClick={() => { resetForm(); setStatus(""); }}>Cancel edit</button> : null}
          </div>
        </fieldset>
        {error ? <p role="alert" className="mt-4 text-sm text-red-300">{error}</p> : null}
        {status ? <p role="status" className="mt-4 text-sm text-auction-gold">{status}</p> : null}
      </form>
    </div>
  );
}
