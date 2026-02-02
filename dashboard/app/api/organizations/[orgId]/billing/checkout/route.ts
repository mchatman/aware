import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { stripe, PLANS } from "@/lib/stripe";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * POST /api/organizations/[orgId]/billing/checkout
 * Create a Stripe checkout session for plan upgrade.
 * Body: { priceId: string }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    const { user, org } = await requireOrgMembership(orgId, [
      "owner",
      "admin",
    ]);

    const body = await request.json();
    const { priceId } = body;

    if (!priceId || typeof priceId !== "string") {
      return NextResponse.json(
        { error: "priceId is required" },
        { status: 400 },
      );
    }

    // Validate priceId is one of our known plans
    const validPriceIds = Object.values(PLANS).map((p) => p.priceId);
    if (!validPriceIds.includes(priceId)) {
      return NextResponse.json(
        { error: "Invalid price ID" },
        { status: 400 },
      );
    }

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;

    // If org already has a Stripe customer, use it
    let customerId = org.stripeCustomerId;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email!,
        metadata: {
          orgId: org.id,
        },
      });
      customerId = customer.id;

      // Store the customer ID
      await db
        .update(organizations)
        .set({ stripeCustomerId: customerId, updatedAt: new Date() })
        .where(eq(organizations.id, orgId));
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${baseUrl}/${orgId}/settings/billing?success=true`,
      cancel_url: `${baseUrl}/${orgId}/settings/billing?canceled=true`,
      metadata: {
        orgId: org.id,
      },
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return errorResponse(error);
  }
}
