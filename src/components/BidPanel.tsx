import { CountdownTimer } from "@/components/CountdownTimer";
import { BidForm } from "@/components/BidForm";
import { getLotTimerLabel, isTimedLifecycleStatus } from "@/lib/auction-lifecycle";
import { formatCurrency, formatEstimate } from "@/lib/format";
import type { Lot } from "@/lib/auction-data";

type BidPanelProps = {
  lot: Lot;
};

export function BidPanel({ lot }: BidPanelProps) {
  const timerLabel = getLotTimerLabel(lot.auctionStatus);
  const showTimer = isTimedLifecycleStatus(lot.auctionStatus);

  return (
    <section className="rounded-lg border border-auction-gold/25 bg-black/[0.72] p-4 shadow-glow backdrop-blur-sm">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.8fr)_minmax(14rem,1.05fr)] lg:grid-cols-1 xl:grid-cols-[minmax(7.125rem,0.8fr)_minmax(8.875rem,1fr)_minmax(8.75rem,1fr)]">
        <div className="min-w-0">
          <p className="whitespace-nowrap text-xs uppercase tracking-[0.18em] text-auction-muted">
            Current Bid
          </p>
          <p className="mt-2 text-2xl font-semibold text-auction-ivory sm:text-3xl xl:text-2xl 2xl:text-[1.7rem]">
            {formatCurrency(lot.currentBid)}
          </p>
          <p className="mt-2 text-sm leading-5 text-auction-muted">
            Next estimate: {formatEstimate(lot.estimateLow, lot.estimateHigh)}
          </p>
        </div>

        <div className="min-w-0 space-y-4 border-t border-white/10 pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <div className="min-w-[7.75rem]">
            <p className="whitespace-nowrap text-xs uppercase tracking-[0.18em] text-auction-muted">
              {showTimer ? timerLabel : "Status"}
            </p>
            <div className="mt-2">
              {showTimer ? (
                <CountdownTimer initialSeconds={lot.countdownSeconds} />
              ) : (
                <p className="text-sm font-semibold text-auction-ivory">{timerLabel}</p>
              )}
            </div>
          </div>
          <div>
            <p className="whitespace-nowrap text-xs uppercase tracking-[0.18em] text-auction-muted">
              Activity
            </p>
            <p className="mt-2 whitespace-nowrap text-lg font-semibold text-auction-ivory">
              {lot.bidCount} bids
            </p>
            <p className="whitespace-nowrap text-sm text-auction-muted">{lot.watchers} watching</p>
          </div>
        </div>

        <div className="min-w-0 border-t border-white/10 pt-4 md:border-l md:border-t-0 md:pl-4 md:pt-0 lg:border-l-0 lg:border-t lg:pl-0 lg:pt-4 xl:border-l xl:border-t-0 xl:pl-4 xl:pt-0">
          <BidForm
            lotId={lot.id}
            startingBid={lot.startingBid}
            currentBid={lot.currentBid}
            minimumIncrement={lot.minimumIncrement}
            auctionStatus={lot.auctionStatus}
          />
        </div>
      </div>
    </section>
  );
}
