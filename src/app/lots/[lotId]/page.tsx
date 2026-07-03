import { notFound } from "next/navigation";
import { AuctionDashboard } from "@/components/AuctionDashboard";
import { getLotAuctionData, getStaticLotParams } from "@/lib/auction-data";

export function generateStaticParams() {
  return getStaticLotParams();
}

export default async function LotPage({
  params,
}: {
  params: Promise<{ lotId: string }>;
}) {
  const { lotId } = await params;
  const auctionData = await getLotAuctionData(lotId);

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
