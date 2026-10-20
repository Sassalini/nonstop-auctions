"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { parseRelistingLimit } from "@/lib/seller-validation";
import { RelistingControls } from "@/components/RelistingControls";
import { formatShortDateTime, isTimedLifecycleStatus } from "@/lib/auction-lifecycle";
import type { LotRow } from "@/lib/supabase/types";

export type ManagedListing = Pick<LotRow, "id" | "status" | "relist_unlimited" | "max_auto_relistings" | "auto_relistings_used" | "completed_attempts" | "final_unsold_at" | "removal_requested_at" | "removed_at" | "pending_relist_unlimited" | "pending_max_auto_relistings">;
export function SellerListingManagement({ lot }: { lot: ManagedListing }) {
 const router = useRouter();
 const [expanded, setExpanded] = useState(false);
 const [confirming, setConfirming] = useState(false);
 const [limit, setLimit] = useState(String(lot.pending_max_auto_relistings ?? lot.max_auto_relistings ?? 5));
 const [unlimited, setUnlimited] = useState(lot.pending_relist_unlimited ?? lot.relist_unlimited ?? false);
 const [busy, setBusy] = useState(false);
 const [message, setMessage] = useState("");
 const working = useRef(false);
 const active = isTimedLifecycleStatus(lot.status);
 const pending = Boolean(lot.removal_requested_at) && active;
 async function manage(action: "save" | "remove" | "stop") {
  if (working.current) return;
  const retries = action === "stop" ? 0 : unlimited ? parseRelistingLimit(limit) ?? 5 : parseRelistingLimit(limit);
  if (action === "save" && retries === null) { setMessage("Automatic relistings must be a whole number from 0 to 100."); return; }
  working.current = true; setBusy(true); setMessage("");
  try {
   const { data, error } = await createSupabaseBrowserClient().rpc("manage_seller_listing", {
    p_lot_id: lot.id, p_remove: action === "remove", p_relist_unlimited: action === "stop" ? false : unlimited, p_max_auto_relistings: retries ?? 5,
   });
   if (error) throw error;
   setConfirming(false);
   if (action === "stop") { setLimit("0"); setUnlimited(false); }
   setMessage(data.status === "CANCELLED" ? "Listing removed. Its history has been kept." : data.removal_requested_at ? "Removal requested. The current auction will finish; a valid winning bid will still result in a sale." : active ? "Saved for after the current auction attempt." : data.status === "EXPIRED" ? "Future relistings stopped." : "Relisting settings saved.");
   router.refresh();
  } catch (error) { setMessage(error && typeof error === "object" && "message" in error ? String(error.message) : "Could not update this listing. Please retry."); }
  finally { working.current = false; setBusy(false); }
 }
 if (lot.status === "CANCELLED") return <p className="mt-2 text-sm text-auction-muted">Listing removed{lot.removed_at ? ` · ${formatShortDateTime(lot.removed_at)}` : ""}. History retained.</p>;
 return <div className="mt-3 text-sm">
  <p className="text-xs leading-5 text-auction-muted">{lot.completed_attempts ?? 0} completed attempts · {lot.auto_relistings_used ?? 0} automatic relistings scheduled · {lot.relist_unlimited ? "Until sold" : `Up to ${lot.max_auto_relistings ?? 5} additional relistings`}</p>
  {lot.status === "EXPIRED" ? <p className="mt-2 text-auction-muted">Relistings finished{lot.final_unsold_at ? ` · ${formatShortDateTime(lot.final_unsold_at)}` : ""}. Increase the limit or enable unlimited relisting to return to the queue.</p> : null}
  {lot.pending_relist_unlimited !== null && lot.pending_relist_unlimited !== undefined ? <p className="mt-2 text-auction-gold">After this attempt: {lot.pending_relist_unlimited ? "keep relisting until sold" : `up to ${lot.pending_max_auto_relistings} additional relistings in total`}.</p> : null}
  {pending ? <p role="status" className="mt-2 text-auction-gold">Removal pending. The current auction will finish; accepted bids remain valid.</p> : <>
   <div className="mt-3 flex flex-wrap gap-4 text-auction-gold">
    <button type="button" disabled={busy} onClick={() => setExpanded(!expanded)} className="min-h-11 underline">{expanded ? "Close relisting settings" : "Manage relistings"}</button>
    <button type="button" disabled={busy} onClick={() => void manage("stop")} className="min-h-11 underline">Stop future relistings</button>
    <button type="button" disabled={busy} onClick={() => setConfirming(!confirming)} className="min-h-11 underline">{confirming ? "Keep listing" : "Remove Listing"}</button>
   </div>
   {expanded ? <form onSubmit={event => { event.preventDefault(); void manage("save"); }} className="mt-3 rounded-md border border-white/10 p-4">
    <RelistingControls prefix={`manage-${lot.id}`} limit={limit} unlimited={unlimited} onLimit={setLimit} onUnlimited={setUnlimited} disabled={busy} />
    <p className="mt-3 text-xs leading-5 text-auction-muted">The limit is the total additional relistings allowed, including those already scheduled. {active ? "Changes apply after the current attempt; accepted bids and deadlines stay unchanged." : "Raising an exhausted listing's limit can return it to the queue."}</p>
    <button type="submit" disabled={busy} className="mt-3 min-h-11 rounded-md border border-auction-gold/50 px-4 text-auction-gold disabled:opacity-50">Save relisting settings</button>
   </form> : null}
   {confirming ? <div role="group" aria-label="Confirm listing removal" className="mt-3 rounded-md border border-auction-gold/30 p-4">
    <p className="text-auction-muted">Remove this listing? {active ? "The current auction will finish. It will still sell if there is a valid winning bid." : "It will leave the queue."} Auction history will be kept.</p>
    <button type="button" disabled={busy} onClick={() => void manage("remove")} className="mt-3 min-h-11 rounded-md border border-auction-gold/50 px-4 text-auction-gold">Confirm removal</button>
   </div> : null}
  </>}
  {message ? <p role="status" className="mt-3 text-auction-gold">{message}</p> : null}
 </div>;
}
