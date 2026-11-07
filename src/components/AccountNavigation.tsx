import Link from "next/link";

const tabs = [
  { id: "won", label: "Won Auctions", href: "/won-auctions" },
  { id: "sold", label: "Sold Auctions", href: "/my-auctions#sold-auctions" },
  { id: "messages", label: "Messages", href: "/messages" },
  { id: "addresses", label: "Delivery Addresses", href: "/account/addresses" },
] as const;

export function AccountNavigation({ current }: { current: typeof tabs[number]["id"] }) {
  return (
    <nav aria-label="My Account" className="mb-6 grid grid-cols-2 gap-2 border-b border-auction-gold/20 pb-3 sm:flex sm:flex-wrap">
      {tabs.map(tab => (
        <Link
          key={tab.id}
          href={tab.href}
          prefetch={false}
          aria-current={current === tab.id ? "page" : undefined}
          className={`flex min-h-11 items-center justify-center rounded-md border px-3 py-2 text-center text-sm text-auction-gold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-auction-gold sm:px-4 ${tab.id === "addresses" ? "sm:ml-auto" : ""} ${current === tab.id ? "border-auction-gold/40 bg-auction-gold/10" : "border-transparent hover:border-auction-gold/25 hover:bg-white/[0.04]"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
