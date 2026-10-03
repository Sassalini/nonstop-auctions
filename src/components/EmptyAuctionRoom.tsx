import { Gavel } from "lucide-react";
import { formatShortDateTime } from "@/lib/auction-lifecycle";
import type { AuctionRoom, Lot } from "@/lib/auction-data";

export function EmptyAuctionRoom({ room, lots }: { room: AuctionRoom | null; lots: Lot[] }) {
  const nextReturn = lots.map((lot) => lot.nextEligibleAt).filter((value): value is string => Boolean(value)).sort()[0];
  return (
    <section className="flex min-h-[480px] min-w-0 flex-col items-center justify-center border border-white/10 bg-black/[0.62] p-6 text-center backdrop-blur-sm">
      <Gavel size={36} className="text-auction-gold" aria-hidden="true" />
      <p className="mt-5 text-xs uppercase tracking-[0.18em] text-auction-gold">{room?.name ?? "Non-Stop Auctions"}</p>
      <h1 className="mt-3 text-2xl font-semibold text-auction-ivory">{room ? "No eligible lots right now" : "Auction rooms opening soon"}</h1>
      <p className="mt-3 max-w-sm text-sm leading-6 text-auction-muted">
        {room ? "The next eligible lot will appear here automatically." : "Our catalogue will appear here when rooms are available."}
      </p>
      {nextReturn ? <p className="mt-3 text-sm text-auction-goldSoft">Next return: {formatShortDateTime(nextReturn)}</p> : null}
    </section>
  );
}
