"use client";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Native modal dialogs provide focus trapping and make the background inert.
export function Modal({ title, closeLabel, onDismiss, children, onKeyDown }: {
 title: string; closeLabel: string; onDismiss: () => void; children: React.ReactNode;
 onKeyDown?: React.KeyboardEventHandler<HTMLDialogElement>;
}) {
 const dialog = useRef<HTMLDialogElement>(null);
 const close = useRef<HTMLButtonElement>(null);
 const labelId = useId();
 useEffect(() => {
  const node = dialog.current;
  const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const overflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  node?.showModal(); close.current?.focus({ preventScroll: true });
  return () => { node?.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus({ preventScroll: true }); };
 }, []);
 return createPortal(<dialog ref={dialog} aria-labelledby={labelId} aria-modal="true" onCancel={event => { event.preventDefault(); onDismiss(); }} onKeyDown={event => {
   onKeyDown?.(event);
   if (event.key !== "Tab" || event.defaultPrevented) return;
   const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')).filter(node => node.getClientRects().length > 0);
   const first = controls[0], last = controls.at(-1);
   if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
   else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }}
  onClick={event => { if (event.target === event.currentTarget) onDismiss(); }}
  className="fixed inset-0 m-auto max-h-[92dvh] w-[calc(100%_-_2rem)] max-w-6xl overflow-hidden rounded-lg border border-auction-gold/40 bg-auction-black p-0 text-auction-ivory shadow-glow backdrop:bg-black/80">
  <div className="flex max-h-[92dvh] flex-col">
   <header className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
    <h2 id={labelId} className="min-w-0 break-words text-base font-semibold text-auction-gold">{title}</h2>
    <button ref={close} type="button" aria-label={closeLabel} onClick={onDismiss} className="flex size-11 shrink-0 items-center justify-center rounded-md border border-white/10 hover:border-auction-gold"><X size={22} /></button>
   </header>
   <div className="min-h-0 overflow-y-auto overscroll-contain p-4">{children}</div>
  </div>
 </dialog>, document.body);
}
