import { AuctionRoomCard } from "@/components/AuctionRoomCard";
import { getLotById, type AuctionRoom } from "@/lib/auction-data";

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
    <aside className={`bg-auction-ink p-4 lg:p-5 ${className}`}>
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
            liveLot={getLotById(room.liveLotId)}
            isActive={activeRoomId === room.id}
          />
        ))}
      </div>
    </aside>
  );
}
