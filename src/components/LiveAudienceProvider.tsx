"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { countLotViewers, selectLiveLot, type LiveLotCandidate } from "@/lib/live-viewers";

const AudienceContext = createContext<{
  counts: Record<string, number>;
  connected: boolean;
  liveHref: string;
  registerLot: (id: string) => () => void;
}>({ counts: {}, connected: false, liveHref: "/live", registerLot: () => () => {} });

export const useLiveAudience = () => useContext(AudienceContext);

function anonymousSessionKey() {
  const name = "nsa_viewing_session";
  const existing = document.cookie.split("; ").find((cookie) => cookie.startsWith(`${name}=`))?.slice(name.length + 1);
  if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const key = crypto.randomUUID();
  // A session cookie shares the key across tabs and survives refreshes, without
  // linking presence to an account or retaining permanent viewing counts.
  document.cookie = `${name}=${key}; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  return key;
}

export function LiveAudienceProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const [lots, setLots] = useState<LiveLotCandidate[]>([]);
  const viewedLot = useRef<{ id: string; token: symbol } | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribed = useRef(false);
  const generation = useRef(0);
  const cancelRequests = useCallback(() => { generation.current++; }, []);
  const pending = useRef<Promise<void> | null>(null);
  const queued = useRef(false);
  const refreshLots = useCallback(function refresh(force = false): Promise<void> {
    if (pending.current) {
      // Initial mount/subscription can share a read. An actual change arriving
      // during a read needs one trailing read so a transition cannot be missed.
      if (force) queued.current = true;
      return pending.current;
    }
    const request = ++generation.current;
    const promise = (async () => {
      try {
        const response = await fetch("/api/live-lots", { cache: "no-store" });
        if (!response.ok) throw new Error("Live catalogue unavailable");
        const data: { lots: LiveLotCandidate[] } = await response.json();
        if (request === generation.current) setLots(data.lots);
      } catch {
        if (request === generation.current) setLots([]);
      }
    })().finally(() => {
      if (pending.current === promise) pending.current = null;
      if (queued.current && request === generation.current) {
        queued.current = false;
        void refresh();
      }
    });
    pending.current = promise;
    return promise;
  }, []);
  const trackCurrentLot = useCallback(() => {
    const channel = channelRef.current;
    if (!channel || !subscribed.current) return;
    if (viewedLot.current && document.visibilityState === "visible") {
      void channel.track({ lot_id: viewedLot.current.id });
    } else {
      void channel.untrack();
    }
  }, []);
  const registerLot = useCallback((id: string) => {
    const token = Symbol();
    viewedLot.current = { id, token };
    trackCurrentLot();
    return () => {
      if (viewedLot.current?.token === token) {
        viewedLot.current = null;
        trackCurrentLot();
      }
    };
  }, [trackCurrentLot]);

  useEffect(() => { void refreshLots(); }, [pathname, refreshLots]);
  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let refreshTimeout: number | undefined;
    const requestRefresh = () => {
      if (cancelled || refreshTimeout !== undefined) return;
      refreshTimeout = window.setTimeout(() => { refreshTimeout = undefined; void refreshLots(true); }, 150);
    };
    const channel = supabase.channel("auction-live-audience", {
      config: { presence: { key: anonymousSessionKey(), enabled: true } },
    }).on("presence", { event: "sync" }, () => {
      if (!cancelled) setCounts(countLotViewers(channel.presenceState<{ lot_id: string }>()));
    }).on("postgres_changes", { event: "*", schema: "public", table: "lots" }, requestRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "auction_rooms" }, requestRefresh);
    channelRef.current = channel;
    channel.subscribe((status) => {
      if (cancelled) return;
      subscribed.current = status === "SUBSCRIBED";
      setConnected(subscribed.current);
      if (subscribed.current) { trackCurrentLot(); void refreshLots(); }
      else setCounts({});
    });
    const onVisible = () => {
      trackCurrentLot();
      if (document.visibilityState === "visible") void refreshLots();
    };
    const onHide = () => { if (subscribed.current) void channel.untrack(); };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void refreshLots();
    }, 15000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    window.addEventListener("pageshow", onVisible);
    window.addEventListener("pagehide", onHide);
    return () => {
      cancelled = true;
      cancelRequests();
      queued.current = false;
      pending.current = null;
      subscribed.current = false;
      channelRef.current = null;
      window.clearInterval(interval);
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      window.removeEventListener("pageshow", onVisible);
      window.removeEventListener("pagehide", onHide);
      void supabase.removeChannel(channel);
    };
  }, [refreshLots, trackCurrentLot, cancelRequests]);

  const winner = selectLiveLot(lots, connected ? counts : {});
  return <AudienceContext.Provider value={{ counts, connected, liveHref: winner ? `/lots/${winner.id}` : "/live", registerLot }}>
    {children}
  </AudienceContext.Provider>;
}
