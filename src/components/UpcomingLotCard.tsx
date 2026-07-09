import Image from "next/image";
import Link from "next/link";
import { AuctionStatusBadge } from "@/components/AuctionStatusBadge";
import { CountdownTimer } from "@/components/CountdownTimer";
import { formatEstimate } from "@/lib/format";
import type { Lot } from "@/lib/auction-data";

type UpcomingLotCardProps = {
  lot: Lot;
};

export function UpcomingLotCard({ lot }: UpcomingLotCardProps) {
  return (
    <Link
      href={`/lots/${lot.id}`}
      className="grid grid-cols-[108px_minmax(0,1fr)] gap-3 rounded-lg border border-white/10 bg-black/50 p-2 transition hover:border-auction-gold/55 hover:bg-black/60"
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
          <AuctionStatusBadge status="upcoming" label="Next" />
        </div>
        <h3 className="mt-1 truncate text-sm text-auction-ivory">{lot.title}</h3>
        <p className="mt-1 text-xs text-auction-muted">
          Est. {formatEstimate(lot.estimateLow, lot.estimateHigh)}
        </p>
        <p className="mt-1 text-xs text-auction-muted">
          Starts in <CountdownTimer initialSeconds={lot.countdownSeconds} compact />
        </p>
      </div>
    </Link>
  );
}
