"use client";
import Link from "next/link";
import { useEffect,useState } from "react";
import { useRouter } from "next/navigation";
import type { Conversation,PrivateMessage } from "@/lib/transactions";
import { transactionAction } from "@/app/transaction-actions";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { buttonStyle,inputStyle,TransactionButton } from "./TransactionControls";
export function MessageThread({conversation,userId,messages,hasOlder}:{conversation:Conversation;userId:string;messages:PrivateMessage[];hasOlder:boolean}){
 const router=useRouter();const [body,setBody]=useState("");const [reason,setReason]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [key,setKey]=useState(()=>crypto.randomUUID());
 const newest=messages[messages.length-1]?.id;
 useEffect(()=>{if(newest)void transactionAction("read",{conversation:conversation.id}).then(result=>{if(!result.error)router.refresh();});},[conversation.id,newest,router]);
 useEffect(()=>{const client=createSupabaseBrowserClient();let timer:ReturnType<typeof setTimeout>|undefined;
 const channel=client.channel(`private-thread-${conversation.id}`).on("postgres_changes",{event:"INSERT",schema:"public",table:"private_messages",filter:`conversation_id=eq.${conversation.id}`},()=>{clearTimeout(timer);timer=setTimeout(()=>router.refresh(),300);}).subscribe();

 const visible=()=>{if(document.visibilityState==="visible")router.refresh();};document.addEventListener("visibilitychange",visible);
 return()=>{clearTimeout(timer);document.removeEventListener("visibilitychange",visible);void client.removeChannel(channel);};
 },[conversation.id,router]);
 return <section className="premium-card min-w-0 space-y-4 rounded-lg p-5" aria-label="Message thread"><div className="flex flex-wrap gap-3"><Link className={buttonStyle} href={`/lots/${conversation.lot_id}?view=manual`}>View listing</Link><TransactionButton action="block" payload={{conversation:conversation.id}}>Block contact</TransactionButton><TransactionButton action="unblock" payload={{conversation:conversation.id}}>Unblock</TransactionButton></div>
 {hasOlder&&messages[0]?<Link className="text-auction-gold underline" href={`/messages?conversation=${conversation.id}&before=${encodeURIComponent(messages[0].created_at)}&beforeId=${messages[0].id}`}>Older messages</Link>:null}<Link className="ml-3 text-auction-gold underline" href={`/messages?conversation=${conversation.id}`}>Latest messages</Link>
 <ol className="space-y-4">{messages.map(m=><li key={m.id} className="rounded border border-white/10 p-3"><p className="text-xs text-auction-gold">{m.sender_id===userId?"You":conversation.buyer_id===m.sender_id?"Buyer":"Seller"} · {new Date(m.created_at).toLocaleString("en-GB")}</p><p className="mt-2 whitespace-pre-wrap break-words text-sm">{m.body}</p>{!m.deleted_at?<details className="mt-2 text-xs text-auction-muted"><summary className="cursor-pointer">Message actions</summary><label className="mt-2 block">Report reason<input maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} className={inputStyle}/></label><TransactionButton action="report_message" payload={{conversation:conversation.id,message:m.id,reason}}>Report message</TransactionButton>{m.sender_id===userId?<TransactionButton action="delete_message" payload={{conversation:conversation.id,message:m.id}}>Delete non-transaction message</TransactionButton>:null}</details>:null}</li>)}</ol>
 <form className="space-y-3" onSubmit={async e=>{e.preventDefault();setBusy(true);const r=await transactionAction("send",{conversation:conversation.id,body,key});setBusy(false);setError(r.error??"");if(!r.error){setBody("");setKey(crypto.randomUUID());router.refresh();}}}><label className="block text-sm">Message<textarea required maxLength={2000} rows={4} className={`${inputStyle} mt-2`} value={body} onChange={e=>setBody(e.target.value)}/></label><p className="text-xs text-auction-muted">{body.length}/2000 · Text only. Do not share payment credentials.</p><button disabled={busy} className={buttonStyle}>Send message</button>{error?<p role="alert" className="text-red-300">{error}</p>:null}</form></section>;
}



