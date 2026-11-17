"use client";

import { useState } from "react";
import { openSellerTestOnboarding } from "@/app/checkout-actions";
import { buttonStyle } from "./TransactionControls";

export function SellerOnboardingButton({ initial = false }: { initial?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="space-y-2">
    <button className={buttonStyle} disabled={busy} onClick={async () => {
      setBusy(true);
      setError("");
      try {
        const result = await openSellerTestOnboarding();
        setError(result.error);
      } catch {
        setError("Could not open Stripe onboarding. Please try again; your existing setup will be reused.");
      } finally {
        setBusy(false);
      }
    }}>{busy ? "Opening Stripe…" : initial ? "Set Up Seller Payments" : "Continue Stripe onboarding"}</button>
    {error && <p role="alert" className="text-sm text-auction-ember">{error}</p>}
  </div>;
}
