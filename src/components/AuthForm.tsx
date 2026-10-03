"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Gavel, KeyRound, Mail } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { safeReturnPath } from "@/lib/auth-navigation";

export function AuthForm() {
  const [signup, setSignup] = useState(false);
  const [resetMode, setResetMode] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const supabase = createSupabaseBrowserClient();
      const params = new URLSearchParams(window.location.search);
      const next = safeReturnPath(params.get("next"));
      if (resetMode) {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
        });
        setMessage(error ? "Could not request a reset link. Please try again later." : "If an account exists for this email, a password reset link will arrive shortly.");
        return;
      }
      const { data, error } = signup
        ? await supabase.auth.signUp({ email, password, options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        } })
        : await supabase.auth.signInWithPassword({ email, password });
      if (error) { setMessage(error.message); return; }
      if (!data.session) {
        setMessage("Check your email to confirm your account, then sign in.");
        return;
      }
      router.replace(next); router.refresh();
    } catch { setMessage("Sign-in is temporarily unavailable. Please try again later."); }
    finally { setBusy(false); }
  }
  return (
    <section className="rounded-lg border border-auction-gold/20 bg-auction-panel/95 p-5 shadow-glow sm:p-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-11 items-center justify-center rounded-lg border border-auction-gold/30 text-auction-gold"><Gavel size={23} strokeWidth={1.8} /></span>
        <div><h2 className="text-xl font-semibold text-auction-ivory">{resetMode ? "Reset password" : signup ? "Create account" : "Sign in"}</h2><p className="text-sm text-auction-muted">Nonstop Auctions account</p></div>
      </div>
      <form onSubmit={submit} className="space-y-4">
        <label className="block space-y-2">
          <span className="text-sm font-medium text-auction-ivory">Email</span>
          <span className="flex h-11 items-center gap-3 rounded-md border border-white/10 bg-black/35 px-3 transition focus-within:border-auction-gold">
            <Mail size={18} className="text-auction-muted" />
            <input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" className="min-w-0 flex-1 bg-transparent text-sm text-auction-ivory outline-none placeholder:text-auction-muted" />
          </span>
        </label>
        {!resetMode ? <label className="block space-y-2">
          <span className="text-sm font-medium text-auction-ivory">Password</span>
          <span className="flex h-11 items-center gap-3 rounded-md border border-white/10 bg-black/35 px-3 transition focus-within:border-auction-gold">
            <KeyRound size={18} className="text-auction-muted" />
            <input type="password" required minLength={signup ? 8 : undefined} autoComplete={signup ? "new-password" : "current-password"} value={password} onChange={e => setPassword(e.target.value)} placeholder="Password" className="min-w-0 flex-1 bg-transparent text-sm text-auction-ivory outline-none placeholder:text-auction-muted" />
          </span>
        </label> : null}
        <button type="submit" disabled={busy} className="h-11 w-full rounded-md bg-auction-gold px-4 text-sm font-semibold text-black transition hover:bg-auction-goldSoft disabled:opacity-50">{busy ? "Please wait" : resetMode ? "Send reset link" : signup ? "Create account" : "Sign In"}</button>
        {message ? <p role="status" className="text-sm leading-6 text-auction-goldSoft">{message}</p> : null}
      </form>
      <p className="mt-5 text-center text-sm text-auction-muted">{resetMode || signup ? "Already registered? " : "New bidder? "}<button type="button" onClick={() => { setSignup(resetMode ? false : !signup); setResetMode(false); setMessage(""); }} className="font-medium text-auction-gold hover:text-auction-goldSoft">{resetMode || signup ? "Sign in" : "Create account"}</button></p>
      {!signup && !resetMode ? <button type="button" onClick={() => { setResetMode(true); setMessage(""); }} className="mt-3 block w-full text-center text-sm text-auction-gold">Forgot password?</button> : null}
    </section>
  );
}
