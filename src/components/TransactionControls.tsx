"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { transactionAction } from "@/app/transaction-actions";
import type { Json } from "@/lib/supabase/types";
export const inputStyle = "w-full rounded border border-white/20 bg-black/40 p-3 text-auction-ivory focus-visible:outline-auction-gold";
export const buttonStyle = "min-h-11 rounded border border-auction-gold/40 px-4 py-2 text-sm text-auction-gold hover:bg-auction-gold/10 focus-visible:outline-auction-gold disabled:opacity-50";
export function TransactionButton({ action, payload, children }: { action: string; payload: Json; children: React.ReactNode }) {
 const router=useRouter(); const [busy,setBusy]=useState(false); const [error,setError]=useState("");
 return <span><button className={buttonStyle} disabled={busy} onClick={async()=>{setBusy(true);const result=await transactionAction(action,payload);setBusy(false);setError(result.error??"");if(!result.error){if(action==="conversation")router.push(`/messages?conversation=${result.data}`);else router.refresh();}}}>{children}</button>{error?<span role="alert" className="block text-sm text-red-300">{error}</span>:null}</span>;
}
