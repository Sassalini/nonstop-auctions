import { AuctionRoomSidebar } from "@/components/AuctionRoomSidebar";
import { LiveLotPanel } from "@/components/LiveLotPanel";
import { UpcomingLotsSidebar } from "@/components/UpcomingLotsSidebar";
import type { AuctionRoom, Lot } from "@/lib/auction-data";

type AuctionDashboardProps = {
  rooms: AuctionRoom[];
  activeRoom: AuctionRoom;
  currentLot: Lot;
  upcomingLots: Lot[];
};

export function AuctionDashboard({
  rooms,
  activeRoom,
  currentLot,
  upcomingLots,
}: AuctionDashboardProps) {
  return (
    <main className="mx-auto grid max-w-[1880px] grid-cols-1 gap-px bg-auction-line/70 lg:grid-cols-[280px_minmax(0,1fr)_320px] 2xl:grid-cols-[320px_minmax(0,1fr)_380px]">
      <div className="order-1 min-w-0 lg:order-2">
        <LiveLotPanel room={activeRoom} lot={currentLot} />
      </div>
      <UpcomingLotsSidebar lots={upcomingLots} className="order-2 lg:order-3" />
      <AuctionRoomSidebar
        rooms={rooms}
        activeRoomId={activeRoom.id}
        className="order-3 lg:order-1"
      />
    </main>
  );
}
