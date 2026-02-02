import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe, PLANS } from "@/lib/stripe";
import type Stripe from "stripe";

/**
 * POST /api/stripe/webhook
 * Handle incoming Stripe webhook events.
 * Events handled:
 *   - checkout.session.completed
 *   - invoice.paid
 *   - customer.subscription.updated
 *   - customer.subscription.deleted
 */
export async function POST(request: NextRequest) {
  const body = await request.text();
  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header" },
      { status: 400 },
    );
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("Webhook signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid signature" },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const orgId = session.metadata?.orgId;

        if (!orgId || !session.subscription) break;

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription as string,
        );

        const firstItem = subscription.items.data[0];
        const priceId = firstItem?.price.id;
        const plan = getPlanFromPriceId(priceId);

        await db
          .update(organizations)
          .set({
            stripeSubscriptionId: subscription.id,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: firstItem?.current_period_end
              ? new Date(firstItem.current_period_end * 1000)
              : null,
            plan,
            updatedAt: new Date(),
          })
          .where(eq(organizations.id, orgId));

        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const parentSub = invoice.parent?.subscription_details?.subscription;
        const subscriptionId =
          typeof parentSub === "string"
            ? parentSub
            : parentSub?.id;

        if (!subscriptionId) break;

        const subscription =
          await stripe.subscriptions.retrieve(subscriptionId);

        const invoiceItem = subscription.items.data[0];

        // Find org by subscription ID
        const org = await db
          .select()
          .from(organizations)
          .where(eq(organizations.stripeSubscriptionId, subscriptionId))
          .limit(1)
          .then((rows) => rows[0]);

        if (org) {
          await db
            .update(organizations)
            .set({
              stripeCurrentPeriodEnd: invoiceItem?.current_period_end
                ? new Date(invoiceItem.current_period_end * 1000)
                : null,
              updatedAt: new Date(),
            })
            .where(eq(organizations.id, org.id));
        }

        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const updatedItem = subscription.items.data[0];
        const priceId = updatedItem?.price.id;
        const plan = getPlanFromPriceId(priceId);

        const org = await db
          .select()
          .from(organizations)
          .where(eq(organizations.stripeSubscriptionId, subscription.id))
          .limit(1)
          .then((rows) => rows[0]);

        if (org) {
          await db
            .update(organizations)
            .set({
              stripePriceId: priceId,
              stripeCurrentPeriodEnd: updatedItem?.current_period_end
                ? new Date(updatedItem.current_period_end * 1000)
                : null,
              plan,
              updatedAt: new Date(),
            })
            .where(eq(organizations.id, org.id));
        }

        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;

        const org = await db
          .select()
          .from(organizations)
          .where(eq(organizations.stripeSubscriptionId, subscription.id))
          .limit(1)
          .then((rows) => rows[0]);

        if (org) {
          await db
            .update(organizations)
            .set({
              plan: "free",
              stripeSubscriptionId: null,
              stripePriceId: null,
              stripeCurrentPeriodEnd: null,
              updatedAt: new Date(),
            })
            .where(eq(organizations.id, org.id));
        }

        break;
      }

      default:
        // Unhandled event type — log and acknowledge
        console.log(`Unhandled Stripe event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook handler error:", error);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 },
    );
  }
}

/**
 * Map a Stripe price ID back to our plan name.
 */
function getPlanFromPriceId(priceId: string): "free" | "pro" | "enterprise" {
  for (const [planName, planConfig] of Object.entries(PLANS)) {
    if ((planConfig as any).priceId === priceId) {
      return planName.toLowerCase() as "free" | "pro" | "enterprise";
    }
  }
  return "free";
}
