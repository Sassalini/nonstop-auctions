"use client";
import { useEffect, useState } from "react";
import { ListFilter } from "lucide-react";
import { Modal } from "@/components/Modal";
import { UpcomingLotCard } from "@/components/UpcomingLotCard";
import type { Lot } from "@/lib/auction-data";

export function FullCatalogue({ roomSlug, roomName, revision }: { roomSlug: string; roomName: string; revision: Lot[] }) {
 const [open, setOpen] = useState(false);
 return <>
  <button type="button" onClick={() => setOpen(true)} className="mt-4 flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-auction-gold/60 text-sm font-semibold text-auction-gold transition hover:bg-auction-gold hover:text-black"><ListFilter size={18} strokeWidth={1.8} />View Full Catalogue</button>
  {open ? <Catalogue roomSlug={roomSlug} roomName={roomName} revision={revision} onDismiss={() => setOpen(false)} /> : null}
 </>;
}
function Catalogue({ roomSlug, roomName, revision, onDismiss }: { roomSlug: string; roomName: string; revision: Lot[]; onDismiss: () => void }) {
 const [page, setPage] = useState(1), [attempt, setAttempt] = useState(0);
 const [lots, setLots] = useState<Lot[]>([]), [hasNext, setHasNext] = useState(false);
 const [loading, setLoading] = useState(true), [error, setError] = useState("");
 useEffect(() => {
  const controller = new AbortController();
  setLoading(true); setError("");
  void (async () => {
   try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomSlug)}/catalogue?page=${page}`, { cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error("Could not load the catalogue. Please retry.");
    const data: { lots: Lot[]; hasNext: boolean } = await response.json();
    if (!controller.signal.aborted) { setLots(data.lots); setHasNext(data.hasNext); }
   } catch { if (!controller.signal.aborted) setError("Could not load the catalogue. Please retry."); }
   finally { if (!controller.signal.aborted) setLoading(false); }
  })();
  return () => controller.abort();
 // Parent server refreshes already follow room Realtime/polling. Reuse them
 // only while open instead of creating another subscription or polling loop.
 }, [roomSlug, page, attempt, revision]);
 return <Modal title={`${roomName} — Full Catalogue`} closeLabel="Close catalogue" onDismiss={onDismiss}>
  <div aria-busy={loading}>
   {loading ? <p role="status" className="p-4 text-auction-muted">Loading queued lots…</p> : error ? <p role="alert" className="text-auction-gold">{error} <button type="button" onClick={() => setAttempt(attempt + 1)} className="min-h-11 underline">Retry</button></p> : !lots.length ? <p className="p-4 text-auction-muted">No queued lots in this room.</p> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{lots.map(lot => <UpcomingLotCard key={lot.id} lot={lot} onSelect={onDismiss} />)}</div>}
   <nav aria-label="Catalogue pages" className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-auction-gold">
    <button type="button" disabled={loading || page === 1} onClick={() => setPage(page - 1)} className="min-h-11 rounded-md border border-white/20 px-3 disabled:opacity-40">Previous</button>
    <span>Page {page}</span>
    <button type="button" disabled={loading || !hasNext || Boolean(error)} onClick={() => setPage(page + 1)} className="min-h-11 rounded-md border border-white/20 px-3 disabled:opacity-40">Next</button>
   </nav>
  </div>
 </Modal>;
}
