import { AuctionRoomCard } from "@/components/AuctionRoomCard";
import type { AuctionRoom } from "@/lib/auction-data";

type AuctionRoomSidebarProps = {
  rooms: AuctionRoom[];
  activeRoomId: string;
  className?: string;
};

export function AuctionRoomSidebar({
  rooms,
  activeRoomId,
  className = "",
}: AuctionRoomSidebarProps) {
  return (
    <aside
      className={`border border-white/10 bg-black/[0.65] p-4 shadow-inner shadow-black/25 backdrop-blur-sm lg:p-5 ${className}`}
    >
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-[0.22em] text-auction-gold">
          Auction Rooms
        </h2>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
        {rooms.map((room) => (
          <AuctionRoomCard
            key={room.id}
            room={room}
            liveLot={room.liveLot}
            isActive={activeRoomId === room.id}
          />
        ))}
      </div>
    </aside>
  );
}
