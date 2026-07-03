import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[calc(100vh-74px)] max-w-3xl flex-col items-center justify-center px-4 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-auction-gold">
        Lot Not Found
      </p>
      <h1 className="mt-3 text-3xl font-semibold text-auction-ivory">
        This auction room is no longer on the rostrum.
      </h1>
      <p className="mt-4 text-auction-muted">
        Return to the live sale floor to pick up the next lot.
      </p>
      <Link
        href="/"
        className="mt-6 rounded-md bg-auction-gold px-4 py-2 text-sm font-semibold text-black transition hover:bg-auction-goldSoft"
      >
        Back to Live Auctions
      </Link>
    </main>
  );
}
