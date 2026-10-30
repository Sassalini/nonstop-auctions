import Link from "next/link";
import { AuctionLogoMark } from "@/components/AppHeader";

const policies = [
  ["Terms & Conditions", "terms-and-conditions"],
  ["Privacy Policy", "privacy-policy"],
  ["Cookie Policy", "cookie-policy"],
  ["Returns & Refunds Policy", "returns-refunds-policy"],
];
const marketplace = [["Seller Policy", "seller-policy"], ["Prohibited Items Policy", "prohibited-items-policy"]];
const linkStyle = "inline-flex min-h-11 items-center rounded-sm text-sm text-auction-ivory/80 underline-offset-4 transition hover:text-auction-gold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-auction-gold";

export function AppFooter() {
  return <footer className="mt-auto border-t border-auction-gold/25 bg-auction-black/85 backdrop-blur-md">
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr]">
        <div className="sm:col-span-2 lg:col-span-1">
          <Link href="/" prefetch={false} className={`${linkStyle} gap-3 font-semibold`}>
            <span className="text-auction-gold"><AuctionLogoMark /></span>Nonstop Auctions
          </Link>
          <p className="mt-2 max-w-sm text-sm leading-6 text-auction-ivory/70">The auction continues while the bidding continues. Discover exceptional lots and place your bid before the timer runs out.</p>
        </div>
        <nav aria-label="Policies"><h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-auction-gold">Policies</h2>
          <ul>{policies.map(([label, file]) => <li key={file}><a href={`/policies/${file}.pdf`} target="_blank" rel="noopener noreferrer" className={linkStyle}>{label}<span className="sr-only"> (PDF, opens in a new tab)</span></a></li>)}</ul>
        </nav>
        <nav aria-label="Marketplace"><h2 className="mb-2 text-xs font-semibold uppercase tracking-widest text-auction-gold">Marketplace</h2>
          <ul>{marketplace.map(([label, file]) => <li key={file}><a href={`/policies/${file}.pdf`} target="_blank" rel="noopener noreferrer" className={linkStyle}>{label}<span className="sr-only"> (PDF, opens in a new tab)</span></a></li>)}
            <li><Link href="/sell" prefetch={false} className={linkStyle}>Sell an Item</Link></li>
            <li><Link href="/my-auctions" prefetch={false} className={linkStyle}>My Auctions</Link></li>
          </ul>
        </nav>
      </div>
      <p className="mt-6 border-t border-auction-gold/15 pt-4 text-xs text-auction-ivory/65">&copy; {new Date().getFullYear()} Nonstop Auctions. All rights reserved.</p>
    </div>
  </footer>;
}
