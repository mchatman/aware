import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { invitations, memberships, organizations } from "@/lib/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { requireAuth, errorResponse } from "@/lib/api-helpers";
import crypto from "crypto";

/**
 * POST /api/invitations/accept
 * Accept an invitation by token. Creates membership and deletes the invitation.
 * Body: { token: string }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();

    const { token } = body;
    if (!token || typeof token !== "string") {
      return NextResponse.json(
        { error: "Invitation token is required" },
        { status: 400 },
      );
    }

    // Find the invitation
    const invitation = await db
      .select()
      .from(invitations)
      .where(
        and(
          eq(invitations.token, token),
          gt(invitations.expiresAt, new Date()),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (!invitation) {
      return NextResponse.json(
        { error: "Invalid or expired invitation" },
        { status: 404 },
      );
    }

    // Verify email matches
    if (invitation.email !== user.email?.toLowerCase()) {
      return NextResponse.json(
        { error: "This invitation was sent to a different email address" },
        { status: 403 },
      );
    }

    // Check if already a member
    const existing = await db
      .select({ id: memberships.id })
      .from(memberships)
      .where(
        and(
          eq(memberships.orgId, invitation.orgId),
          eq(memberships.userId, user.id!),
        ),
      )
      .limit(1)
      .then((rows) => rows[0]);

    if (existing) {
      // Clean up the invitation since they're already a member
      await db.delete(invitations).where(eq(invitations.id, invitation.id));
      return NextResponse.json(
        { error: "You are already a member of this organization" },
        { status: 409 },
      );
    }

    // Create membership
    await db.insert(memberships).values({
      id: crypto.randomUUID(),
      orgId: invitation.orgId,
      userId: user.id!,
      role: invitation.role as "owner" | "admin" | "member",
    });

    // Delete the invitation
    await db.delete(invitations).where(eq(invitations.id, invitation.id));

    // Fetch org details for the response
    const org = await db
      .select()
      .from(organizations)
      .where(eq(organizations.id, invitation.orgId))
      .limit(1)
      .then((rows) => rows[0]);

    return NextResponse.json({
      success: true,
      organization: org,
      role: invitation.role,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
