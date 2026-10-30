import Link from "next/link";
import { transactionAccount } from "@/lib/transaction-account";
import { InteriorShell } from "@/components/InteriorShell";
import { MessageThread } from "@/components/MessageThread";
export const dynamic="force-dynamic";
export default async function MessagesPage({searchParams}:{searchParams:Promise<{conversation?:string;before?:string;beforeId?:string;page?:string}>}){
 const {client,user}=await transactionAccount("/messages"); const params=await searchParams;
 const page=Math.max(1,Math.min(1000,Number(params.page)||1));
 const {data:conversations,error}=await client.from("conversations").select("*").order("created_at",{ascending:false}).range((page-1)*20,page*20);
 const selected=params.conversation&&/^[\da-f-]{36}$/i.test(params.conversation)?params.conversation:null;
 const {data:conversation}=selected?await client.from("conversations").select("*").eq("id",selected).maybeSingle():{data:null};
 let query=client.from("private_messages").select("*").eq("conversation_id",conversation?.id??"00000000-0000-0000-0000-000000000000").order("created_at",{ascending:false}).order("id",{ascending:false}).limit(31);
 if(params.before&&!Number.isNaN(Date.parse(params.before))&&params.beforeId&&/^[\da-f-]{36}$/i.test(params.beforeId)){const stamp=new Date(params.before).toISOString();query=query.or(`created_at.lt.${stamp},and(created_at.eq.${stamp},id.lt.${params.beforeId})`);}
 const {data:history}=conversation?await query:{data:[]};
 const {data:unread}=await client.rpc("unread_message_count");
 return <InteriorShell eyebrow="Private Desk" title={`Messages${unread?` (${unread} unread)`:""}`} description="Private text conversations about listings and orders. Report abusive contact; blocking does not interrupt an active transaction.">
 {error?<p role="alert">Messages unavailable. Apply the account migration before using this feature.</p>:<div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]"><nav aria-label="Conversations" className="premium-card rounded-lg p-4"><ul className="space-y-3">{conversations?.slice(0,20).map(c=><li key={c.id}><Link prefetch={false} href={`/messages?conversation=${c.id}`} className="block break-words rounded p-2 text-sm text-auction-gold hover:bg-white/5 focus-visible:outline-auction-gold">Listing conversation · {c.lot_id.slice(-6)}<span className="block text-xs text-auction-muted">{user.id===c.buyer_id?"With seller":"With buyer"}</span></Link></li>)}</ul>{!conversations?.length?<p>No conversations yet. Open a listing to contact its seller.</p>:null}<div className="mt-4 flex gap-4 text-auction-gold">{page>1?<Link href={`/messages?page=${page-1}`}>Previous</Link>:null}{(conversations?.length??0)>20?<Link href={`/messages?page=${page+1}`}>Next</Link>:null}</div></nav>
 {conversation?<MessageThread key={conversation.id} conversation={conversation} userId={user.id} messages={(history??[]).slice(0,30).reverse()} hasOlder={(history?.length??0)>30}/>:<p>Select a conversation.</p>}</div>}
 </InteriorShell>;
}


