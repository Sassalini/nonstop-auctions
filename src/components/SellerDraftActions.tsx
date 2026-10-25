"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { PHOTO_BUCKET } from "@/lib/seller-validation";

export function SellerDraftActions({ lotId, submissionKey }: { lotId: string; submissionKey: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const working = useRef(false);
  async function discard() {
    if (working.current) return;
    working.current = true; setBusy(true); setMessage("");
    try {
      const client = createSupabaseBrowserClient();
      const images = await client.from("lot_images").select("storage_path,thumbnail_path,display_path").eq("lot_id", lotId);
      if (images.error) throw images.error;
      const paths = (images.data ?? []).flatMap(image => [image.storage_path, image.thumbnail_path, image.display_path].filter((path): path is string => Boolean(path)));
      if (paths.length) { const removed = await client.storage.from(PHOTO_BUCKET).remove(paths); if (removed.error) throw removed.error; }
      const removed = await client.rpc("discard_seller_draft", { p_lot_id: lotId });
      if (removed.error) throw removed.error;
      const { data: { user } } = await client.auth.getUser();
      if (user) {
        const key = `nonstop-seller-submission:${user.id}`;
        if (sessionStorage.getItem(key) === submissionKey) sessionStorage.removeItem(key);
      }
      router.refresh();
    } catch { setMessage("Could not discard this submission. Retry to finish removing its photos and draft."); }
    finally { working.current = false; setBusy(false); }
  }
  return <div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-auction-gold">
    <Link href={`/sell?draft=${lotId}`} className="underline">Resume submission</Link>
    <button type="button" disabled={busy} onClick={() => setConfirming(!confirming)} className="underline">{confirming ? "Keep draft" : "Discard draft"}</button>
    {confirming ? <button type="button" disabled={busy} onClick={() => void discard()} className="rounded border border-auction-gold/40 px-3 py-2">{busy ? "Removing…" : "Confirm discard draft and photos"}</button> : null}
    {message ? <p role="status" className="w-full text-auction-ember">{message}</p> : null}
  </div>;
}
