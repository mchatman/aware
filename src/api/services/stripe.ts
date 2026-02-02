/**
 * Stripe payment service for the Aware API.
 * Wraps the Stripe SDK with helpers for customer, subscription,
 * checkout session, and billing portal management.
 * @module
 */

import Stripe from "stripe";

/* ------------------------------------------------------------------ */
/*  Singleton client                                                   */
/* ------------------------------------------------------------------ */

let stripeInstance: Stripe | undefined;

/**
 * Returns (and lazily creates) the shared Stripe client.
 * Reads `STRIPE_SECRET_KEY` from `process.env`.
 */
export function getStripeClient(): Stripe {
  if (!stripeInstance) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("STRIPE_SECRET_KEY environment variable is required");
    }
    stripeInstance = new Stripe(secretKey, { apiVersion: "2026-01-28.clover" });
  }
  return stripeInstance;
}

/* ------------------------------------------------------------------ */
/*  Customer management                                                */
/* ------------------------------------------------------------------ */

/**
 * Create a Stripe customer for a team.
 * @param email - Billing email address.
 * @param teamName - Display name for the customer.
 * @returns The Stripe customer ID.
 */
export async function createCustomer(email: string, teamName: string): Promise<string> {
  const stripe = getStripeClient();
  const customer = await stripe.customers.create({
    email,
    name: teamName,
  });
  return customer.id;
}

/* ------------------------------------------------------------------ */
/*  Subscription management                                            */
/* ------------------------------------------------------------------ */

/**
 * Create a Stripe subscription directly (for server-side creation).
 * @param customerId - Stripe customer ID.
 * @param priceId - Stripe price ID for the plan.
 * @returns The created Stripe subscription object.
 */
export async function createSubscription(
  customerId: string,
  priceId: string,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
  });
}

/**
 * Cancel a Stripe subscription.
 * @param subscriptionId - Stripe subscription ID.
 * @param atPeriodEnd - If true, cancel at the end of the billing period.
 * @returns The updated Stripe subscription object.
 */
export async function cancelSubscription(
  subscriptionId: string,
  atPeriodEnd: boolean,
): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  if (atPeriodEnd) {
    return stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });
  }
  return stripe.subscriptions.cancel(subscriptionId);
}

/**
 * Resume a subscription that was scheduled for cancellation.
 * Removes cancel_at_period_end from the Stripe subscription.
 * @param subscriptionId - Stripe subscription ID.
 * @returns The updated Stripe subscription object.
 */
export async function resumeSubscription(subscriptionId: string): Promise<Stripe.Subscription> {
  const stripe = getStripeClient();
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: false,
  });
}

/* ------------------------------------------------------------------ */
/*  Session management                                                 */
/* ------------------------------------------------------------------ */

/**
 * Create a Stripe billing portal session for managing payment methods
 * and viewing invoices.
 * @param customerId - Stripe customer ID.
 * @param returnUrl - URL to redirect to when the user exits the portal.
 * @returns The portal session URL.
 */
export async function createPortalSession(customerId: string, returnUrl: string): Promise<string> {
  const stripe = getStripeClient();
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session.url;
}

/**
 * Create a Stripe checkout session for upgrading to a paid plan.
 * @param customerId - Stripe customer ID.
 * @param priceId - Stripe price ID for the plan.
 * @param successUrl - URL to redirect to after successful checkout.
 * @param cancelUrl - URL to redirect to if checkout is canceled.
 * @returns The checkout session URL.
 */
export async function createCheckoutSession(
  customerId: string,
  priceId: string,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const stripe = getStripeClient();
  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    mode: "subscription",
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
  });
  if (!session.url) {
    throw new Error("Stripe checkout session did not return a URL");
  }
  return session.url;
}
