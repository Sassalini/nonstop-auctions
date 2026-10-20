"use client";
import { MAX_AUTO_RELISTINGS } from "@/lib/seller-validation";

export function RelistingControls({ prefix, limit, unlimited, onLimit, onUnlimited, disabled = false }: {
 prefix: string; limit: string; unlimited: boolean; onLimit: (value: string) => void; onUnlimited: (value: boolean) => void; disabled?: boolean;
}) {
 return <div className="mt-4 space-y-3">
  <label className="block space-y-2" htmlFor={`${prefix}-limit`}>
   <span className="text-sm font-medium text-auction-ivory">Number of automatic relistings</span>
   <input id={`${prefix}-limit`} type="number" inputMode="numeric" min={0} max={MAX_AUTO_RELISTINGS} step={1} required={!unlimited} disabled={disabled || unlimited} value={limit} onChange={event => onLimit(event.target.value)} aria-describedby={`${prefix}-help`} className="block h-11 w-full rounded-md border border-white/10 bg-black/35 px-3 text-sm text-auction-ivory outline-none focus:border-auction-gold disabled:opacity-50 sm:max-w-52" />
  </label>
  <label className="flex min-h-11 items-center gap-3 text-sm text-auction-ivory"><input type="checkbox" checked={unlimited} disabled={disabled} onChange={event => onUnlimited(event.target.checked)} className="size-4 accent-auction-gold" />Keep relisting until sold</label>
  <p id={`${prefix}-help`} className="text-xs leading-5 text-auction-muted">Relistings are additional attempts: 0 runs once; 5 allows up to 6 attempts in total. Choose 0–100, or keep relisting until sold. Unsuccessful attempts return to the back of the same room.</p>
 </div>;
}
