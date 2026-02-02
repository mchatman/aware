/**
 * Stripe webhook handler for the Aware API.
 * Processes Stripe events (checkout, subscription updates, invoices)
 * and synchronises local subscription state.
 * Mounted at /api/webhooks/stripe.
 * @module
 */

import { Router } from "express";
import type { Request, Response } from "express";
import * as bodyParser from "body-parser";
import { eq } from "drizzle-orm";
import Stripe from "stripe";

import { getDb } from "../db/connection.js";
import { subscriptions } from "../db/schema.js";
import { getStripeClient } from "../services/stripe.js";

export const stripeWebhookRouter = Router();

/* ------------------------------------------------------------------ */
/*  Raw body parsing for signature verification                        */
/* ------------------------------------------------------------------ */

// Stripe requires the raw body to verify webhook signatures.
// Apply raw body parser only to this router.
stripeWebhookRouter.use(bodyParser.raw({ type: "application/json" }));

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Map a Stripe price ID to a plan tier name. */
function priceToPlanTier(priceId: string): "free" | "pro" | "enterprise" {
  const proPriceId = process.env.STRIPE_PRICE_PRO;
  const enterprisePriceId = process.env.STRIPE_PRICE_ENTERPRISE;

  if (proPriceId && priceId === proPriceId) return "pro";
  if (enterprisePriceId && priceId === enterprisePriceId) return "enterprise";

  // Default to pro for any non-mapped paid price
  return "pro";
}

/** Map a Stripe subscription status string to our enum. */
function mapSubscriptionStatus(
  stripeStatus: string,
): "active" | "trialing" | "past_due" | "canceled" | "unpaid" | "incomplete" {
  const validStatuses = [
    "active",
    "trialing",
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
  ] as const;
  type ValidStatus = (typeof validStatuses)[number];

  if (validStatuses.includes(stripeStatus as ValidStatus)) {
    return stripeStatus as ValidStatus;
  }
  return "active";
}

/* ------------------------------------------------------------------ */
/*  POST /api/webhooks/stripe                                          */
/* ------------------------------------------------------------------ */

stripeWebhookRouter.post("/", async (req: Request, res: Response) => {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    res.status(500).json({ error: "Webhook secret not configured" });
    return;
  }

  const signature = req.headers["stripe-signature"] as string | undefined;
  if (!signature) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripeClient();
    event = stripe.webhooks.constructEvent(req.body as Buffer, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Webhook signature verification failed:", message);
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  try {
    const db = getDb();

    switch (event.type) {
      /* -------------------------------------------------------------- */
      /*  checkout.session.completed                                     */
      /* -------------------------------------------------------------- */
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const customerId =
          typeof session.customer === "string" ? session.customer : session.customer?.id;
        const subscriptionId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;

        if (!customerId || !subscriptionId) break;

        // Fetch the full subscription to get price and period info
        const stripe = getStripeClient();
        const stripeSub = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = stripeSub.items.data[0]?.price.id ?? null;
        const planTier = priceId ? priceToPlanTier(priceId) : "pro";

        // Upsert: find by stripeCustomerId and update, or create
        const [existing] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeCustomerId, customerId))
          .limit(1);

        if (existing) {
          await db
            .update(subscriptions)
            .set({
              stripeSubscriptionId: subscriptionId,
              stripePriceId: priceId,
              planTier,
              status: mapSubscriptionStatus(stripeSub.status),
              currentPeriodStart: new Date(
                stripeSub.items.data[0]?.current_period_start
                  ? stripeSub.items.data[0].current_period_start * 1000
                  : stripeSub.start_date * 1000,
              ),
              currentPeriodEnd: new Date(
                stripeSub.items.data[0]?.current_period_end
                  ? stripeSub.items.data[0].current_period_end * 1000
                  : Date.now() + 30 * 24 * 60 * 60 * 1000,
              ),
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, existing.id));
        }

        break;
      }

      /* -------------------------------------------------------------- */
      /*  customer.subscription.updated                                  */
      /* -------------------------------------------------------------- */
      case "customer.subscription.updated": {
        const stripeSub = event.data.object as Stripe.Subscription;
        const subscriptionId = stripeSub.id;
        const priceId = stripeSub.items.data[0]?.price.id ?? null;

        const [existing] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
          .limit(1);

        if (existing) {
          await db
            .update(subscriptions)
            .set({
              stripePriceId: priceId,
              planTier: priceId ? priceToPlanTier(priceId) : existing.planTier,
              status: mapSubscriptionStatus(stripeSub.status),
              currentPeriodStart: new Date(
                stripeSub.items.data[0]?.current_period_start
                  ? stripeSub.items.data[0].current_period_start * 1000
                  : stripeSub.start_date * 1000,
              ),
              currentPeriodEnd: new Date(
                stripeSub.items.data[0]?.current_period_end
                  ? stripeSub.items.data[0].current_period_end * 1000
                  : Date.now() + 30 * 24 * 60 * 60 * 1000,
              ),
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, existing.id));
        }

        break;
      }

      /* -------------------------------------------------------------- */
      /*  customer.subscription.deleted                                  */
      /* -------------------------------------------------------------- */
      case "customer.subscription.deleted": {
        const stripeSub = event.data.object as Stripe.Subscription;
        const subscriptionId = stripeSub.id;

        const [existing] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
          .limit(1);

        if (existing) {
          await db
            .update(subscriptions)
            .set({
              status: "canceled",
              planTier: "free",
              stripeSubscriptionId: null,
              stripePriceId: null,
              cancelAtPeriodEnd: false,
              updatedAt: new Date(),
            })
            .where(eq(subscriptions.id, existing.id));
        }

        break;
      }

      /* -------------------------------------------------------------- */
      /*  invoice.payment_failed                                         */
      /* -------------------------------------------------------------- */
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subDetails = invoice.parent?.subscription_details;
        const subscriptionId = subDetails
          ? typeof subDetails.subscription === "string"
            ? subDetails.subscription
            : subDetails.subscription?.id
          : undefined;

        if (!subscriptionId) break;

        const [existing] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
          .limit(1);

        if (existing) {
          await db
            .update(subscriptions)
            .set({ status: "past_due", updatedAt: new Date() })
            .where(eq(subscriptions.id, existing.id));
        }

        break;
      }

      /* -------------------------------------------------------------- */
      /*  invoice.paid                                                   */
      /* -------------------------------------------------------------- */
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const subDetails = invoice.parent?.subscription_details;
        const subscriptionId = subDetails
          ? typeof subDetails.subscription === "string"
            ? subDetails.subscription
            : subDetails.subscription?.id
          : undefined;

        if (!subscriptionId) break;

        const [existing] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.stripeSubscriptionId, subscriptionId))
          .limit(1);

        if (existing) {
          await db
            .update(subscriptions)
            .set({ status: "active", updatedAt: new Date() })
            .where(eq(subscriptions.id, existing.id));
        }

        break;
      }

      default:
        // Unhandled event type — acknowledge silently
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error("Webhook handler error:", err);
    res.status(500).json({ error: "Webhook processing failed" });
  }
});
