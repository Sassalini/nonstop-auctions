"use client";

import { useState } from "react";
import { openSellerTestOnboarding } from "@/app/checkout-actions";
import { buttonStyle } from "./TransactionControls";

export function SellerOnboardingButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return <div className="space-y-2">
    <button className={buttonStyle} disabled={busy} onClick={async () => {
      setBusy(true);
      setError("");
      try {
        const result = await openSellerTestOnboarding();
        setError(result.error);
      } finally {
        setBusy(false);
      }
    }}>{busy ? "Opening Stripe…" : "Continue Stripe onboarding"}</button>
    {error && <p role="alert" className="text-sm text-auction-ember">{error}</p>}
  </div>;
}
