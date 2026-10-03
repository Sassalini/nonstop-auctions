import { AuctionLiveSync } from "@/components/AuctionLiveSync";
import { AuctionRoomSidebar } from "@/components/AuctionRoomSidebar";
import { LiveLotPanel } from "@/components/LiveLotPanel";
import { UpcomingLotsSidebar } from "@/components/UpcomingLotsSidebar";
import type { AuctionRoom, Lot } from "@/lib/auction-data";
import { EmptyAuctionRoom } from "@/components/EmptyAuctionRoom";
import { AuctionClockProvider } from "@/components/AuctionClockProvider";

type AuctionDashboardProps = {
  rooms: AuctionRoom[];
  activeRoom: AuctionRoom | null;
  currentLot: Lot | null;
  upcomingLots: Lot[];
};

export function AuctionDashboard({
  rooms,
  activeRoom,
  currentLot,
  upcomingLots,
}: AuctionDashboardProps) {
  return (
    <AuctionClockProvider databaseRoomId={activeRoom?.databaseId}>
      {activeRoom && !activeRoom.databaseId ? <p className="border-b border-auction-gold/20 bg-auction-black px-4 py-2 text-center text-xs text-auction-gold">Demonstration catalogue · Real bidding is unavailable</p> : null}
      <AuctionLiveSync
        databaseRoomId={activeRoom?.databaseId}
        lotId={currentLot?.id ?? ""}
        status={currentLot?.auctionStatus ?? "WAITING"}
        countdownSeconds={currentLot?.countdownSeconds ?? 0}
        endsAt={currentLot?.endsAt}
      />
      <main className="mx-auto grid max-w-[1880px] grid-cols-1 gap-px bg-auction-line/45 lg:grid-cols-[280px_minmax(0,1fr)_320px] 2xl:grid-cols-[320px_minmax(0,1fr)_380px]">
        <div className="order-1 min-w-0 lg:order-2">
          {activeRoom && currentLot ? (
            <LiveLotPanel room={activeRoom} lot={currentLot} />
          ) : (
            <EmptyAuctionRoom room={activeRoom} lots={upcomingLots} />
          )}
        </div>
        <UpcomingLotsSidebar
          room={activeRoom}
          lots={upcomingLots}
          className="order-2 lg:order-3"
        />
        <AuctionRoomSidebar
          rooms={rooms}
          activeRoomId={activeRoom?.id ?? ""}
          className="order-3 lg:order-1"
        />
      </main>
    </AuctionClockProvider>
  );
}
