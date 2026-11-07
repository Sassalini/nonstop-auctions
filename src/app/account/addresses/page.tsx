import { transactionAccount } from "@/lib/transaction-account";
import { InteriorShell } from "@/components/InteriorShell";
import { AddressBook } from "@/components/AddressBook";
import { AccountNavigation } from "@/components/AccountNavigation";
export const dynamic="force-dynamic";
export default async function AddressesPage(){
 const {client,user}=await transactionAccount("/account/addresses");
 const {data,error}=await client.from("delivery_addresses").select("*").eq("user_id",user.id).order("is_default",{ascending:false}).order("created_at").limit(20);
 return <InteriorShell eyebrow="Account Settings" title="Delivery Addresses" description="Manage your private address book. Order addresses are separate snapshots; edits here do not change existing orders."><AccountNavigation current="addresses" />{error?<p role="alert">Address book unavailable. Please try again after the account migration is applied.</p>:<AddressBook addresses={data??[]}/>}</InteriorShell>;
}
