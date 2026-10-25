"use client";
import { useMemo, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import type { Lot } from "@/lib/auction-data";

export function LotImageGallery({ lot }: { lot: Lot }) {
 return <Gallery key={lot.id} lot={lot} />;
}
function Gallery({ lot }: { lot: Lot }) {
 const images = useMemo(() => Array.from(new Set(lot.galleryImageUrls?.length ? lot.galleryImageUrls : [lot.imageUrl])), [lot.galleryImageUrls, lot.imageUrl]);
 const [selectedIndex, setSelectedIndex] = useState(0);
 const [expanded, setExpanded] = useState(false);
 const index = Math.min(selectedIndex, images.length - 1);
 const selected = images[index];
 const move = (direction: number) => setSelectedIndex(current => (current + direction + images.length) % images.length);
 const keys: React.KeyboardEventHandler = event => {
  if (images.length < 2) return;
  if (event.key === "ArrowLeft" || event.key === "ArrowRight") { event.preventDefault(); move(event.key === "ArrowLeft" ? -1 : 1); }
 };
 const arrows = (viewer = false) => images.length > 1 ? <>
  <button type="button" aria-label={viewer ? "Previous enlarged photograph" : "Previous photograph"} onClick={() => move(-1)} className="absolute left-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md border border-white/20 bg-black/80 text-auction-ivory hover:border-auction-gold"><ChevronLeft /></button>
  <button type="button" aria-label={viewer ? "Next enlarged photograph" : "Next photograph"} onClick={() => move(1)} className="absolute right-3 top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-md border border-white/20 bg-black/80 text-auction-ivory hover:border-auction-gold"><ChevronRight /></button>
 </> : null;
 return <div className="space-y-3" onKeyDown={keys}>
  <div className="relative overflow-hidden rounded-lg border border-white/10 bg-black">
   <div className="relative aspect-[16/10] min-h-[330px] sm:aspect-[16/9] lg:min-h-[470px]">
    <Image data-testid="main-lot-image" src={selected} alt={lot.title} fill priority sizes="(max-width: 1024px) 100vw, 60vw" className="h-full w-full object-cover" />
   </div>
   <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/10" />
   {arrows()}
   <button type="button" title="Fullscreen" aria-label="Open full-size image" onClick={() => setExpanded(true)} className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-lg bg-black/70 text-auction-ivory backdrop-blur transition hover:bg-auction-gold hover:text-black"><Maximize2 size={20} strokeWidth={1.8} /></button>
   <p aria-live="polite" className="absolute bottom-3 left-3 rounded bg-black/80 px-2 py-1 text-xs text-auction-ivory">Photograph {index + 1} of {images.length}</p>
  </div>
  {images.length > 1 ? <div className="grid grid-cols-4 gap-2 sm:grid-cols-5">
   {images.map((url, photoIndex) => <button key={url} type="button" aria-label={`Show photograph ${photoIndex + 1}`} aria-pressed={index === photoIndex} onClick={() => setSelectedIndex(photoIndex)} className={`relative aspect-[4/3] overflow-hidden rounded-md border transition ${index === photoIndex ? "border-auction-gold shadow-glow" : "border-white/10 hover:border-auction-gold/50"}`}>
    <Image src={url} alt={`${lot.title} view ${photoIndex + 1}`} fill sizes="120px" className="object-cover" />
   </button>)}
  </div> : null}
  {expanded ? <Modal title={`${lot.title} — photograph ${index + 1} of ${images.length}`} closeLabel="Close image viewer" onDismiss={() => setExpanded(false)} onKeyDown={event => { event.stopPropagation(); keys(event); }}>
   <div className="relative h-[70dvh] min-h-40 w-full">
    <Image src={selected} alt={`${lot.title} full-size photograph ${index + 1}`} fill sizes="100vw" className="object-contain" />
    {arrows(true)}
   </div>
  </Modal> : null}
 </div>;
}
