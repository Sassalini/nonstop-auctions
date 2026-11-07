import Link from "next/link";
import { AuctionLogoMark } from "@/components/AppHeader";

const policies = [
  ["Terms & Conditions", "terms-and-conditions"],
  ["Privacy Policy", "privacy-policy"],
  ["Cookie Policy", "cookie-policy"],
  ["Returns & Refunds Policy", "returns-refunds-policy"],
  ["Seller Policy", "seller-policy"],
  ["Prohibited Items Policy", "prohibited-items-policy"],
];
const linkStyle = "inline-flex min-h-11 items-center rounded-sm text-sm text-auction-ivory/80 underline-offset-4 transition hover:text-auction-gold hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-auction-gold";

export function AppFooter() {
  return <footer className="mt-auto border-t border-auction-gold/25 bg-auction-black/85 backdrop-blur-md">
    <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6 lg:px-8">
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_1.4fr] lg:gap-10">
        <div>
          <Link href="/" prefetch={false} className={`${linkStyle} gap-3 font-semibold`}>
            <span className="text-auction-gold"><AuctionLogoMark /></span>Nonstop Auctions
          </Link>
          <p className="mt-1 max-w-sm text-sm leading-5 text-auction-ivory/70">The auction continues while the bidding continues. Discover exceptional lots and place your bid before the timer runs out.</p>
        </div>
        <nav aria-label="Policies"><h2 className="sr-only">Policies</h2>
          <ul className="grid grid-cols-2 gap-x-4">{policies.map(([label, file]) => <li key={file}><a href={`/policies/${file}.pdf`} target="_blank" rel="noopener noreferrer" className={linkStyle}>{label}<span className="sr-only"> (PDF, opens in a new tab)</span></a></li>)}</ul>
        </nav>
      </div>
      <p className="mt-3 border-t border-auction-gold/15 pt-3 text-xs text-auction-ivory/65">&copy; {new Date().getFullYear()} Nonstop Auctions. All rights reserved.</p>
    </div>
  </footer>;
}
