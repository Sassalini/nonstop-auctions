import { transactionAccount } from "@/lib/transaction-account";
import { InteriorShell } from "@/components/InteriorShell";
import { AddressBook } from "@/components/AddressBook";
export const dynamic="force-dynamic";
export default async function AddressesPage(){
 const {client}=await transactionAccount("/account/addresses");
 const {data,error}=await client.from("delivery_addresses").select("*").order("is_default",{ascending:false}).order("created_at").limit(20);
 return <InteriorShell eyebrow="Account Settings" title="Delivery Addresses" description="Manage your private address book. Order addresses are separate snapshots; edits here do not change existing orders.">{error?<p role="alert">Address book unavailable. Please try again after the account migration is applied.</p>:<AddressBook addresses={data??[]}/>}</InteriorShell>;
}
