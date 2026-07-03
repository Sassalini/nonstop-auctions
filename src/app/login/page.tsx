import Link from "next/link";
import { Gavel, KeyRound, Mail } from "lucide-react";

export default function LoginPage() {
  return (
    <main className="mx-auto grid min-h-[calc(100vh-74px)] max-w-6xl items-center gap-8 px-4 py-8 sm:px-6 lg:grid-cols-[1fr_420px] lg:px-8">
      <section className="max-w-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-auction-gold">
          Bidder Access
        </p>
        <h1 className="mt-3 text-4xl font-semibold text-auction-ivory sm:text-5xl">
          Enter the live rooms with a verified auction profile.
        </h1>
        <p className="mt-5 text-base leading-7 text-auction-muted">
          This mock login screen is ready for Supabase Auth later. For now, it keeps the premium
          account flow visible without connecting to a backend.
        </p>
      </section>

      <section className="rounded-lg border border-auction-gold/20 bg-auction-panel/95 p-5 shadow-glow sm:p-6">
        <div className="mb-6 flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-lg border border-auction-gold/30 text-auction-gold">
            <Gavel size={23} strokeWidth={1.8} />
          </span>
          <div>
            <h2 className="text-xl font-semibold text-auction-ivory">Sign in</h2>
            <p className="text-sm text-auction-muted">Nonstop Auctions account</p>
          </div>
        </div>

        <form className="space-y-4">
          <label className="block space-y-2">
            <span className="text-sm font-medium text-auction-ivory">Email</span>
            <span className="flex h-11 items-center gap-3 rounded-md border border-white/10 bg-black/35 px-3 transition focus-within:border-auction-gold">
              <Mail size={18} strokeWidth={1.8} className="text-auction-muted" />
              <input
                type="email"
                placeholder="you@example.com"
                className="min-w-0 flex-1 bg-transparent text-sm text-auction-ivory outline-none placeholder:text-auction-muted"
              />
            </span>
          </label>
          <label className="block space-y-2">
            <span className="text-sm font-medium text-auction-ivory">Password</span>
            <span className="flex h-11 items-center gap-3 rounded-md border border-white/10 bg-black/35 px-3 transition focus-within:border-auction-gold">
              <KeyRound size={18} strokeWidth={1.8} className="text-auction-muted" />
              <input
                type="password"
                placeholder="Password"
                className="min-w-0 flex-1 bg-transparent text-sm text-auction-ivory outline-none placeholder:text-auction-muted"
              />
            </span>
          </label>
          <button
            type="button"
            className="h-11 w-full rounded-md bg-auction-gold px-4 text-sm font-semibold text-black transition hover:bg-auction-goldSoft"
          >
            Sign In
          </button>
        </form>

        <p className="mt-5 text-center text-sm text-auction-muted">
          New bidder?{" "}
          <Link href="/sell" className="font-medium text-auction-gold hover:text-auction-goldSoft">
            Request access
          </Link>
        </p>
      </section>
    </main>
  );
}
