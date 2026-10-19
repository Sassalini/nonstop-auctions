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
  const check = async () => {
   const { data: { user } } = await client.auth.getUser();
   if (!user) { if (!cancelled) setWon(false); return; }
   const { data } = await client.rpc("my_completed_auctions", {});
   if (!cancelled) setWon(Boolean(data?.some(row => row.lot_id === lotId && row.is_buyer)));
  };
  void check();
  const { data: listener } = client.auth.onAuthStateChange(() => { setWon(false); window.setTimeout(() => { if (!cancelled) void check(); }, 0); });
  return () => { cancelled = true; listener.subscription.unsubscribe(); };
 }, [lotId]);
 return won ? <p role="status" className="mb-4 rounded-md border border-auction-gold/30 p-4 text-sm text-auction-gold">You won this auction. <Link href={`/won-auctions#${lotId}`} className="underline">View Won Auctions</Link></p> : null;
}
