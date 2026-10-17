import { Camera, Gem, ShieldCheck, Truck } from "lucide-react";
import { InteriorShell } from "@/components/InteriorShell";
import { SellerListingForm } from "@/components/SellerListingForm";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { resolveLotPhotos } from "@/lib/lot-photos";
import type { AuctionRoomRow, LotImageRow, LotRow } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";
const steps = [
  { title: "Moderation", copy: "We regularly monitor and regulate listings to do our best to ensure high quality auctions.", icon: Gem },
  { title: "Trusted Sellers", copy: "Sellers go through verification before payouts to protect buyers from potentially harmful transactions.", icon: ShieldCheck },
  { title: "A fully online Traditional Experience", copy: "Everything you’d expect from an online marketplace but with the benefits of a traditional auction format.", icon: Truck },
];

export default async function SellPage({ searchParams }: { searchParams: Promise<{ draft?: string }> }) {
  let rooms: AuctionRoomRow[] = [];
  let draft: LotRow | null = null;
  let photos: LotImageRow[] = [];
  let userId: string | null = null;
  let loadError = "";
  try {
    const client = await createSupabaseServerClient();
    const [{ data: { user } }, roomResult] = await Promise.all([
      client.auth.getUser(), client.from("auction_rooms").select("*").eq("is_active", true).order("display_order").order("id"),
    ]);
    userId = user?.id ?? null;
    if (roomResult.error) throw new Error("Could not load auction rooms. Please try again.");
    rooms = roomResult.data ?? [];
    const { draft: draftId } = await searchParams;
    if (draftId && user) {
      const result = await client.from("lots").select("*").eq("id", draftId).eq("seller_id", user.id).eq("status", "DRAFT").maybeSingle();
      if (result.error || !result.data?.submission_key) throw new Error("That unfinished submission is unavailable. Open it from My Auctions.");
      draft = result.data;
      const imageResult = await client.from("lot_images").select("*").eq("lot_id", draft.id).order("sort_order");
      if (imageResult.error) throw new Error("Could not load your photos. Please try again.");
      photos = await resolveLotPhotos(client, imageResult.data ?? []);
    }
  } catch (error) { loadError = error instanceof Error ? error.message : "Seller submissions are temporarily unavailable."; }
  return <InteriorShell eyebrow="Sell With Nonstop" title="Sell an Item."
    description="Please provide item information in as much detail as you can. Submissions that are low quality and could be deemed potentially harmful may be removed. Please see our prohibited items document if you are unsure if your item is allowed to be listed.">
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <SellerListingForm key={draft?.id ?? "new"} rooms={rooms} userId={userId} draft={draft} initialPhotos={photos} loadError={loadError} />
      <aside className="space-y-3">
        {steps.map(({ title, copy, icon: Icon }) => <section key={title} className="rounded-lg border border-white/10 bg-auction-panel/80 p-5">
          <Icon className="text-auction-gold" size={24} strokeWidth={1.8} />
          <h2 className="mt-4 text-lg font-semibold text-auction-ivory">{title}</h2><p className="mt-2 text-sm leading-6 text-auction-muted">{copy}</p>
        </section>)}
        <section className="rounded-lg border border-auction-gold/30 bg-auction-gold/10 p-5">
          <Camera className="text-auction-gold" size={24} strokeWidth={1.8} />
          <h2 className="mt-4 text-lg font-semibold text-auction-ivory">High Quality As Standard</h2>
          <p className="mt-2 text-sm leading-6 text-auction-muted">We strive to ensure only the highest quality items are bought and sold through us.</p>
        </section>
      </aside>
    </div>
  </InteriorShell>;
}
