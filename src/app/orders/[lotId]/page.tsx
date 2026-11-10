import Link from "next/link";
import { notFound } from "next/navigation";
import { transactionAccount } from "@/lib/transaction-account";
import { InteriorShell } from "@/components/InteriorShell";
import { OrderManagement } from "@/components/OrderManagement";
import { formatCurrency } from "@/lib/format";
import { stripeTestClients, stripeTestConfig, stripeTestOrigin } from "@/lib/stripe-test";
import { isCheckoutOrder, isUuid, type FulfilmentOrder } from "@/lib/transactions";
export const dynamic="force-dynamic";

async function checkoutAvailability(order: FulfilmentOrder, buyer: boolean) {
 if (!buyer || !isCheckoutOrder(order)) return null;
 const config = stripeTestConfig();
 if (!config || !stripeTestOrigin()) return "Online payments are currently unavailable. Stripe test checkout is disabled.";
 if (order.fulfilment_method) return null;
 const { admin } = stripeTestClients(config);
 const { data, error } = await admin.from("seller_stripe_test_accounts").select("seller_id").eq("seller_id", order.seller_id).maybeSingle();
 if (error) return "Online payments are temporarily unavailable. Please try again later.";
 return data ? null : "Online payments are unavailable until the seller sets up Stripe.";
}

export default async function OrderPage({params,searchParams}:{params:Promise<{lotId:string}>;searchParams:Promise<{checkout?:string}>}){
 const {lotId}=await params;
 if(!isUuid(lotId))notFound();
 const {client,user}=await transactionAccount(`/orders/${lotId}`);
 const {data:order,error}=await client.from("fulfilment_orders").select("*").eq("lot_id",lotId).maybeSingle();
 if(error)return <InteriorShell eyebrow="Private Desk" title="Order unavailable" description="Order services are temporarily unavailable. Please check that the account migration has been applied."><Link href="/won-auctions">Return to Won Auctions</Link></InteriorShell>;
 if(!order || (user.id!==order.buyer_id && user.id!==order.seller_id))notFound();
 const buyer=user.id===order.buyer_id;
 const [{data:addresses},{data:events},{data:history},checkoutUnavailable]=await Promise.all([
 buyer && (!order.terms_snapshot || (isCheckoutOrder(order) && !order.fulfilment_method && order.terms_snapshot.mode!=="collection"))
  ?client.from("delivery_addresses").select("*").eq("user_id",user.id).order("is_default",{ascending:false}).limit(20):Promise.resolve({data:[]}),
 client.from("fulfilment_events").select("*").eq("order_id",order.id).order("version",{ascending:false}).limit(30),
 client.rpc("completed_auctions_page_with_reference",{p_mode:buyer?"buyer":"seller",p_lot_id:lotId,p_limit:1}),
 checkoutAvailability(order,buyer)]);
 const price=order.winning_minor!=null ? order.winning_minor/100 : history?.[0]?.sale_price;
 return <InteriorShell eyebrow="Private Desk" title={history?.[0]?.title??"Order details"}
  description={price!=null ? `Winning bid · ${formatCurrency(price)}` : "View the winning bid in your auction history."}>
  <OrderManagement order={order} buyer={buyer} addresses={addresses??[]} events={events??[]}
   checkoutUnavailable={checkoutUnavailable} returned={(await searchParams).checkout==="returned"}/>
 </InteriorShell>;
}
