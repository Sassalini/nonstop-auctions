import type { LotStatus } from "@/lib/supabase/types";

export type AuctionStatusVariant =
  | "active"
  | "closing"
  | "preview"
  | "sold"
  | "unavailable"
  | "upcoming"
  | "waiting";

const statusLabels: Record<LotStatus, string> = {
  DRAFT: "Draft",
  WAITING: "Waiting",
  PREVIEW: "Preview period",
  FIRST_BID_WINDOW: "Bidding open",
  ACTIVE_BIDDING: "Active bidding",
  SOLD: "Sold",
  UNSOLD: "No bids — returned to queue",
  CANCELLED: "Cancelled",
};

const compactStatusLabels: Record<LotStatus, string> = {
  DRAFT: "Draft",
  WAITING: "Waiting",
  PREVIEW: "Preview",
  FIRST_BID_WINDOW: "Open",
  ACTIVE_BIDDING: "Active",
  SOLD: "Sold",
  UNSOLD: "Returned",
  CANCELLED: "Cancelled",
};

const timerLabels: Record<LotStatus, string> = {
  DRAFT: "Waiting",
  WAITING: "Waiting",
  PREVIEW: "Bidding starts in",
  FIRST_BID_WINDOW: "First bid closes in",
  ACTIVE_BIDDING: "New bids close in",
  SOLD: "Sold",
  UNSOLD: "No bids — returned to queue",
  CANCELLED: "Cancelled",
};

const badgeVariants: Record<LotStatus, AuctionStatusVariant> = {
  DRAFT: "waiting",
  WAITING: "upcoming",
  PREVIEW: "preview",
  FIRST_BID_WINDOW: "closing",
  ACTIVE_BIDDING: "active",
  SOLD: "sold",
  UNSOLD: "unavailable",
  CANCELLED: "waiting",
};

export function getLotStatusLabel(status?: LotStatus) {
  return status ? statusLabels[status] : statusLabels.ACTIVE_BIDDING;
}

export function getLotCompactStatusLabel(status?: LotStatus) {
  return status ? compactStatusLabels[status] : compactStatusLabels.ACTIVE_BIDDING;
}

export function getLotTimerLabel(status?: LotStatus) {
  return status ? timerLabels[status] : timerLabels.ACTIVE_BIDDING;
}

export function getLotBadgeVariant(status?: LotStatus): AuctionStatusVariant {
  return status ? badgeVariants[status] : badgeVariants.ACTIVE_BIDDING;
}

export function isBiddingOpen(status?: LotStatus) {
  return status === "FIRST_BID_WINDOW" || status === "ACTIVE_BIDDING";
}

export function isTimedLifecycleStatus(status?: LotStatus) {
  return status === "PREVIEW" || status === "FIRST_BID_WINDOW" || status === "ACTIVE_BIDDING";
}

export function getMinimumAcceptedBid({
  auctionStatus,
  currentBid,
  minimumIncrement,
  startingBid,
}: {
  auctionStatus?: LotStatus;
  currentBid: number;
  minimumIncrement: number;
  startingBid?: number;
}) {
  if (auctionStatus === "FIRST_BID_WINDOW") {
    return Math.max(currentBid, startingBid ?? currentBid);
  }

  return currentBid + minimumIncrement;
}

export function formatShortDateTime(value: string | null | undefined) {
  if (!value) {
    return "";
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  }).format(new Date(value));
}
