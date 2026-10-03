"use client";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setMessage("");
    if (password !== confirmation) { setMessage("Passwords do not match."); return; }
    setBusy(true);
    try {
      const supabase = createSupabaseBrowserClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMessage("Open the reset link from your email to continue."); return; }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) { setMessage(error.message); return; }
      await supabase.auth.signOut();
      router.replace("/login"); router.refresh();
    } catch { setMessage("Could not update your password. Please request a new reset link."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="mx-auto max-w-md space-y-4 rounded-lg border border-auction-gold/20 bg-auction-panel/95 p-6 shadow-glow">
    <h1 className="text-2xl font-semibold text-auction-ivory">Choose a new password</h1>
    <p className="text-sm text-auction-muted">Use at least eight characters.</p>
    {[{ label: "New password", value: password, set: setPassword }, { label: "Confirm password", value: confirmation, set: setConfirmation }].map(field => <label key={field.label} className="block space-y-2"><span className="text-sm text-auction-ivory">{field.label}</span><input type="password" required minLength={8} autoComplete="new-password" value={field.value} onChange={e => field.set(e.target.value)} className="h-11 w-full rounded-md border border-white/10 bg-black/35 px-3 text-auction-ivory outline-none focus:border-auction-gold" /></label>)}
    <button type="submit" disabled={busy} className="h-11 w-full rounded-md bg-auction-gold text-sm font-semibold text-black disabled:opacity-50">{busy ? "Updating password" : "Update password"}</button>
    {message ? <p role="status" className="text-sm text-auction-goldSoft">{message}</p> : null}
  </form>;
}
