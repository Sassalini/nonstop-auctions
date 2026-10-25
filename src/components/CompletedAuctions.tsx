import { LotPhoto as Image } from "@/components/LotPhoto";
import Link from "next/link";
import { getCompletedAuctions, type CompletedAuctionPage } from "@/lib/completed-auctions";
import { formatCurrency } from "@/lib/format";

export async function CompletedAuctions({ mode, history: prepared }: { mode: "buyer" | "seller"; history?: CompletedAuctionPage }) {
 const history = prepared ?? await getCompletedAuctions(mode);
 const { records, hasNext, page, focused } = history;
 const path = mode === "buyer" ? "/won-auctions" : "/my-auctions";
 const anchor = mode === "buyer" ? "won-auctions" : "sold-auctions";
 return <section id={anchor} className="mb-5 rounded-lg border border-white/10 bg-auction-panel/90 p-5">
  <h2 className="text-lg font-semibold text-auction-ivory">{mode === "buyer" ? "Won Auctions" : "Sold Auctions"}</h2>
  <p className="mt-2 text-sm text-auction-muted">{mode === "buyer" ? "Auction won" : "Sale completed"} · Payment not recorded · Fulfilment not recorded · Delivery not recorded</p>
  {!records.length ? <p className="mt-4 text-sm text-auction-muted">No completed auctions yet.</p> : null}
  <div className="divide-y divide-white/10">{records.map(record => <article id={record.lot_id} key={record.lot_id} className="flex flex-wrap gap-4 py-5">
    <Image src={record.image_url || "/images/auction-house-background.png"} alt={record.title} width={112} height={84} className="h-20 w-28 rounded-md object-cover" />
    <div className="min-w-0 flex-1"><p className="mb-1 text-xs text-auction-muted">Lot {record.lot_reference}</p><Link prefetch={false} href={`/lots/${record.lot_id}?view=manual`} className="break-words font-semibold text-auction-gold">{record.title}</Link>
     {mode === "buyer" ? <p className="mt-1 text-sm text-auction-ivory">You won this auction.</p> : null}
     <p className="mt-1 text-sm text-auction-ivory">Sold for: {formatCurrency(Number(record.sale_price))}</p>
     <p className="mt-1 text-sm text-auction-muted">{mode === "buyer" ? `Seller: ${record.seller_name}` : `Winning bidder: ${record.buyer_name}`}</p>
     <time className="text-sm text-auction-muted" dateTime={record.completed_at}>{new Date(record.completed_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}</time>
    </div>
   </article>)}</div>
  {focused || page > 1 || hasNext ? <nav aria-label={`${mode === "buyer" ? "Won" : "Sold"} auction pages`} className="mt-4 flex flex-wrap gap-5 text-sm text-auction-gold">
    {focused ? <Link prefetch={false} href={`${path}#${anchor}`}>View all {mode === "buyer" ? "Won" : "Sold"} Auctions</Link> : <>
      {page > 1 ? <Link prefetch={false} href={`${path}?historyPage=${page - 1}#${anchor}`}>Previous</Link> : null}
      <span className="text-auction-muted">Page {page}</span>
      {hasNext ? <Link prefetch={false} href={`${path}?historyPage=${page + 1}#${anchor}`}>Next</Link> : null}
    </>}
  </nav> : null}
 </section>;
}
