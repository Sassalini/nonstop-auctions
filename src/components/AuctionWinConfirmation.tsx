"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
export function AuctionWinConfirmation({ lotId }: { lotId: string }) {
 const [won, setWon] = useState(false);
 useEffect(() => {
  let cancelled = false;
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
  const client = createSupabaseBrowserClient();
  let version = 0;
  const { data: listener } = client.auth.onAuthStateChange((_event, session) => {
   const request = ++version;
   setWon(false);
   if (!session?.user) return;
   // Keep database work outside the auth callback to avoid the SDK auth lock.
   window.setTimeout(async () => {
    if (cancelled || request !== version) return;
    const { data } = await client.rpc("completed_auctions_page", { p_mode: "buyer", p_limit: 1, p_lot_id: lotId });
    if (!cancelled && request === version) setWon(Boolean(data?.some(row => row.lot_id === lotId && row.is_buyer)));
   }, 0);
  });
  return () => { cancelled = true; listener.subscription.unsubscribe(); };
 }, [lotId]);
 return won ? <p role="status" className="mb-4 rounded-md border border-auction-gold/30 p-4 text-sm text-auction-gold">You won this auction. <Link href={`/won-auctions?lot=${lotId}#${lotId}`} className="underline">View Won Auctions</Link></p> : null;
}
