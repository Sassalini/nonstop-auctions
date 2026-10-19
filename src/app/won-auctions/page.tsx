import { getCompletedAuctions, parseHistoryPage, parseHistoryLot } from "@/lib/completed-auctions";
import { redirect } from "next/navigation";
import { InteriorShell } from "@/components/InteriorShell";
import { CompletedAuctions } from "@/components/CompletedAuctions";
import { createSupabaseServerClient } from "@/lib/supabase/server";
export const dynamic = "force-dynamic";
export default async function WonAuctionsPage({ searchParams }: { searchParams: Promise<{ historyPage?: string; lot?: string }> }) {
 if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) redirect("/login?next=/won-auctions");
 const client = await createSupabaseServerClient();
 const { data: { user } } = await client.auth.getUser();
 if (!user) redirect("/login?next=/won-auctions");
 const params = await searchParams;
 const history = await getCompletedAuctions("buyer", parseHistoryPage(params.historyPage), parseHistoryLot(params.lot));
 return <InteriorShell eyebrow="Private Desk" title="Won Auctions" description="Your completed purchases and auction results."><CompletedAuctions mode="buyer" history={history} /></InteriorShell>;
}
