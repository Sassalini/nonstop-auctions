type AuctionStatusBadgeProps = {
  status?: "live" | "upcoming" | "closing" | "sold";
  label?: string;
};

const statusStyles = {
  live: "border-auction-danger/40 bg-auction-danger text-white shadow-[0_0_22px_rgba(255,70,63,0.24)]",
  upcoming: "border-auction-gold/45 bg-auction-gold/12 text-auction-gold",
  closing: "border-auction-ember/45 bg-auction-ember/15 text-auction-ember",
  sold: "border-white/10 bg-white/[0.05] text-auction-muted",
};

const statusLabels = {
  live: "Live",
  upcoming: "Upcoming",
  closing: "Closing",
  sold: "Sold",
};

export function AuctionStatusBadge({
  status = "live",
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
