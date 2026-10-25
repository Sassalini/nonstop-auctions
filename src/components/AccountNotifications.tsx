"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Bell, Check, X } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { NotificationKind, NotificationRow } from "@/lib/supabase/types";

const messages: Record<NotificationKind, string> = {
  WATCHED_LIVE: "A watched lot is now open for bidding",
  WATCHED_SOLD: "A watched lot has sold",
  WATCHED_UNSOLD: "A watched lot ended unsold",
  WON: "You won this auction",
  SELLER_LIVE: "Your listed lot is now open for bidding",
  SELLER_SOLD: "Your listed lot has sold",
  SELLER_FIRST_BID: "Your listing received its first bid",
  WATCHED_FIRST_BID: "A watched lot received its first bid",
};

export function AccountNotifications() {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [checkedAccount, setCheckedAccount] = useState(false);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const openRef = useRef(open);
  openRef.current = open;
  const container = useRef<HTMLDivElement>(null);
  const refreshRef = useRef<() => void>(() => {});
  const accountRef = useRef<string | null>(null);

  useEffect(() => {
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      setCheckedAccount(true);
      return;
    }
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    const switchAccount = (id: string | null) => {
      if (cancelled) return;
      if (accountRef.current !== id) {
        accountRef.current = id;
        setAccount(id); setItems([]); setUnread(0); setError(""); setOpen(false); setBusy(false);
      }
      setCheckedAccount(true);
    };
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      // No awaited Supabase work inside this callback (avoids auth-lock deadlocks).
      switchAccount(session?.user.id ?? null);
    });
    return () => { cancelled = true; listener.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!account) return;
    const supabase = createSupabaseBrowserClient();
    let cancelled = false;
    let request = 0;
    let pending = false;
    let trailing = false;
    const refresh = async (force = false) => {
      if (pending) { if (force) trailing = true; return; }
      pending = true;
      const version = ++request;
      try {
        const [list, count] = await Promise.all([
          openRef.current ? supabase.from("notifications").select("id,user_id,lot_id,kind,lot_title,lot_reference,auction_run,created_at,read_at").eq("user_id", account)
            .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(50) : Promise.resolve({ data: null, error: null }),
          supabase.from("notifications").select("id", { count: "exact", head: true })
            .eq("user_id", account).is("read_at", null),
        ]);
        if (cancelled || version !== request) return;
        if (list.error || count.error) throw new Error("Notifications unavailable");
        if (list.data) setItems(list.data); setUnread(count.count ?? 0); setError("");
      } catch {
        if (!cancelled && version === request) setError("Could not refresh notifications. Please try again.");
      } finally {
        pending = false;
        if (trailing && !cancelled) { trailing = false; void refresh(); }
      }
    };
    refreshRef.current = () => { void refresh(true); };
    void refresh();
    const channel = supabase.channel(`account-notifications-${account}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${account}` }, () => { void refresh(true); })
      .subscribe((status) => { if (!cancelled && status === "SUBSCRIBED") void refresh(); });
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const interval = window.setInterval(onVisible, 60000);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      cancelled = true;
      refreshRef.current = () => {};
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
      void supabase.removeChannel(channel);
    };
  }, [account]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        container.current?.querySelector<HTMLButtonElement>('button[aria-controls="account-notifications"]')?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const markRead = useCallback(async (id?: string) => {
    if (!account) return;
    setBusy(true);
    try {
      let query = createSupabaseBrowserClient().from("notifications")
        .update({ read_at: new Date().toISOString() }).eq("user_id", account).is("read_at", null);
      if (id) query = query.eq("id", id);
      const { error: updateError } = await query;
      if (accountRef.current !== account) return;
      if (updateError) setError("Could not mark notifications as read. Please try again.");
      else refreshRef.current();
    } catch { if (accountRef.current === account) setError("Could not mark notifications as read. Please try again."); }
    finally { if (accountRef.current === account) setBusy(false); }
  }, [account]);

  return <div ref={container} className="relative">
    <button type="button" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} aria-expanded={open} aria-controls="account-notifications"
      onClick={() => { openRef.current = !open; setOpen(!open); if (!open) refreshRef.current(); }}
      className="relative flex size-10 items-center justify-center rounded-lg text-auction-ivory transition hover:bg-white/[0.05]">
      <Bell size={20} strokeWidth={1.8} aria-hidden="true" />
      {unread > 0 ? <span className="absolute -right-1 top-0 min-w-4 rounded-full bg-auction-gold px-1 text-center text-[10px] font-semibold text-black">{unread > 99 ? "99+" : unread}</span> : null}
    </button>
    {open ? <section id="account-notifications" aria-label="Account notifications"
      className="fixed left-4 right-4 top-[74px] max-h-[min(70vh,560px)] overflow-y-auto rounded-lg border border-auction-gold/30 bg-auction-black/95 p-4 text-auction-ivory shadow-glow backdrop-blur-xl sm:absolute sm:left-auto sm:right-0 sm:top-full sm:mt-3 sm:w-96">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-auction-gold">Notifications</h2>
        <div className="flex items-center gap-2">
          {account && unread > 0 ? <button type="button" disabled={busy} onClick={() => { void markRead(); }} className="min-h-9 text-xs text-auction-gold disabled:opacity-50">Mark all read</button> : null}
          <button type="button" aria-label="Close notifications" onClick={() => setOpen(false)} className="flex size-9 items-center justify-center"><X size={17} /></button>
        </div>
      </div>
      {!checkedAccount ? <p className="text-sm text-auction-muted">Checking your account…</p> : !account ? <p className="text-sm text-auction-muted"><Link href="/login" onClick={() => setOpen(false)} className="text-auction-gold underline">Sign in</Link> to view your notifications.</p> : <>
        {error ? <p role="status" className="mb-3 text-xs text-auction-gold">{error} <button type="button" onClick={() => refreshRef.current()} className="underline">Retry</button></p> : null}
        {!items.length && !error ? <p className="text-sm text-auction-muted">No notifications yet.</p> : null}
        <ul className="divide-y divide-white/10">
          {items.map((item) => <li key={item.id} className={`flex gap-2 py-3 ${item.read_at ? "opacity-70" : ""}`}>
            <Link href={item.kind === "WON" ? `/won-auctions?lot=${item.lot_id}#${item.lot_id}` : item.kind === "SELLER_SOLD" ? `/my-auctions?lot=${item.lot_id}#${item.lot_id}` : `/lots/${item.lot_id}?view=manual`} prefetch={false} onClick={() => { setOpen(false); if (!item.read_at) void markRead(item.id); }} className="min-w-0 flex-1 rounded-sm focus-visible:outline-auction-gold">
              <p className={`text-sm ${item.read_at ? "text-auction-ivory" : "text-auction-gold"}`}>{messages[item.kind]}</p>
              <p className="mt-1 text-xs text-auction-muted">Lot {item.lot_reference}</p>
              <p className="mt-1 break-words text-xs text-auction-muted">{item.lot_title}</p>
              <time className="mt-1 block text-[11px] text-auction-muted" dateTime={item.created_at}>{new Date(item.created_at).toLocaleString("en-GB")}</time>
            </Link>
            {!item.read_at ? <button type="button" aria-label={`Mark notification for ${item.lot_title} as read`} disabled={busy} onClick={() => { void markRead(item.id); }} className="flex size-9 shrink-0 items-center justify-center rounded-md text-auction-gold hover:bg-white/[0.04] disabled:opacity-50"><Check size={16} /></button> : null}
          </li>)}
        </ul>
        {items.length === 50 ? <p className="mt-3 text-xs text-auction-muted">Showing your latest 50 notifications.</p> : null}
      </>}
    </section> : null}
  </div>;
}
