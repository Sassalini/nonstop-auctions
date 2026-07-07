import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { AuctionStatusBadge } from "@/components/AuctionStatusBadge";
import { formatCurrency } from "@/lib/format";
import type { AuctionRoom, Lot } from "@/lib/auction-data";

type AuctionRoomCardProps = {
  room: AuctionRoom;
  liveLot?: Lot;
  isActive?: boolean;
};

export function AuctionRoomCard({
  room,
  liveLot,
  isActive = false,
}: AuctionRoomCardProps) {
  return (
    <Link
      href={`/rooms/${room.id}`}
      className={`group relative min-h-[150px] overflow-hidden rounded-lg border p-4 transition ${
        isActive
          ? "border-auction-gold/70 shadow-glow"
          : "border-white/10 hover:border-auction-gold/45"
      }`}
    >
      <Image
        src={room.imageUrl}
        alt=""
        fill
        sizes="(max-width: 1024px) 50vw, 300px"
        className="absolute inset-0 h-full w-full object-cover opacity-65 brightness-105 saturate-110 transition duration-700 group-hover:scale-105 group-hover:opacity-75 group-hover:brightness-110"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-black/25" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/5 via-transparent to-black/65" />
      <div className="relative flex h-full min-h-[118px] flex-col justify-between">
        <div>
          <h3 className="font-serif text-xl text-auction-ivory">{room.name}</h3>
          <p className="mt-2 text-xs leading-5 text-auction-muted">{room.strapline}</p>
        </div>

        <div className="mt-5 flex items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="relative size-14 shrink-0 overflow-hidden rounded-md border border-white/10 bg-black/50">
              {liveLot ? (
                <Image
                  src={liveLot.thumbnailUrl}
                  alt=""
                  fill
                  sizes="56px"
                  className="h-full w-full object-cover"
                />
              ) : null}
              <span className="absolute left-1 top-1 scale-[0.72] origin-top-left">
                <AuctionStatusBadge status="live" label="Live" />
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm text-auction-ivory">
                Lot {liveLot?.lotNumber ?? room.liveLotId}
              </p>
              <p className="text-sm font-semibold text-auction-ivory">
                {formatCurrency(room.currentBid)}
              </p>
              <p className="text-xs text-auction-muted">{room.bidCount} bids</p>
            </div>
          </div>

          <span className="flex size-9 shrink-0 items-center justify-center rounded-full border border-auction-gold/55 text-auction-gold transition group-hover:bg-auction-gold group-hover:text-black">
            <ArrowRight size={18} strokeWidth={1.8} />
          </span>
        </div>
      </div>
    </Link>
  );
}
