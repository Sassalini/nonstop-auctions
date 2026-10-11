export const AUTO_PLAY_STORAGE_KEY = "nonstop-auctions:auto-play";

export function readAutoPlayPreference(value: string | null) {
  return value !== "off";
}

// Navigation only. IDs here are supplied by authoritative server catalogue reads.
export function getAuctionViewingTarget({ ready, enabled, displayedLotId, roomCurrentLotId, isLotRoute }: {
  ready: boolean;
  enabled: boolean;
  displayedLotId?: string;
  roomCurrentLotId?: string;
  isLotRoute: boolean;
}) {
  if (!ready) return null;
  if (enabled) return roomCurrentLotId && roomCurrentLotId !== displayedLotId ? `/lots/${roomCurrentLotId}` : null;
  // Pin a room/homepage view to a durable lot URL, so refreshes update that same
  // lot's final result rather than replacing it with the room's next lot.
  return displayedLotId && !isLotRoute ? `/lots/${displayedLotId}` : null;
}
