import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { stripeTestClients, stripeTestConfig, stripeTestOrigin, testSellerAccount } from "@/lib/stripe-test";
import { requireStripeSandbox, sellerTestAccountLink } from "@/lib/seller-stripe-onboarding";

export const dynamic = "force-dynamic";

export async function GET() {
  const client = await createSupabaseServerClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) redirect("/login?next=%2Faccount%2Fseller-payments");
  const config = stripeTestConfig();
  const origin = stripeTestOrigin();
  let url = "/account/seller-payments?onboarding=retry";
  if (config && origin) {
    try {
      const { stripe, admin } = stripeTestClients(config);
      await requireStripeSandbox(stripe);
      const accountId = await testSellerAccount(admin, user.id);
      // Refresh only an existing mapping. GET requests never provision accounts.
      if (accountId) url = await sellerTestAccountLink(stripe, origin, accountId);
    } catch { /* Show a safe retry message without provider details. */ }
  }
  redirect(url);
}
