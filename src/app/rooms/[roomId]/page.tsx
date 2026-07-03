import { notFound } from "next/navigation";
import { AuctionDashboard } from "@/components/AuctionDashboard";
import { getRoomAuctionData } from "@/lib/auction-data";

export const dynamic = "force-dynamic";

export default async function RoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  const auctionData = await getRoomAuctionData(roomId);

  if (!auctionData) {
    notFound();
  }

  return (
    <AuctionDashboard
      rooms={auctionData.rooms}
      activeRoom={auctionData.activeRoom}
      currentLot={auctionData.currentLot}
      upcomingLots={auctionData.upcomingLots}
    />
  );
}
