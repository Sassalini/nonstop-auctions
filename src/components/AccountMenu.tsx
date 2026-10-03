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
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (!cancelled) setName(user ? "My account" : null);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setName(session?.user ? "My account" : null));
    return () => { cancelled = true; data.subscription.unsubscribe(); };
  }, []);
  return <div className="flex items-center gap-1">
    <Link href={name ? "/my-auctions" : "/login"} aria-label={name ?? "Sign in"} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-2.5 py-2 text-sm text-auction-ivory transition hover:border-auction-gold/40">
      <UserCircle size={22} strokeWidth={1.8} /><span className="hidden sm:inline">{name ?? "Sign in"}</span>
    </Link>
    {name ? <button type="button" onClick={async () => {
      const { error } = await createSupabaseBrowserClient().auth.signOut();
      if (!error) { setName(null); router.replace("/login"); router.refresh(); }
    }} className="min-h-11 px-2 text-xs text-auction-muted hover:text-auction-gold">Sign out</button> : null}
  </div>;
}
