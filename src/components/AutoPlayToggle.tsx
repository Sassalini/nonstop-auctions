"use client";
import { useAuctionViewing } from "@/components/AuctionViewingProvider";

export function AutoPlayToggle() {
  const { enabled, ready, setEnabled } = useAuctionViewing();
  return <button type="button" role="switch" aria-label="Auto-play" aria-checked={enabled} disabled={!ready}
    onClick={() => setEnabled(!enabled)}
    className="flex min-h-11 shrink-0 items-center gap-2 rounded-sm text-xs text-auction-muted outline-none focus-visible:ring-2 focus-visible:ring-auction-gold focus-visible:ring-offset-2 focus-visible:ring-offset-auction-black disabled:opacity-50">
    <span>Auto-play <span className={enabled ? "text-auction-gold" : "text-auction-muted"}>{enabled ? "On" : "Off"}</span></span>
    <span aria-hidden="true" className={`relative h-6 w-11 rounded-full border transition-colors ${enabled ? "border-auction-gold/60 bg-auction-gold/60" : "border-white/20 bg-white/10"}`}>
      <span className={`absolute left-1 top-1 size-4 rounded-full transition-transform duration-200 motion-reduce:transition-none ${enabled ? "translate-x-5 bg-auction-ivory" : "translate-x-0 bg-auction-muted"}`} />
    </span>
  </button>;
}
