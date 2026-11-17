import type Stripe from "stripe";

export function sellerCanAcceptTestPayments(account: Stripe.Account) {
  return account.country === "GB" && account.details_submitted && account.charges_enabled && account.payouts_enabled &&
    account.capabilities?.card_payments === "active" && !account.requirements?.disabled_reason;
}

export function sellerPaymentStatus(account: Stripe.Account | null, provisioning = false) {
  if (!account) return provisioning
    ? { title: "Setup in progress", description: "Continue setup to resume your sandbox account safely.", canOnboard: true }
    : { title: "Not set up", description: "Set up a Stripe sandbox account to receive test payments for your auctions.", canOnboard: true };
  const requirements = account.requirements;
  const reason = requirements?.disabled_reason;
  if (account.country !== "GB" || (reason && !reason.startsWith("requirements."))) {
    return { title: "Restricted or unavailable", description: "Your sandbox account has a restriction. Contact support or review your Stripe Dashboard.", canOnboard: false };
  }
  if (account.details_submitted && (requirements?.currently_due?.length || requirements?.past_due?.length || requirements?.errors?.length)) {
    return { title: "Additional verification required", description: "Stripe needs more information. Continue onboarding to review the outstanding requirements.", canOnboard: true };
  }
  if (sellerCanAcceptTestPayments(account)) {
    return { title: "Ready to receive payments", description: "Your sandbox account can receive test payments. No live payments or payouts are enabled by this site.", canOnboard: false };
  }
  return { title: "Setup in progress", description: requirements?.pending_verification?.length
    ? "Stripe is reviewing your verification information. Check back for an updated status."
    : "Your sandbox account setup is incomplete. Continue onboarding with Stripe.", canOnboard: true };
}
