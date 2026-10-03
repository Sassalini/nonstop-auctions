"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useAuctionClockOffset } from "@/components/AuctionClockProvider";
import { isTimedLifecycleStatus } from "@/lib/auction-lifecycle";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LotStatus } from "@/lib/supabase/types";

type AuctionLiveSyncProps = {
  databaseRoomId?: string;
  lotId: string;
  status: LotStatus;
  countdownSeconds: number;
  endsAt?: string | null;
};

export function AuctionLiveSync({ databaseRoomId, lotId, status, endsAt }: AuctionLiveSyncProps) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [syncError, setSyncError] = useState("");
  const [, startTransition] = useTransition();
  const clockOffsetMs = useAuctionClockOffset();
  const refreshAuction = useCallback(() => {
    startTransition(() => router.refresh());
  }, [router]);
  const recoverAuction = useCallback(async () => {
    if (!databaseRoomId || inFlight.current) return;
    inFlight.current = true;
    try {
      // The database checks the phase and its own clock. Calling early cannot end a lot.
      const { error } = await createSupabaseBrowserClient().rpc("advance_room_lifecycle", { p_room_id: databaseRoomId });
      if (error) throw error;
      setSyncError("");
      refreshAuction();
    } catch (error) {
      console.error("Auction recovery failed:", error);
      setSyncError("Live updates are temporarily unavailable. Reconnecting automatically.");
    } finally { inFlight.current = false; }
  }, [databaseRoomId, refreshAuction]);

  useEffect(() => {
    if (!databaseRoomId || !isTimedLifecycleStatus(status) || !endsAt) return;
    const delay = Math.max(0, Date.parse(endsAt) - Date.now() - clockOffsetMs) + 150;
    const timeout = window.setTimeout(() => { void recoverAuction(); }, Math.min(delay, 2147483647));
    return () => window.clearTimeout(timeout);
  }, [databaseRoomId, lotId, status, endsAt, clockOffsetMs, recoverAuction]);

  useEffect(() => {
    if (!databaseRoomId) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let refreshTimeout: number | undefined;
    const requestRefresh = () => {
      if (cancelled || refreshTimeout !== undefined) return;
      refreshTimeout = window.setTimeout(() => {
        refreshTimeout = undefined;
        if (!cancelled) refreshAuction();
      }, 100);
    };
    const channel = supabase.channel(`auction-room-${databaseRoomId}`).on("postgres_changes", {
      event: "*", schema: "public", table: "lots", filter: `room_id=eq.${databaseRoomId}`,
    }, requestRefresh).subscribe((channelStatus) => {
      if (cancelled) return;
      if (channelStatus === "SUBSCRIBED") {
        setSyncError("");
        // Recover changes missed while disconnected, including an empty room becoming eligible.
        void recoverAuction();
      } else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT") {
        setSyncError("Live updates disconnected. Reconnecting automatically.");
      }
    });
    const onVisible = () => { if (document.visibilityState === "visible") void recoverAuction(); };
    const onOnline = () => { void recoverAuction(); };
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") void recoverAuction();
    }, 15000);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
      if (refreshTimeout !== undefined) window.clearTimeout(refreshTimeout);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [databaseRoomId, refreshAuction, recoverAuction]);

  return syncError ? (
    <div role="alert" className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-auction-danger/40 bg-black/90 px-4 py-3 text-sm text-auction-ivory shadow-2xl">{syncError}</div>
  ) : null;
}
