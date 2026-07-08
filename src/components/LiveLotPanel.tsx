import Link from "next/link";
import { ChevronRight, Eye, Heart } from "lucide-react";
import { AuctionStatusBadge } from "@/components/AuctionStatusBadge";
import { BidPanel } from "@/components/BidPanel";
import { LotImageGallery } from "@/components/LotImageGallery";
import { LotTabs } from "@/components/LotTabs";
import type { AuctionRoom, Lot } from "@/lib/auction-data";

type LiveLotPanelProps = {
  room: AuctionRoom;
  lot: Lot;
};

export function LiveLotPanel({ room, lot }: LiveLotPanelProps) {
  return (
    <section className="min-w-0 bg-auction-black/90 p-4 backdrop-blur-sm lg:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2 text-sm text-auction-muted">
          <Link href={`/rooms/${room.id}`} className="truncate hover:text-auction-gold">
            {room.name}
          </Link>
          <ChevronRight size={15} strokeWidth={1.8} />
          <span className="truncate text-auction-ivory">{room.category}</span>
        </div>
        <div className="flex items-center gap-2">
          <AuctionStatusBadge status="live" />
          <span className="flex h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-xs text-auction-ivory">
            <Eye size={15} strokeWidth={1.8} />
            {lot.watchers}
          </span>
        </div>
      </div>

      <LotImageGallery lot={lot} />

      <div className="mt-3 grid gap-3 xl:grid-cols-[minmax(0,1fr)_460px]">
        <section className="rounded-lg border border-white/10 bg-auction-panel/85 p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm text-auction-muted">Lot {lot.lotNumber}</p>
              <h1 className="mt-1 text-2xl font-semibold text-auction-ivory sm:text-3xl">
                {lot.title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-auction-muted">
                {lot.details.join(" | ")}
              </p>
              <p className="mt-1 text-sm text-auction-muted">{lot.maker}</p>
            </div>
            <button
              type="button"
              className="flex h-10 shrink-0 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-auction-ivory transition hover:border-auction-gold/60 hover:text-auction-gold"
            >
              <Heart size={17} strokeWidth={1.8} />
              Watch
            </button>
          </div>
        </section>

        <BidPanel lot={lot} />
      </div>

      <div className="mt-3">
        <LotTabs lot={lot} />
      </div>
    </section>
  );
}
