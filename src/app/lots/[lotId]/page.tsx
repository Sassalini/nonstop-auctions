import { TransactionButton } from "@/components/TransactionControls";
import { notFound } from "next/navigation";
import { AuctionDashboard } from "@/components/AuctionDashboard";
import { getLotAuctionData } from "@/lib/auction-data";

export const dynamic = "force-dynamic";

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
    <><AuctionDashboard
      rooms={auctionData.rooms}
      activeRoom={auctionData.activeRoom}
      currentLot={auctionData.currentLot}
      roomCurrentLot={auctionData.roomCurrentLot}
      upcomingLots={auctionData.upcomingLots}
    /><div className="mx-auto max-w-7xl px-4 pb-6"><TransactionButton action="conversation" payload={{lot:lotId}}>Contact seller</TransactionButton></div></>
  );
}

