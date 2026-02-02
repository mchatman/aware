import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invitations, memberships, users } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";
import crypto from "crypto";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * GET /api/organizations/[orgId]/invitations
 * List pending (non-expired) invitations for the org.
 */
export async function GET(_request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    await requireOrgMembership(orgId, ["owner", "admin"]);

    const results = await db
      .select({
        invitation: invitations,
        invitedBy: {
          id: users.id,
          name: users.name,
          email: users.email,
        },
      })
      .from(invitations)
      .leftJoin(users, eq(invitations.invitedById, users.id))
      .where(
        and(
          eq(invitations.orgId, orgId),
          gt(invitations.expiresAt, new Date()),
        ),
      );

    const pending = results.map((r) => ({
      ...r.invitation,
      invitedBy: r.invitedBy,
    }));

    return NextResponse.json({ invitations: pending });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/organizations/[orgId]/invitations
 * Create a new invitation. Admin/owner only.
 * Body: { email: string, role: "admin" | "member" }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    const { user } = await requireOrgMembership(orgId, ["owner", "admin"]);

    const body = await request.json();
    const { email, role } = body;

    if (!email || typeof email !== "string" || !email.includes("@")) {
      return NextResponse.json(
        { error: "Valid email is required" },
        { status: 400 },
      );
    }

    if (!role || !["admin", "member"].includes(role)) {
      return NextResponse.json(
        { error: 'Role must be "admin" or "member"' },
        { status: 400 },
      );
    }

    // Check if user is already a member
    const existingUser = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email.toLowerCase()))
      .limit(1)
      .then((rows) => rows[0]);

    if (existingUser) {
      const existingMembership = await db
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.orgId, orgId),
            eq(memberships.userId, existingUser.id),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]);

      if (existingMembership) {
        return NextResponse.json(
          { error: "User is already a member of this organization" },
          { status: 409 },
        );
      }
    }

    // Check if there's already a pending invitation for this email
    const existingInvite = await db
      .select({ id: invitations.id })
      .from(invitations)
      .where(
        and(
          eq(invitations.orgId, orgId),
          eq(invitations.email, email.toLowerCase()),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (existingInvite) {
      return NextResponse.json(
        { error: "An invitation has already been sent to this email" },
        { status: 409 },
      );
    }

    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const [invitation] = await db
      .insert(invitations)
      .values({
        id: crypto.randomUUID(),
        orgId,
        email: email.toLowerCase(),
        role: role as "admin" | "member",
        token,
        expiresAt,
        invitedById: user.id!,
      })
      .returning();

    return NextResponse.json({ invitation }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
