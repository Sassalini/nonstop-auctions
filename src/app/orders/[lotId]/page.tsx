import Link from "next/link";
import { notFound } from "next/navigation";
import { transactionAccount } from "@/lib/transaction-account";
import { InteriorShell } from "@/components/InteriorShell";
import { OrderManagement } from "@/components/OrderManagement";
export const dynamic="force-dynamic";
export default async function OrderPage({params}:{params:Promise<{lotId:string}>}){
 const {client,user}=await transactionAccount("/won-auctions"); const {lotId}=await params;
 if(!/^[\da-f-]{36}$/i.test(lotId))notFound();
 const {data:order,error}=await client.from("fulfilment_orders").select("*").eq("lot_id",lotId).maybeSingle();
 if(error)return <InteriorShell eyebrow="Private Desk" title="Order unavailable" description="Order services are temporarily unavailable. Please check that the account migration has been applied."><Link href="/won-auctions">Return to Won Auctions</Link></InteriorShell>;
 if(!order)notFound();
 const [{data:addresses},{data:events},{data:history}]=await Promise.all([
 user.id===order.buyer_id?client.from("delivery_addresses").select("*").order("is_default",{ascending:false}).limit(20):Promise.resolve({data:[]}),
 client.from("fulfilment_events").select("*").eq("order_id",order.id).order("version",{ascending:false}).limit(30),
 client.rpc("completed_auctions_page_with_reference",{p_mode:user.id===order.buyer_id?"buyer":"seller",p_lot_id:lotId,p_limit:1})]);
 return <InteriorShell eyebrow="Private Desk" title={history?.[0]?.title??"Order details"} description={`Winning price: ${history?.[0]?.sale_price??"See auction result"} · Payment not recorded. Shipping updates do not confirm payment.`}><OrderManagement order={order} buyer={user.id===order.buyer_id} addresses={addresses??[]} events={events??[]}/></InteriorShell>;
}
