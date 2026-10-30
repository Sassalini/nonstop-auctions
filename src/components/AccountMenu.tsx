"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { UserCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function AccountMenu() {
  const [name, setName] = useState<string | null>(null);
  const router = useRouter();
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = createSupabaseBrowserClient();
    // INITIAL_SESSION supplies the display state; authorization remains in
    // verified server pages and database RLS, not this navigation label.
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setName(session?.user ? "My account" : null));
    return () => { data.subscription.unsubscribe(); };
  }, []);
  return <div className="flex items-center gap-1">
    <Link prefetch={false} href={name ? "/my-auctions" : "/login"} aria-label={name ?? "Sign in"} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-2.5 py-2 text-sm text-auction-ivory transition hover:border-auction-gold/40">
      <UserCircle size={22} strokeWidth={1.8} /><span className="hidden sm:inline">{name ?? "Sign in"}</span>
    </Link>
    {name ? <Link prefetch={false} href="/won-auctions" className="hidden px-2 text-xs text-auction-gold sm:block">Won Auctions</Link> : null}
    {name ? <details className="relative"><summary className="cursor-pointer px-2 py-3 text-xs text-auction-gold">Account</summary><nav aria-label="Account settings" className="absolute right-0 z-50 w-48 rounded-lg border border-auction-gold/30 bg-auction-black p-3"><Link className="block py-3 text-sm text-auction-gold sm:hidden" href="/won-auctions" prefetch={false}>Won Auctions</Link><Link className="block py-3 text-sm text-auction-gold" href="/messages" prefetch={false}>Messages</Link><Link className="block py-3 text-sm text-auction-gold" href="/account/addresses" prefetch={false}>Delivery Addresses</Link><Link className="block py-3 text-sm text-auction-gold" href="/my-auctions#sold-auctions" prefetch={false}>Sold Auctions</Link></nav></details> : null}
    {name ? <button type="button" onClick={async () => {
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (!error) { setName(null); router.replace("/login"); router.refresh(); }
    }} className="min-h-11 px-2 text-xs text-auction-muted hover:text-auction-gold">Sign out</button> : null}
  </div>;
}


