import Link from "next/link";
import Image from "next/image";
import { ArrowUpRight, Clock, Eye, Star } from "lucide-react";
import { InteriorShell } from "@/components/InteriorShell";
import { formatCurrency, formatEstimate } from "@/lib/format";
import { listLots } from "@/lib/auction-data";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { formatShortDateTime } from "@/lib/auction-lifecycle";
import { SellerDraftActions } from "@/components/SellerDraftActions";

export const dynamic = "force-dynamic";

export default async function MyAuctionsPage({ searchParams }: { searchParams: Promise<{ submitted?: string }> }) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect("/login");
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/my-auctions");
  const [{ data: watchlist, error: watchError }, { data: bids, error: bidError }, sellerResult, roomResult] = await Promise.all([
    supabase.from("watchlist").select("lot_id").eq("user_id", user.id),
    supabase.from("bids").select("amount").eq("bidder_id", user.id).order("amount", { ascending: false }).limit(1),
    supabase.from("lots").select("*").eq("seller_id", user.id).order("created_at", { ascending: false }),
    supabase.from("auction_rooms").select("id,name,slug"),
  ]);
  if (watchError || bidError || sellerResult.error || roomResult.error) throw new Error("Could not load your auction account.");
  const submitted = (await searchParams).submitted === "1";
  const watchedIds = new Set((watchlist ?? []).map(item => item.lot_id));
  const watchedLots = watchedIds.size ? (await listLots()).filter(lot => watchedIds.has(lot.id)) : [];
  const nextDeadline = watchedLots.filter(lot => ["PREVIEW", "FIRST_BID_WINDOW", "ACTIVE_BIDDING"].includes(lot.auctionStatus)).map(lot => lot.endsAt).filter((value): value is string => Boolean(value)).sort()[0];

  return (
    <InteriorShell
      eyebrow="Private Desk"
      title="Track bids, watched lots, and seller activity."
      description="Your watched lots and bid activity, together in one place."
    >
      {submitted ? <p role="status" className="mb-5 rounded-lg border border-auction-gold/30 bg-auction-panel/90 p-4 text-sm text-auction-gold">Listing submitted successfully to the auction room queue.</p> : null}
      <section className="mb-5 rounded-lg border border-white/10 bg-auction-panel/90 p-5 shadow-glow">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-auction-ivory">Your Listings</h2><Link href="/sell" className="text-sm text-auction-gold underline">Sell an item</Link></div>
        {!sellerResult.data?.length ? <p className="mt-3 text-sm text-auction-muted">You have no listings yet.</p> : null}
        <div className="divide-y divide-white/10">{sellerResult.data?.map(lot => {
          const room = roomResult.data?.find(room => room.id === lot.room_id);
          return <article key={lot.id} className="py-4">
            <h3 className="break-words font-semibold text-auction-ivory">{lot.status === "DRAFT" ? lot.title : <Link href={`/lots/${lot.id}`} className="hover:text-auction-gold">{lot.title}</Link>}</h3>
            <p className="mt-1 text-sm text-auction-muted">{room?.name ?? "Auction room"} · {lot.status === "DRAFT" ? "Unfinished submission" : lot.status.replaceAll("_", " ")} · Starting bid {formatCurrency(Number(lot.starting_bid))}</p>
            {lot.status === "DRAFT" && lot.submission_key ? <SellerDraftActions lotId={lot.id} submissionKey={lot.submission_key} /> : null}
          </article>;
        })}</div>
      </section>
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
            {!watchedLots.length ? <p className="p-5 text-sm text-auction-muted">You are not watching any available lots yet.</p> : null}
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
            <p className="mt-4 text-sm text-auction-muted">Next watched deadline</p>
            <p className="mt-1 text-lg font-semibold text-auction-ivory">{nextDeadline ? formatShortDateTime(nextDeadline) : "No active watched lots"}</p>
          </section>
          <section className="rounded-lg border border-white/10 bg-auction-panel/80 p-5">
            <Eye className="text-auction-gold" size={24} strokeWidth={1.8} />
            <p className="mt-4 text-sm text-auction-muted">Lots watched</p>
            <p className="mt-1 text-2xl font-semibold text-auction-ivory">{watchedLots.length}</p>
          </section>
          <section className="rounded-lg border border-white/10 bg-auction-panel/80 p-5">
            <Star className="text-auction-gold" size={24} strokeWidth={1.8} />
            <p className="mt-4 text-sm text-auction-muted">Your highest bid</p>
            <p className="mt-1 text-2xl font-semibold text-auction-ivory">
              {bids?.length ? formatCurrency(Number(bids[0].amount)) : "No bids yet"}
            </p>
          </section>
        </aside>
      </div>
    </InteriorShell>
  );
}
