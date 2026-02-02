import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { memberships } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import {
  requireOrgMembership,
  errorResponse,
  ApiError,
} from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string; memberId: string }> };

/**
 * PATCH /api/organizations/[orgId]/members/[memberId]
 * Update a member's role. Only owner/admin can do this.
 * Body: { role: "admin" | "member" }
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const { orgId, memberId } = await context.params;
    const { membership: callerMembership } = await requireOrgMembership(orgId, [
      "owner",
      "admin",
    ]);

    const body = await request.json();
    const { role } = body;

    if (!role || !["admin", "member"].includes(role)) {
      return NextResponse.json(
        { error: 'Role must be "admin" or "member"' },
        { status: 400 },
      );
    }

    // Find target membership
    const target = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, memberId), eq(memberships.orgId, orgId)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!target) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 },
      );
    }

    // Can't change owner's role
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "Cannot change the owner's role" },
        { status: 403 },
      );
    }

    // Admins can't promote to admin (only owners can)
    if (callerMembership.role === "admin" && role === "admin") {
      return NextResponse.json(
        { error: "Only owners can promote members to admin" },
        { status: 403 },
      );
    }

    const [updated] = await db
      .update(memberships)
      .set({ role: role as "owner" | "admin" | "member" })
      .where(eq(memberships.id, memberId))
      .returning();

    return NextResponse.json({ membership: updated });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * DELETE /api/organizations/[orgId]/members/[memberId]
 * Remove a member from the organization. Owner/admin only. Can't remove the owner.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId, memberId } = await context.params;
    await requireOrgMembership(orgId, ["owner", "admin"]);

    // Find target membership
    const target = await db
      .select()
      .from(memberships)
      .where(and(eq(memberships.id, memberId), eq(memberships.orgId, orgId)))
      .limit(1)
      .then((rows) => rows[0]);

    if (!target) {
      return NextResponse.json(
        { error: "Member not found" },
        { status: 404 },
      );
    }

    // Can't remove the owner
    if (target.role === "owner") {
      return NextResponse.json(
        { error: "Cannot remove the organization owner" },
        { status: 403 },
      );
    }

    await db
      .delete(memberships)
      .where(and(eq(memberships.id, memberId), eq(memberships.orgId, orgId)));

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
