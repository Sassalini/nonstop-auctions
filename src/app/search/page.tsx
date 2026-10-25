import Link from "next/link";
import { InteriorShell } from "@/components/InteriorShell";
import { getLotByReference } from "@/lib/auction-data";
import { parseLotReference } from "@/lib/lot-reference";
import { lotPrice } from "@/lib/lot-price";
export const dynamic = "force-dynamic";
export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
 const params = await searchParams;
 const q = typeof params.q === "string" ? params.q : "";
 const reference = parseLotReference(q);
 const lot = reference ? await getLotByReference(reference) : null;
 return <InteriorShell eyebrow="Catalogue" title="Find a lot" description="Search using a permanent lot reference number.">
  <form action="/search" className="mb-5 flex flex-wrap gap-3"><label className="min-w-0 flex-1 text-sm text-auction-ivory">Lot reference<input name="q" defaultValue={q} placeholder="For example, Lot 123" required className="mt-2 block h-11 w-full rounded-md border border-white/20 bg-black/50 px-3" /></label><button type="submit" className="mt-auto min-h-11 rounded-md bg-auction-gold px-5 text-sm text-black">Search</button></form>
  {lot ? <article className="rounded-lg border border-white/10 bg-auction-panel/90 p-5"><p className="text-sm text-auction-muted">Lot {lot.lotNumber}</p><Link href={lot.auctionStatus === "DRAFT" ? `/sell?draft=${lot.id}` : `/lots/${lot.id}?view=manual`} className="mt-2 inline-block font-semibold text-auction-gold">{lot.title}</Link><p className="mt-2 text-sm text-auction-ivory">{lotPrice(lot)}</p></article> : q ? <p role="status" className="text-auction-muted">{reference ? "No accessible listing matches that reference." : "Enter a valid lot reference number."}</p> : null}
 </InteriorShell>;
}
