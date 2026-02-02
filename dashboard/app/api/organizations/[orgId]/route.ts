import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations, memberships } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  requireOrgMembership,
  errorResponse,
  ApiError,
} from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * GET /api/organizations/[orgId]
 * Get organization details. Must be a member.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    const { org, membership } = await requireOrgMembership(orgId);

    return NextResponse.json({
      organization: org,
      role: membership.role,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * PATCH /api/organizations/[orgId]
 * Update organization name/slug. Must be admin or owner.
 * Body: { name?: string, slug?: string }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    await requireOrgMembership(orgId, ["owner", "admin"]);

    const body = await request.json();
    const updates: Record<string, any> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string" || body.name.trim().length === 0) {
        return NextResponse.json(
          { error: "Name must be a non-empty string" },
          { status: 400 },
        );
      }
      updates.name = body.name.trim();
    }

    if (body.slug !== undefined) {
      if (
        typeof body.slug !== "string" ||
        !/^[a-z0-9-]+$/.test(body.slug)
      ) {
        return NextResponse.json(
          { error: "Slug must contain only lowercase letters, numbers, and hyphens" },
          { status: 400 },
        );
      }

      // Check slug uniqueness
      const existing = await db
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.slug, body.slug))
        .limit(1);

      if (existing.length > 0 && existing[0].id !== orgId) {
        return NextResponse.json(
          { error: "This slug is already taken" },
          { status: 409 },
        );
      }
      updates.slug = body.slug;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 },
      );
    }

    updates.updatedAt = new Date();

    const [updated] = await db
      .update(organizations)
      .set(updates)
      .where(eq(organizations.id, orgId))
      .returning();

    return NextResponse.json({ organization: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/organizations/[orgId]
 * Delete organization. Must be owner.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    await requireOrgMembership(orgId, ["owner"]);

    // Delete memberships first, then the org
    await db.delete(memberships).where(eq(memberships.orgId, orgId));
    await db.delete(organizations).where(eq(organizations.id, orgId));

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
