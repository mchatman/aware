import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * POST /api/organizations/[orgId]/billing/portal
 * Create a Stripe billing portal session for managing subscription.
 */
export async function POST(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    const { org } = await requireOrgMembership(orgId, ["owner", "admin"]);

    if (!org.stripeCustomerId) {
      return NextResponse.json(
        { error: "No billing account found. Please subscribe to a plan first." },
        { status: 400 },
      );
    }

    const baseUrl = process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL;

    const session = await stripe.billingPortal.sessions.create({
      customer: org.stripeCustomerId,
      return_url: `${baseUrl}/${orgId}/settings/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error) {
    return errorResponse(error);
  }
}
