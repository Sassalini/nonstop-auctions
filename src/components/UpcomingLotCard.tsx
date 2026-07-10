import Image from "next/image";
import Link from "next/link";
import { AuctionStatusBadge } from "@/components/AuctionStatusBadge";
import { CountdownTimer } from "@/components/CountdownTimer";
import {
  formatShortDateTime,
  getLotBadgeVariant,
  getLotCompactStatusLabel,
  getLotStatusLabel,
  getLotTimerLabel,
  isTimedLifecycleStatus,
} from "@/lib/auction-lifecycle";
import { formatEstimate } from "@/lib/format";
import type { Lot } from "@/lib/auction-data";

type UpcomingLotCardProps = {
  lot: Lot;
};

export function UpcomingLotCard({ lot }: UpcomingLotCardProps) {
  const statusLabel = getLotStatusLabel(lot.auctionStatus);
  const timerLabel = getLotTimerLabel(lot.auctionStatus);
  const showTimer = isTimedLifecycleStatus(lot.auctionStatus);
  const unavailableUntil =
    lot.auctionStatus === "UNSOLD" && lot.nextEligibleAt
      ? formatShortDateTime(lot.nextEligibleAt)
      : "";

  return (
    <Link
      href={`/lots/${lot.id}`}
      className="grid grid-cols-[108px_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-black/[0.7] p-2 transition hover:border-auction-gold/55 hover:bg-black/[0.75]"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-md border border-white/10 bg-black">
        <Image
          src={lot.thumbnailUrl}
          alt={lot.title}
          fill
          sizes="108px"
          className="h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0 py-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-auction-ivory">Lot {lot.lotNumber}</p>
          <AuctionStatusBadge
            status={getLotBadgeVariant(lot.auctionStatus)}
            label={getLotCompactStatusLabel(lot.auctionStatus)}
          />
        </div>
        <h3 className="mt-1 truncate text-sm text-auction-ivory">{lot.title}</h3>
        <p className="mt-1 text-xs text-auction-muted">
          Est. {formatEstimate(lot.estimateLow, lot.estimateHigh)}
        </p>
        {unavailableUntil ? (
          <p className="mt-1 text-xs text-auction-muted">Unavailable until {unavailableUntil}</p>
        ) : showTimer ? (
          <p className="mt-1 text-xs text-auction-muted">
            {timerLabel} <CountdownTimer initialSeconds={lot.countdownSeconds} compact />
          </p>
        ) : (
          <p className="mt-1 text-xs text-auction-muted">{statusLabel}</p>
        )}
      </div>
    </Link>
  );
}
