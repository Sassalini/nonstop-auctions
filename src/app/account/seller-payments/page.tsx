import Link from "next/link";
import { InteriorShell } from "@/components/InteriorShell";
import { AccountNavigation } from "@/components/AccountNavigation";
import { SellerOnboardingButton } from "@/components/SellerOnboardingButton";
import { transactionAccount } from "@/lib/transaction-account";
import { stripeTestClients, stripeTestConfig, stripeTestOrigin } from "@/lib/stripe-test";
import { readSellerTestAccount, requireStripeSandbox, SellerSetupRecoveryRequired } from "@/lib/seller-stripe-onboarding";
import { sellerPaymentStatus } from "@/lib/seller-payment-status";

export const dynamic = "force-dynamic";

export default async function SellerPaymentsPage({ searchParams }: { searchParams: Promise<{ onboarding?: string }> }) {
  const { user } = await transactionAccount("/account/seller-payments");
  const query = await searchParams;
  const config = stripeTestConfig();
  let status = { title: "Status unavailable", description: "Stripe test onboarding is unavailable. Please try again later or contact support.", canOnboard: false };
  let initial = false;
  if (config && stripeTestOrigin()) {
    try {
      const { stripe, admin } = stripeTestClients(config);
      await requireStripeSandbox(stripe);
      const account = await readSellerTestAccount({ stripe, admin }, user.id);
      if (account) {
        // A return URL is never evidence of completion. Read Stripe every time.
        status = sellerPaymentStatus(account);
      } else {
        const { data, error } = await admin.from("seller_stripe_test_provisioning").select("id").eq("seller_id", user.id).maybeSingle();
        if (error) throw error;
        status = sellerPaymentStatus(null, Boolean(data));
        initial = !data;
      }
    } catch (error) {
      status = error instanceof SellerSetupRecoveryRequired
        ? { title: "Setup needs review", description: error.message, canOnboard: false }
        : { title: "Status unavailable", description: "Stripe account status is temporarily unavailable. Refresh this page to try again. Your existing setup will be reused.", canOnboard: false };
    }
  }
  return <InteriorShell eyebrow="My Account" title="Seller Payments" description="Set up and manage payments for the items you sell.">
    <AccountNavigation current="payments" />
    <section className="premium-card max-w-2xl space-y-4 rounded-lg p-5">
      <h2 className="font-display text-xl text-auction-gold">{status.title}</h2>
      <p>{status.description}</p>
      <p className="text-sm text-auction-muted">Stripe securely collects your business and verification information. You can return here to check your status or continue an unfinished setup.</p>
      <p className="text-sm text-auction-muted">Test mode only. Use Stripe test information; no real money is moved.</p>
      {query.onboarding === "retry" && <p role="alert" className="text-sm text-auction-ember">The Stripe link could not be refreshed. Continue onboarding to request a new link, or try again later.</p>}
      {status.canOnboard && <SellerOnboardingButton initial={initial} />}
      <Link href="/my-auctions" className="inline-block text-sm text-auction-gold underline">Back to My Auctions</Link>
    </section>
  </InteriorShell>;
}
