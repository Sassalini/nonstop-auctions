"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getClockOffsetMs } from "@/lib/auction-clock";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

const AuctionClockContext = createContext(0);
export const useAuctionClockOffset = () => useContext(AuctionClockContext);

export function AuctionClockProvider({ databaseRoomId, children }: {
  databaseRoomId?: string;
  children: React.ReactNode;
}) {
  const [offsetMs, setOffsetMs] = useState(0);
  useEffect(() => {
    if (!databaseRoomId) return;
    let cancelled = false;
    const syncClock = async () => {
      try {
        const started = Date.now();
        const { data, error } = await createSupabaseBrowserClient().rpc("auction_server_time");
        if (!error && data && !cancelled) setOffsetMs(getClockOffsetMs(data, started, Date.now()));
        else if (error) console.error("Auction clock synchronization failed:", error);
      } catch (error) { console.error("Auction clock synchronization failed:", error); }
    };
    const onVisible = () => { if (document.visibilityState === "visible") void syncClock(); };
    void syncClock();
    const interval = window.setInterval(() => { void syncClock(); }, 30000);
    window.addEventListener("online", syncClock);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("online", syncClock);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [databaseRoomId]);
  return <AuctionClockContext.Provider value={offsetMs}>{children}</AuctionClockContext.Provider>;
}
