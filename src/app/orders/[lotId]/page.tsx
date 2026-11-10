import Link from "next/link";
import { notFound } from "next/navigation";
import { transactionAccount } from "@/lib/transaction-account";
import { InteriorShell } from "@/components/InteriorShell";
import { OrderManagement } from "@/components/OrderManagement";
import { formatCurrency } from "@/lib/format";
import { buyerCheckoutStatus } from "@/lib/order-checkout-status";
import { isCheckoutOrder, isUuid } from "@/lib/transactions";
export const dynamic="force-dynamic";

export default async function OrderPage({params}:{params:Promise<{lotId:string}>}){
 const {lotId}=await params;
 if(!isUuid(lotId))notFound();
 const {client,user}=await transactionAccount(`/orders/${lotId}`);
 const {data:order,error}=await client.from("fulfilment_orders").select("*").eq("lot_id",lotId).maybeSingle();
 if(error)return <InteriorShell eyebrow="Private Desk" title="Order unavailable" description="Order services are temporarily unavailable. Please check that the account migration has been applied."><Link href="/won-auctions">Return to Won Auctions</Link></InteriorShell>;
 if(!order || (user.id!==order.buyer_id && user.id!==order.seller_id))notFound();
 const buyer=user.id===order.buyer_id;
 const eligible=buyer && isCheckoutOrder(order);
 const [{data:addresses,error:addressError},{data:events},{data:history},checkout]=await Promise.all([
 buyer && (!order.terms_snapshot || (eligible && !order.fulfilment_method && order.terms_snapshot.mode!=="collection"))
  ?client.from("delivery_addresses").select("*").eq("user_id",user.id).order("is_default",{ascending:false}).limit(20):Promise.resolve({data:[],error:null}),
 client.from("fulfilment_events").select("*").eq("order_id",order.id).order("version",{ascending:false}).limit(30),
 client.rpc("completed_auctions_page_with_reference",{p_mode:buyer?"buyer":"seller",p_lot_id:lotId,p_limit:1}),
 eligible ? buyerCheckoutStatus(order) : null]);
 const checkoutBlock=buyer && !eligible && order.terms_snapshot && !["PAID","PARTIALLY_REFUNDED","REFUNDED","DISPUTED"].includes(order.payment_state)
  ? order.shipping_state==="CANCELLED" ? "Online payment is unavailable because this order was cancelled. Contact the seller if you need help."
   : order.winning_minor==null ? "Online payment is unavailable because the winning amount is missing. Contact support."
   : "This order’s payment or fulfilment status needs review before you can pay online. Contact support."
  : null;
 const price=order.winning_minor!=null ? order.winning_minor/100 : history?.[0]?.sale_price;
 return <InteriorShell eyebrow="Private Desk" title={history?.[0]?.title??"Order details"}
  description={price!=null ? `Winning bid · ${formatCurrency(price)}` : "View the winning bid in your auction history."}>
  <OrderManagement order={order} buyer={buyer} viewerId={user.id} addresses={addresses??[]} addressUnavailable={Boolean(addressError)}
   events={events??[]} checkout={checkout} checkoutBlock={checkoutBlock}/>
 </InteriorShell>;
}
