"use client";
import { useState } from "react";
import Link from "next/link";
import { Menu } from "lucide-react";

export function MobileNavigation() {
  const [open, setOpen] = useState(false);
  return <div className="lg:hidden">
    <button type="button" aria-label="Menu" aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)} className="flex size-11 items-center justify-center rounded-lg text-auction-ivory transition hover:bg-white/[0.05]"><Menu size={22} strokeWidth={1.8} /></button>
    {open ? <nav id="mobile-navigation" aria-label="Mobile navigation" className="absolute left-0 right-0 top-full border-b border-auction-gold/25 bg-auction-black p-4 shadow-glow">
      {[['/', 'Live'], ['/sell', 'Sell'], ['/my-auctions', 'My Auctions'], ['/login', 'Sign in']].map(([href, label]) => <Link key={href} href={href} onClick={() => setOpen(false)} className="block rounded-md px-3 py-3 text-sm text-auction-ivory hover:bg-white/[0.04]">{label}</Link>)}
    </nav> : null}
  </div>;
}
