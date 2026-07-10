"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { getLifecycleSyncDelayMs } from "@/lib/auction-sync";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { LotStatus } from "@/lib/supabase/types";

type AuctionLiveSyncProps = {
  databaseRoomId?: string;
  lotId: string;
  status: LotStatus;
  countdownSeconds: number;
};

export function AuctionLiveSync({
  databaseRoomId,
  lotId,
  status,
  countdownSeconds,
}: AuctionLiveSyncProps) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [syncError, setSyncError] = useState("");
  const [, startTransition] = useTransition();

  const refreshAuction = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const advanceExpiredPhase = useCallback(async () => {
    if (inFlight.current) {
      return false;
    }

    if (!databaseRoomId) {
      setSyncError("Live auction updates require a working Supabase connection.");
      return true;
    }

    inFlight.current = true;

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.rpc("advance_room_lifecycle", {
        p_room_id: databaseRoomId,
      });

      if (error) {
        console.error("Auction transition failed:", error);
        setSyncError(`Auction transition failed: ${error.message}`);
        return false;
      }

      setSyncError("");
      refreshAuction();
      return true;
    } catch (error) {
      console.error("Auction transition failed:", error);
      setSyncError(
        error instanceof Error
          ? `Auction transition failed: ${error.message}`
          : "Auction transition failed. Retrying shortly.",
      );
      return false;
    } finally {
      inFlight.current = false;
    }
  }, [databaseRoomId, refreshAuction]);

  useEffect(() => {
    const delay = getLifecycleSyncDelayMs(status, countdownSeconds);

    if (delay === null) {
      return;
    }

    let cancelled = false;
    let retryTimeout: number | undefined;

    const runRecovery = async () => {
      const recovered = await advanceExpiredPhase();

      if (!recovered && !cancelled) {
        retryTimeout = window.setTimeout(() => {
          void runRecovery();
        }, 5000);
      }
    };

    const timeout = window.setTimeout(() => {
      void runRecovery();
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);

      if (retryTimeout !== undefined) {
        window.clearTimeout(retryTimeout);
      }
    };
  }, [advanceExpiredPhase, countdownSeconds, lotId, status]);

  useEffect(() => {
    if (!databaseRoomId) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      .channel(`auction-room-${databaseRoomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "lots",
          filter: `room_id=eq.${databaseRoomId}`,
        },
        refreshAuction,
      )
      .subscribe((channelStatus) => {
        if (channelStatus === "SUBSCRIBED") {
          setSyncError("");
        } else if (channelStatus === "CHANNEL_ERROR" || channelStatus === "TIMED_OUT") {
          const message = "Live auction updates disconnected. Deadline recovery is still active.";
          console.error(message);
          setSyncError(message);
        }
      });

    return () => {
      void supabase.removeChannel(channel).then((removeStatus) => {
        if (removeStatus !== "ok") {
          console.error("Could not remove auction realtime channel:", removeStatus);
        }
      });
    };
  }, [databaseRoomId, refreshAuction]);

  if (!syncError) {
    return null;
  }

  return (
    <div
      role="alert"
      className="fixed bottom-4 right-4 z-50 max-w-sm rounded-md border border-auction-danger/40 bg-black/90 px-4 py-3 text-sm text-auction-ivory shadow-2xl"
    >
      {syncError}
    </div>
  );
}
