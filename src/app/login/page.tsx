import { AuthForm } from "@/components/AuthForm";

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
          Sign in or create an account to follow your watched lots and bid in the live rooms.
          Confirm your email before placing your first bid.
        </p>
      </section>

      <AuthForm />
    </main>
  );
}
