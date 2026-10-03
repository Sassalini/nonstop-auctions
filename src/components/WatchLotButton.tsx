"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Heart } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function WatchLotButton({ lotId, enabled }: { lotId: string; enabled: boolean }) {
  const [watched, setWatched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const supabase = createSupabaseBrowserClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const { data } = await supabase.from("watchlist").select("id").eq("user_id", user.id).eq("lot_id", lotId).maybeSingle();
        if (!cancelled) setWatched(Boolean(data));
      } catch { /* A user can retry by pressing Watch. */ }
    })();
    return () => { cancelled = true; };
  }, [enabled, lotId]);
  async function toggle() {
    setBusy(true); setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMessage("Sign in to watch lots."); return; }
      const { error } = watched
        ? await supabase.from("watchlist").delete().eq("user_id", user.id).eq("lot_id", lotId)
        : await supabase.from("watchlist").insert({ user_id: user.id, lot_id: lotId });
      if (error) { setMessage("Could not update your watchlist. Please try again."); return; }
      setWatched(!watched);
    } catch { setMessage("Could not update your watchlist. Please try again."); }
    finally { setBusy(false); }
  }
  return <div className="shrink-0">
    <button type="button" disabled={!enabled || busy} onClick={toggle} aria-pressed={watched} className="flex min-h-11 items-center gap-2 rounded-md border border-white/10 px-3 text-sm text-auction-ivory transition hover:border-auction-gold/60 hover:text-auction-gold disabled:opacity-50"><Heart size={17} strokeWidth={1.8} fill={watched ? "currentColor" : "none"} />{watched ? "Watching" : "Watch"}</button>
    {message ? <p role="status" className="mt-2 max-w-48 text-xs text-auction-gold"><Link href="/login">{message}</Link></p> : null}
  </div>;
}
