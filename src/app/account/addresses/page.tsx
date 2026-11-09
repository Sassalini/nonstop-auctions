import { transactionAccount } from "@/lib/transaction-account";
import { InteriorShell } from "@/components/InteriorShell";
import { AddressBook } from "@/components/AddressBook";
import { AccountNavigation } from "@/components/AccountNavigation";
import { parseHistoryLot } from "@/lib/completed-auctions";
import Link from "next/link";
export const dynamic="force-dynamic";
export default async function AddressesPage({searchParams}:{searchParams:Promise<{order?:string}>}){
 const {client,user}=await transactionAccount("/account/addresses");
 const {data,error}=await client.from("delivery_addresses").select("*").eq("user_id",user.id).order("is_default",{ascending:false}).order("created_at").limit(20);
 const order=parseHistoryLot((await searchParams).order);
 return <InteriorShell eyebrow="Account Settings" title="Delivery Addresses" description="Manage your private address book. Order addresses are separate snapshots; edits here do not change existing orders."><AccountNavigation current="addresses" />{order&&<Link className="mb-4 inline-block text-auction-gold underline" href={`/orders/${order}#checkout`}>Return to checkout</Link>}{error?<p role="alert">Address book unavailable. Please try again after the account migration is applied.</p>:<AddressBook addresses={data??[]}/>}</InteriorShell>;
}
