"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuctionViewing } from "@/components/AuctionViewingProvider";
import { getAuctionViewingTarget } from "@/lib/auction-viewing";
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
  roomCurrentLot: Lot | null;
  upcomingLots: Lot[];
};

export function AuctionDashboard({
  rooms,
  activeRoom,
  currentLot,
  roomCurrentLot,
  upcomingLots,
}: AuctionDashboardProps) {
  const { enabled, ready } = useAuctionViewing();
  const pathname = usePathname();
  const router = useRouter();
  const pin = useRef<{ path: string; roomId: string | undefined; lotId: string } | null>(null);
  useEffect(() => {
    if (!ready) return;
    const isLotRoute = pathname.startsWith("/lots/");
    if (enabled || isLotRoute) pin.current = null;
    else if (currentLot && (!pin.current || pin.current.path !== pathname || pin.current.roomId !== activeRoom?.id)) {
      // Keep the original pin if a Realtime refresh arrives while the lot URL
      // navigation is still pending; it must not redirect OFF to the next lot.
      pin.current = { path: pathname, roomId: activeRoom?.id, lotId: currentLot.id };
    }
    const target = getAuctionViewingTarget({ ready, enabled, displayedLotId: pin.current?.lotId ?? currentLot?.id,
      roomCurrentLotId: roomCurrentLot?.id, isLotRoute });
    if (target && target !== pathname) router.replace(target, { scroll: false });
  }, [ready, enabled, currentLot, roomCurrentLot?.id, activeRoom?.id, pathname, router]);
  const completed = currentLot && ["SOLD", "UNSOLD", "CANCELLED"].includes(currentLot.auctionStatus);
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
          {completed ? <div className="flex flex-wrap items-center justify-between gap-3 border border-auction-gold/25 bg-black/[0.65] px-4 py-3 text-sm text-auction-muted">
            <p>{enabled ? "Waiting for the next lot in this room." : "Auto-play is off. You are viewing this lot's final result."}</p>
            {roomCurrentLot && roomCurrentLot.id !== currentLot.id ? <Link href={`/lots/${roomCurrentLot.id}`} prefetch={false} className="flex min-h-11 items-center rounded-md border border-auction-gold/60 px-3 text-sm text-auction-gold hover:bg-auction-gold hover:text-black">View Current Live Lot</Link> : null}
          </div> : null}
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
