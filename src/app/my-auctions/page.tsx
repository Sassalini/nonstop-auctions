import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Clock, Eye, Star } from "lucide-react";
import { InteriorShell } from "@/components/InteriorShell";
import { formatCurrency, formatEstimate } from "@/lib/format";
import { listLots } from "@/lib/auction-data";

export default async function MyAuctionsPage() {
  const watchedLots = (await listLots()).slice(0, 5);

  return (
    <InteriorShell
      eyebrow="Private Desk"
      title="Track bids, watched lots, and seller activity."
      description="A mock account surface for bidders and consignors, styled for quick scanning during live auctions."
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="overflow-hidden rounded-lg border border-white/10 bg-auction-panel/90 shadow-glow">
          <div className="grid grid-cols-[1fr_auto] gap-3 border-b border-white/10 p-4 sm:p-5">
            <div>
              <h2 className="text-lg font-semibold text-auction-ivory">Watched Lots</h2>
              <p className="mt-1 text-sm text-auction-muted">Live and upcoming lots on your list.</p>
            </div>
            <Link
              href="/"
              className="flex h-10 items-center gap-2 rounded-md border border-auction-gold/40 px-3 text-sm text-auction-gold transition hover:bg-auction-gold hover:text-black"
            >
              Live Rooms
              <ArrowUpRight size={17} strokeWidth={1.8} />
            </Link>
          </div>

          <div className="divide-y divide-white/10">
            {watchedLots.map((lot) => (
              <Link
                href={`/lots/${lot.id}`}
                key={lot.id}
                className="grid gap-4 p-4 transition hover:bg-white/[0.035] sm:grid-cols-[96px_minmax(0,1fr)_auto] sm:items-center sm:p-5"
              >
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-white/10 sm:w-24">
                  <Image
                    src={lot.thumbnailUrl}
                    alt={lot.title}
                    fill
                    sizes="96px"
                    className="object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.18em] text-auction-gold">
                    Lot {lot.lotNumber}
                  </p>
                  <h3 className="mt-1 text-base font-semibold text-auction-ivory">
                    {lot.title}
                  </h3>
                  <p className="mt-1 text-sm text-auction-muted">
                    Est. {formatEstimate(lot.estimateLow, lot.estimateHigh)}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-3 text-sm sm:min-w-48">
                  <span className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-auction-ivory">
                    {formatCurrency(lot.currentBid)}
                  </span>
                  <span className="rounded-md border border-white/10 bg-black/25 px-3 py-2 text-auction-muted">
                    {lot.bidCount} bids
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>

        <aside className="space-y-3">
          <section className="rounded-lg border border-white/10 bg-auction-panel/80 p-5">
            <Clock className="text-auction-ember" size={24} strokeWidth={1.8} />
            <p className="mt-4 text-sm text-auction-muted">Next closing lot</p>
            <p className="mt-1 text-2xl font-semibold text-auction-ivory">00:00:45</p>
          </section>
          <section className="rounded-lg border border-white/10 bg-auction-panel/80 p-5">
            <Eye className="text-auction-gold" size={24} strokeWidth={1.8} />
            <p className="mt-4 text-sm text-auction-muted">Lots watched</p>
            <p className="mt-1 text-2xl font-semibold text-auction-ivory">{watchedLots.length}</p>
          </section>
          <section className="rounded-lg border border-white/10 bg-auction-panel/80 p-5">
            <Star className="text-auction-gold" size={24} strokeWidth={1.8} />
            <p className="mt-4 text-sm text-auction-muted">Highest active bid</p>
            <p className="mt-1 text-2xl font-semibold text-auction-ivory">
              {formatCurrency(12500)}
            </p>
          </section>
        </aside>
      </div>
    </InteriorShell>
  );
}
