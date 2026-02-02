import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { memberships, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * GET /api/organizations/[orgId]/members
 * List all members of the organization with user details.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    await requireOrgMembership(orgId);

    const results = await db
      .select({
        membership: memberships,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          image: users.image,
        },
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.orgId, orgId));

    const members = results.map((r) => ({
      id: r.membership.id,
      role: r.membership.role,
      createdAt: r.membership.createdAt,
      user: r.user,
    }));

    return NextResponse.json({ members });
  } catch (error) {
    return errorResponse(error);
  }
}
