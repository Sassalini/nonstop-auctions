import { CountdownTimer } from "@/components/CountdownTimer";
import { BidForm } from "@/components/BidForm";
import { formatCurrency, formatEstimate } from "@/lib/format";
import type { Lot } from "@/lib/auction-data";

type BidPanelProps = {
  lot: Lot;
};

export function BidPanel({ lot }: BidPanelProps) {
  return (
    <section className="rounded-lg border border-auction-gold/20 bg-auction-panel/90 p-4 shadow-glow">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 2xl:grid-cols-2">
        <div className="space-y-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-auction-muted">Current Bid</p>
            <p className="mt-2 text-3xl font-semibold text-auction-ivory">
              {formatCurrency(lot.currentBid)}
            </p>
            <p className="mt-2 text-sm text-auction-muted">
              Next estimate: {formatEstimate(lot.estimateLow, lot.estimateHigh)}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-4">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-auction-muted">
                Time Remaining
              </p>
              <div className="mt-2">
                <CountdownTimer initialSeconds={lot.countdownSeconds} />
              </div>
            </div>
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-auction-muted">Activity</p>
              <p className="mt-2 text-lg font-semibold text-auction-ivory">{lot.bidCount} bids</p>
              <p className="text-sm text-auction-muted">{lot.watchers} watching</p>
            </div>
          </div>
        </div>

        <div className="border-t border-white/10 pt-4 sm:border-l sm:border-t-0 sm:pl-4 lg:border-l-0 lg:border-t lg:pl-0 2xl:border-l 2xl:border-t-0 2xl:pl-4">
          <BidForm currentBid={lot.currentBid} minimumIncrement={lot.minimumIncrement} />
        </div>
      </div>
    </section>
  );
}
