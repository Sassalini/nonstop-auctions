"use client";

import { FormEvent, useMemo, useState } from "react";
import { Gavel } from "lucide-react";
import { formatCurrency } from "@/lib/format";

type BidFormProps = {
  currentBid: number;
  minimumIncrement: number;
};

export function BidForm({ currentBid, minimumIncrement }: BidFormProps) {
  const minimumBid = currentBid + minimumIncrement;
  const [amount, setAmount] = useState(String(minimumBid));
  const [message, setMessage] = useState("");

  const formattedMinimum = useMemo(() => formatCurrency(minimumBid), [minimumBid]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const numericAmount = Number(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < minimumBid) {
      setMessage(`Minimum bid is ${formattedMinimum}`);
      return;
    }

    setMessage(`Bid queued for ${formatCurrency(numericAmount)}`);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <label htmlFor="bid-amount" className="text-sm font-medium text-auction-ivory">
        Place Your Bid
      </label>
      <div className="flex overflow-hidden rounded-md border border-white/10 bg-black/40 transition focus-within:border-auction-gold/70">
        <input
          id="bid-amount"
          inputMode="numeric"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          className="min-w-0 flex-1 bg-transparent px-3 py-3 text-sm text-auction-ivory outline-none placeholder:text-auction-muted"
          placeholder="Enter amount"
        />
        <span className="flex items-center border-l border-white/10 px-3 text-xs font-semibold text-auction-ivory">
          GBP
        </span>
      </div>
      <button
        type="submit"
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-auction-gold px-4 text-sm font-semibold text-black transition hover:bg-auction-goldSoft"
      >
        <Gavel size={18} strokeWidth={1.9} />
        Place Bid
      </button>
      <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-auction-muted">
        <span>Minimum increment: {formatCurrency(minimumIncrement)}</span>
        {message ? <span className="text-auction-goldSoft">{message}</span> : null}
      </div>
    </form>
  );
}
