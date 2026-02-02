import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invitations } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";

type RouteContext = {
  params: Promise<{ orgId: string; invitationId: string }>;
};

/**
 * DELETE /api/organizations/[orgId]/invitations/[invitationId]
 * Cancel a pending invitation. Admin/owner only.
 */
export async function DELETE(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId, invitationId } = await context.params;
    await requireOrgMembership(orgId, ["owner", "admin"]);

    const target = await db
      .select()
      .from(invitations)
      .where(
        and(eq(invitations.id, invitationId), eq(invitations.orgId, orgId)),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!target) {
      return NextResponse.json(
        { error: "Invitation not found" },
        { status: 404 },
      );
    }

    await db
      .delete(invitations)
      .where(
        and(eq(invitations.id, invitationId), eq(invitations.orgId, orgId)),
      );

    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error);
  }
}
