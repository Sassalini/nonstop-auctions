import type { AuctionStatusVariant } from "@/lib/auction-lifecycle";

type AuctionStatusBadgeProps = {
  status?: AuctionStatusVariant;
  label?: string;
};

const statusStyles: Record<AuctionStatusVariant, string> = {
  active: "border-auction-danger/40 bg-auction-danger text-white shadow-[0_0_22px_rgba(255,70,63,0.24)]",
  closing: "border-auction-ember/45 bg-auction-ember/15 text-auction-ember",
  preview: "border-auction-gold/45 bg-auction-gold/10 text-auction-gold",
  sold: "border-white/10 bg-white/[0.05] text-auction-muted",
  unavailable: "border-white/10 bg-black/35 text-auction-muted",
  upcoming: "border-auction-gold/45 bg-auction-gold/10 text-auction-gold",
  waiting: "border-white/10 bg-white/[0.05] text-auction-muted",
};

const statusLabels: Record<AuctionStatusVariant, string> = {
  active: "Active",
  closing: "Open",
  preview: "Preview",
  sold: "Sold",
  unavailable: "Unavailable",
  upcoming: "Upcoming",
  waiting: "Waiting",
};

export function AuctionStatusBadge({
  status = "active",
  label,
}: AuctionStatusBadgeProps) {
  return (
    <span
      className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-bold uppercase tracking-[0.08em] ${statusStyles[status]}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label ?? statusLabels[status]}
    </span>
  );
}
