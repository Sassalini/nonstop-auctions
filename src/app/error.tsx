"use client";
import { useRouter } from "next/navigation";

export default function AuctionError({ reset }: { reset: () => void }) {
  const router = useRouter();
  return <main className="mx-auto flex min-h-[calc(100vh-74px)] max-w-3xl flex-col items-center justify-center px-4 text-center">
    <p className="text-xs font-semibold uppercase tracking-[0.22em] text-auction-gold">Live Auctions</p>
    <h1 className="mt-3 text-3xl font-semibold text-auction-ivory">Live auctions are temporarily unavailable.</h1>
    <p className="mt-4 text-auction-muted">Please retry shortly to load the latest auction state.</p>
    <button type="button" onClick={() => { router.refresh(); reset(); }} className="mt-6 min-h-11 rounded-md bg-auction-gold px-4 py-2 text-sm font-semibold text-black">Try again</button>
  </main>;
}
