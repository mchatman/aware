import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users, organizations, memberships } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.statusCode },
    );
  }
  console.error("Unhandled error:", error);
  return NextResponse.json(
    { error: "Internal server error" },
    { status: 500 },
  );
}

/**
 * Require an authenticated session. Returns the session user or throws.
 */
export async function requireAuth() {
  const session = await auth();
  if (!session?.user?.id) {
    throw new ApiError(401, "Authentication required");
  }
  return session.user;
}

/**
 * Require authenticated user to be a member of the given org.
 * Optionally restrict to specific roles.
 * Returns { user, membership, org } or throws appropriate HTTP error.
 */
export async function requireOrgMembership(
  orgId: string,
  requiredRoles?: ("owner" | "admin" | "member")[],
) {
  const user = await requireAuth();

  const org = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1)
    .then((rows) => rows[0]);

  if (!org) {
    throw new ApiError(404, "Organization not found");
  }

  const membership = await db
    .select()
    .from(memberships)
    .where(and(eq(memberships.orgId, orgId), eq(memberships.userId, user.id!)))
    .limit(1)
    .then((rows) => rows[0]);

  if (!membership) {
    throw new ApiError(403, "You are not a member of this organization");
  }

  if (requiredRoles && !requiredRoles.includes(membership.role as any)) {
    throw new ApiError(
      403,
      `Requires one of: ${requiredRoles.join(", ")}. You have: ${membership.role}`,
    );
  }

  return { user, membership, org };
}
