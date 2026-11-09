import Link from "next/link";
import { InteriorShell } from "@/components/InteriorShell";
import { SellerOnboardingButton } from "@/components/SellerOnboardingButton";
import { transactionAccount } from "@/lib/transaction-account";
import { sellerCanAcceptTestPayments, stripeTestClients, stripeTestConfig, stripeTestOrigin } from "@/lib/stripe-test";

export const dynamic = "force-dynamic";

export default async function SellerPaymentsPage() {
  const { user } = await transactionAccount("/account/seller-payments");
  const config = stripeTestConfig();
  let status = "Stripe test onboarding is unavailable.";
  let showOnboarding = false;
  if (config && stripeTestOrigin()) {
    const { stripe, admin } = stripeTestClients(config);
    try {
      const { data: mapping, error } = await admin.from("seller_stripe_test_accounts")
        .select("stripe_account").eq("seller_id", user.id).maybeSingle();
      if (error) throw error;
      status = "An operator must assign your Stripe sandbox account before you can start onboarding.";
      if (mapping) {
        const account = await stripe.accounts.retrieve(mapping.stripe_account);
        const ready = sellerCanAcceptTestPayments(account);
        status = ready ? "Your sandbox account can accept test payments and is eligible for test payouts." :
          "Your sandbox account needs more information or has a restriction. Open Stripe to review the requirements.";
        showOnboarding = !ready || Boolean(account.requirements?.currently_due?.length);
      }
    } catch {
      status = "Stripe account status is temporarily unavailable. Refresh this page to try again.";
    }
  }
  return <InteriorShell eyebrow="Private Desk" title="Seller payments" description="Manage your Stripe Connect setup in the sandbox.">
    <section className="premium-card max-w-2xl space-y-4 rounded-lg p-5">
      <p>{status}</p>
      {showOnboarding && <SellerOnboardingButton />}
      <Link href="/my-auctions" className="inline-block text-sm text-auction-gold underline">Back to My Auctions</Link>
    </section>
  </InteriorShell>;
}
