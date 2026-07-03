import Link from "next/link";
import {
  Bell,
  Gavel,
  Menu,
  Search,
  Star,
  UserCircle,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Live" },
  { href: "/sell", label: "Sell" },
  { href: "/my-auctions", label: "My Auctions" },
];

export function AppHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-auction-line/80 bg-auction-black/92 backdrop-blur-xl">
      <div className="mx-auto flex min-h-[74px] max-w-[1880px] items-center gap-3 px-4 sm:px-5 lg:px-7">
        <Link href="/" className="flex shrink-0 items-center gap-3 text-auction-ivory">
          <span className="flex size-10 items-center justify-center rounded-lg border border-auction-gold/30 bg-auction-panel text-auction-gold">
            <Gavel size={22} strokeWidth={1.8} />
          </span>
          <span className="hidden text-sm font-semibold uppercase tracking-[0.18em] sm:block">
            Nonstop Auctions
          </span>
        </Link>

        <nav className="hidden items-center gap-1 lg:flex">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="whitespace-nowrap rounded-md px-3 py-2 text-sm text-auction-muted transition hover:bg-white/[0.04] hover:text-auction-ivory"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <form className="mx-auto hidden w-full max-w-2xl items-center md:flex">
          <label htmlFor="auction-search" className="sr-only">
            Search lots
          </label>
          <div className="flex h-11 w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-4 text-auction-muted shadow-inner shadow-black/30 transition focus-within:border-auction-gold/60">
            <Search size={19} strokeWidth={1.8} />
            <input
              id="auction-search"
              type="search"
              placeholder="Search lots, categories, and more..."
              className="h-full min-w-0 flex-1 bg-transparent text-sm text-auction-ivory outline-none placeholder:text-auction-muted"
            />
          </div>
        </form>

        <div className="ml-auto flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            title="Notifications"
            className="relative hidden size-10 items-center justify-center rounded-lg text-auction-ivory transition hover:bg-white/[0.05] md:flex"
          >
            <Bell size={20} strokeWidth={1.8} />
            <span className="absolute right-2.5 top-2.5 size-2 rounded-full bg-auction-danger" />
          </button>
          <Link
            href="/my-auctions"
            title="Watchlist"
            className="hidden size-10 items-center justify-center rounded-lg text-auction-ivory transition hover:bg-white/[0.05] md:flex"
          >
            <Star size={20} strokeWidth={1.8} />
          </Link>
          <Link
            href="/login"
            className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-2.5 py-2 text-sm text-auction-ivory transition hover:border-auction-gold/40"
          >
            <UserCircle size={22} strokeWidth={1.8} />
            <span className="hidden sm:inline">John Doe</span>
          </Link>
          <button
            type="button"
            title="Menu"
            className="flex size-10 items-center justify-center rounded-lg text-auction-ivory transition hover:bg-white/[0.05] lg:hidden"
          >
            <Menu size={22} strokeWidth={1.8} />
          </button>
        </div>
      </div>
    </header>
  );
}
