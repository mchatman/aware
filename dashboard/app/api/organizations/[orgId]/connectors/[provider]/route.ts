import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { connectors } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string; provider: string }> };

const VALID_PROVIDERS = ["google", "microsoft"];

/**
 * GET /api/organizations/[orgId]/connectors/[provider]
 * Get connector status for a provider (connected/disconnected).
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId, provider } = await context.params;

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Must be 'google' or 'microsoft'" },
        { status: 400 },
      );
    }

    await requireOrgMembership(orgId);

    const connector = await db
      .select({
        id: connectors.id,
        provider: connectors.provider,
        scopes: connectors.scopes,
        tokenExpiresAt: connectors.tokenExpiresAt,
        createdAt: connectors.createdAt,
        updatedAt: connectors.updatedAt,
      })
      .from(connectors)
      .where(
        and(eq(connectors.orgId, orgId), eq(connectors.provider, provider as "google" | "microsoft")),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!connector) {
      return NextResponse.json({
        status: "disconnected",
        provider,
      });
    }

    return NextResponse.json({
      status: "connected",
      provider,
      connector: {
        id: connector.id,
        scopes: connector.scopes,
        tokenExpiresAt: connector.tokenExpiresAt,
        createdAt: connector.createdAt,
        updatedAt: connector.updatedAt,
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/organizations/[orgId]/connectors/[provider]
 * Disconnect a provider (remove stored tokens). Admin/owner only.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId, provider } = await context.params;

    if (!VALID_PROVIDERS.includes(provider)) {
      return NextResponse.json(
        { error: "Invalid provider. Must be 'google' or 'microsoft'" },
        { status: 400 },
      );
    }

    await requireOrgMembership(orgId, ["owner", "admin"]);

    await db
      .delete(connectors)
      .where(
        and(eq(connectors.orgId, orgId), eq(connectors.provider, provider as "google" | "microsoft")),
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
