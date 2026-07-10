import Link from "next/link";
import { ListFilter } from "lucide-react";
import { UpcomingLotCard } from "@/components/UpcomingLotCard";
import type { AuctionRoom, Lot } from "@/lib/auction-data";

type UpcomingLotsSidebarProps = {
  room: AuctionRoom;
  lots: Lot[];
  className?: string;
};

export function UpcomingLotsSidebar({
  room,
  lots,
  className = "",
}: UpcomingLotsSidebarProps) {
  return (
    <aside
      className={`border border-white/10 bg-black/[0.65] p-4 shadow-inner shadow-black/25 backdrop-blur-sm lg:p-5 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-auction-ivory">Up Next</h2>
          <p className="mt-0.5 truncate text-xs text-auction-muted">{room.name}</p>
        </div>
        <button
          type="button"
          aria-pressed="true"
          className="flex items-center gap-2 text-xs text-auction-muted"
        >
          Auto-play
          <span className="relative h-6 w-11 rounded-full border border-auction-gold/30 bg-auction-gold/25">
            <span className="absolute right-1 top-1 size-4 rounded-full bg-auction-ivory" />
          </span>
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
        {lots.length ? (
          lots.map((lot) => <UpcomingLotCard key={lot.id} lot={lot} />)
        ) : (
          <div className="rounded-lg border border-white/10 bg-black/[0.7] px-4 py-8 text-center">
            <p className="text-sm font-semibold text-auction-ivory">No upcoming lots</p>
            <p className="mt-1 text-xs leading-5 text-auction-muted">
              New lots for this room will appear here.
            </p>
          </div>
        )}
      </div>

      <Link
        href={`/rooms/${room.id}`}
        className="mt-4 flex h-11 items-center justify-center gap-2 rounded-md border border-auction-gold/60 text-sm font-semibold text-auction-gold transition hover:bg-auction-gold hover:text-black"
      >
        <ListFilter size={18} strokeWidth={1.8} />
        View Full Catalogue
      </Link>
    </aside>
  );
}
