import { FullCatalogue } from "@/components/FullCatalogue";
import { UpcomingLotCard } from "@/components/UpcomingLotCard";
import { AutoPlayToggle } from "@/components/AutoPlayToggle";
import type { AuctionRoom, Lot } from "@/lib/auction-data";

type UpcomingLotsSidebarProps = {
  room: AuctionRoom | null;
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
          <p className="mt-0.5 truncate text-xs text-auction-muted">{room?.name ?? "Live auctions"}</p>
        </div>
        <AutoPlayToggle />
      </div>

      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-1">
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

      {room ? <FullCatalogue key={room.id} roomSlug={room.slug} roomName={room.name} revision={lots} /> : null}
    </aside>
  );
}
