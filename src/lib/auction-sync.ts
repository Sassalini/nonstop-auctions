import type { LotStatus } from "@/lib/supabase/types";

const timedStatuses = new Set<LotStatus>([
  "PREVIEW",
  "FIRST_BID_WINDOW",
  "ACTIVE_BIDDING",
]);

export function getLifecycleSyncDelayMs(status: LotStatus, countdownSeconds: number) {
  if (!timedStatuses.has(status)) {
    return null;
  }

  return Math.max(0, Math.ceil(countdownSeconds) * 1000 + 250);
}
