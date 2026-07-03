import { AuctionDashboard } from "@/components/AuctionDashboard";
import { getHomeAuctionData } from "@/lib/auction-data";

export const dynamic = "force-dynamic";

export default async function Home() {
  const auctionData = await getHomeAuctionData();

  return (
    <AuctionDashboard
      rooms={auctionData.rooms}
      activeRoom={auctionData.activeRoom}
      currentLot={auctionData.currentLot}
      upcomingLots={auctionData.upcomingLots}
    />
  );
}
