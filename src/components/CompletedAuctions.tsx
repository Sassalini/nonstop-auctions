import Image from "next/image";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveLotPhotos } from "@/lib/lot-photos";
import { formatCurrency } from "@/lib/format";

export async function CompletedAuctions({ mode }: { mode: "buyer" | "seller" }) {
 const client = await createSupabaseServerClient();
 const { data, error } = await client.rpc("my_completed_auctions", {});
 if (error) throw new Error("Could not load completed auctions. Please try again.");
 const records = (data ?? []).filter(row => mode === "buyer" ? row.is_buyer : !row.is_buyer).sort((a, b) => b.completed_at.localeCompare(a.completed_at) || a.lot_id.localeCompare(b.lot_id));
 const ids = records.map(row => row.lot_id);
 const [lots, images] = ids.length ? await Promise.all([
  client.from("lots").select("id,title").in("id", ids),
  client.from("lot_images").select("*").in("lot_id", ids).order("sort_order"),
 ]) : [{ data: [], error: null }, { data: [], error: null }];
 if (lots.error || images.error) throw new Error("Could not load completed listing details.");
 const photos = await resolveLotPhotos(client, images.data ?? []);
 return <section id={mode === "seller" ? "sold-auctions" : "won-auctions"} className="mb-5 rounded-lg border border-white/10 bg-auction-panel/90 p-5">
  <h2 className="text-lg font-semibold text-auction-ivory">{mode === "buyer" ? "Won Auctions" : "Sold Auctions"}</h2>
  <p className="mt-2 text-sm text-auction-muted">{mode === "buyer" ? "Auction won" : "Sale completed"} · Payment not recorded · Fulfilment not recorded · Delivery not recorded</p>
  {!records.length ? <p className="mt-4 text-sm text-auction-muted">No completed auctions yet.</p> : null}
  <div className="divide-y divide-white/10">{records.map(record => {
   const lot = lots.data?.find(lot => lot.id === record.lot_id);
   const image = photos.find(photo => photo.lot_id === record.lot_id);
   return <article id={record.lot_id} key={record.lot_id} className="flex flex-wrap gap-4 py-5">
    <Image src={image?.image_url ?? "/images/auction-house-background.png"} alt={lot?.title ?? "Completed lot"} width={112} height={84} className="h-20 w-28 rounded-md object-cover" />
    <div className="min-w-0 flex-1"><Link href={`/lots/${record.lot_id}`} className="break-words font-semibold text-auction-gold">{lot?.title ?? "View completed lot"}</Link>
     {mode === "buyer" ? <p className="mt-1 text-sm text-auction-ivory">You won this auction.</p> : null}
     <p className="mt-1 text-sm text-auction-ivory">Sold for: {formatCurrency(Number(record.sale_price))}</p>
     <p className="mt-1 text-sm text-auction-muted">{mode === "buyer" ? `Seller: ${record.seller_name}` : `Winning bidder: ${record.buyer_name}`}</p>
     <time className="text-sm text-auction-muted" dateTime={record.completed_at}>{new Date(record.completed_at).toLocaleString("en-GB", { timeZone: "Europe/London" })}</time>
    </div>
   </article>;
  })}</div>
 </section>;
}
