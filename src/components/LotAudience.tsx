"use client";
import { useEffect, useState } from "react";
import { Eye, Heart } from "lucide-react";
import { useLiveAudience } from "@/components/LiveAudienceProvider";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function LotAudience({ lotId, enabled }: { lotId: string; enabled: boolean }) {
  const { counts, connected, registerLot } = useLiveAudience();
  const [watchCount, setWatchCount] = useState<number | null>(null);
  useEffect(() => {
    if (!enabled) return;
    return registerLot(lotId);
  }, [enabled, lotId, registerLot]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let request = 0;
    const refresh = async () => {
      const currentRequest = ++request;
      try {
        const { data, error } = await createSupabaseBrowserClient().rpc("lot_watchlist_count", { p_lot_id: lotId });
        if (!cancelled && currentRequest === request) setWatchCount(error ? null : Number(data));
      } catch { if (!cancelled && currentRequest === request) setWatchCount(null); }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onWatch = (event: Event) => {
      if ((event as CustomEvent<string>).detail === lotId) void refresh();
    };
    void refresh();
    const interval = window.setInterval(onVisible, 60000);
    window.addEventListener("auction-watchlist-changed", onWatch);
    window.addEventListener("online", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("auction-watchlist-changed", onWatch);
      window.removeEventListener("online", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, lotId]);
  const badge = "flex min-h-7 items-center gap-1 rounded-md border border-white/10 bg-white/[0.04] px-2.5 text-xs text-auction-ivory";
  return <div className="flex flex-wrap items-center gap-2" aria-live="polite">
    <span className={badge} title="Distinct active viewing sessions; hidden tabs are excluded">
      <Eye size={15} strokeWidth={1.8} aria-hidden="true" />
      <span data-testid="live-viewer-count">{enabled && connected ? counts[lotId] ?? 0 : "—"} viewers</span>
    </span>
    <span className={badge} title="Accounts with this lot saved in their watchlist">
      <Heart size={15} strokeWidth={1.8} aria-hidden="true" />
      <span data-testid="watchlist-count">{enabled ? watchCount ?? "—" : "—"} watching</span>
    </span>
  </div>;
}
