"use client";

import { FormEvent, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Gavel } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LotStatus } from "@/lib/supabase/types";

type BidFormProps = {
  lotId: string;
  currentBid: number;
  minimumIncrement: number;
  auctionStatus?: LotStatus;
  endsAt?: string | null;
};

function parseBidAmount(value: string) {
  return Number(value.replace(/[£,\s]/g, ""));
}

function getBidErrorMessage(message: string, formattedMinimum: string) {
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("authentication")) {
    return "You need to log in to place a bid.";
  }

  if (normalizedMessage.includes("environment variables")) {
    return "Supabase is not configured yet, so real bids are disabled.";
  }

  if (normalizedMessage.includes("not open") || normalizedMessage.includes("not live")) {
    return "This auction is not live.";
  }

  if (normalizedMessage.includes("ended")) {
    return "This auction has ended.";
  }

  if (normalizedMessage.includes("at least") || normalizedMessage.includes("minimum")) {
    return `Bid is too low. Minimum bid is ${formattedMinimum}.`;
  }

  return message || "We could not place that bid. Please try again.";
}

export function BidForm({
  lotId,
  currentBid,
  minimumIncrement,
  auctionStatus,
  endsAt,
}: BidFormProps) {
  const router = useRouter();
  const minimumBid = currentBid + minimumIncrement;
  const [amount, setAmount] = useState(String(minimumBid));
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const formattedMinimum = useMemo(() => formatCurrency(minimumBid), [minimumBid]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsError(false);
    const numericAmount = parseBidAmount(amount);

    if (!Number.isFinite(numericAmount) || numericAmount < minimumBid) {
      setIsError(true);
      setMessage(`Bid is too low. Minimum bid is ${formattedMinimum}.`);
      return;
    }

    if (auctionStatus && !["LIVE", "EXTENDED"].includes(auctionStatus)) {
      setIsError(true);
      setMessage("This auction is not live.");
      return;
    }

    if (endsAt && Date.now() >= new Date(endsAt).getTime()) {
      setIsError(true);
      setMessage("This auction has ended.");
      return;
    }

    try {
      setIsSubmitting(true);
      const supabase = createSupabaseBrowserClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsError(true);
        setMessage("You need to log in to place a bid.");
        return;
      }

      const { error } = await supabase.rpc("place_bid", {
        lot_id: lotId,
        bid_amount: numericAmount,
      });

      if (error) {
        setIsError(true);
        setMessage(getBidErrorMessage(error.message, formattedMinimum));
        return;
      }

      setMessage(`Bid placed for ${formatCurrency(numericAmount)}.`);
      startTransition(() => {
        router.refresh();
      });
    } catch (error) {
      setIsError(true);
      setMessage(
        error instanceof Error
          ? getBidErrorMessage(error.message, formattedMinimum)
          : "We could not place that bid. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
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
        disabled={isSubmitting || isPending}
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-auction-gold px-4 text-sm font-semibold text-black transition hover:bg-auction-goldSoft"
      >
        <Gavel size={18} strokeWidth={1.9} />
        {isSubmitting || isPending ? "Placing Bid" : "Place Bid"}
      </button>
      <div className="flex min-h-5 items-center justify-between gap-3 text-xs text-auction-muted">
        <span>Minimum increment: {formatCurrency(minimumIncrement)}</span>
        {message ? (
          <span className={isError ? "text-auction-danger" : "text-auction-goldSoft"}>
            {message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
