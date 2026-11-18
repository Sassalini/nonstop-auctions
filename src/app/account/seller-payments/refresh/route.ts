import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { stripeTestClients, stripeTestConfig, stripeTestOrigin } from "@/lib/stripe-test";
import { readSellerTestAccount, requireStripeSandbox, sellerTestAccountLink } from "@/lib/seller-stripe-onboarding";

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
      const account = await readSellerTestAccount({ stripe, admin }, user.id);
      // Refresh only an existing mapping. GET requests never provision accounts.
      if (account) url = await sellerTestAccountLink(stripe, origin, account.id);
    } catch { /* Show a safe retry message without provider details. */ }
  }
  redirect(url);
}
