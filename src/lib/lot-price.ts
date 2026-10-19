import { formatCurrency } from "@/lib/format";
import type { Lot } from "@/lib/auction-data";
export function lotPrice(lot: Lot) {
 if (lot.auctionStatus === "SOLD") return `Sold for: ${formatCurrency(lot.winningBid ?? lot.currentBid)}`;
 if (lot.auctionStatus === "ACTIVE_BIDDING") return `Current bid: ${formatCurrency(lot.currentBid)}`;
 return `Starting bid: ${formatCurrency(lot.startingBid)}`;
}
