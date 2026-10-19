import { redirect } from "next/navigation";
import { InteriorShell } from "@/components/InteriorShell";
import { CompletedAuctions } from "@/components/CompletedAuctions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function WonAuctionsPage() {
 if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect("/login?next=/won-auctions");
 const client = await createSupabaseServerClient();
 const { data: { user } } = await client.auth.getUser();
 if (!user) redirect("/login?next=/won-auctions");
 return <InteriorShell eyebrow="Private Desk" title="Won Auctions" description="Your completed purchases and auction results."><CompletedAuctions mode="buyer" /></InteriorShell>;
}
