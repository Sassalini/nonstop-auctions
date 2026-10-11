import Link from "next/link";
import { InteriorShell } from "@/components/InteriorShell";
import { LiveLotRedirect } from "@/components/LiveLotRedirect";

export default function LivePage() {
  return <InteriorShell eyebrow="Live Auctions" title="Waiting for the next live lot" description="The next available live lot will open here automatically. If live updates are unavailable, you can browse the auction rooms.">
    <LiveLotRedirect />
    <Link href="/" className="inline-flex min-h-11 items-center rounded-md border border-auction-gold/40 px-4 text-sm text-auction-gold">Browse auction rooms</Link>
  </InteriorShell>;
}
