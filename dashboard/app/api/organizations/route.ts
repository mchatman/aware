import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { organizations, memberships, users } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { requireAuth, errorResponse } from "@/lib/api-helpers";
import crypto from "crypto";

/**
 * GET /api/organizations
 * List all organizations for the current user (via memberships).
 */
export async function GET() {
  try {
    const user = await requireAuth();

    const results = await db
      .select({
        org: organizations,
        membership: memberships,
      })
      .from(memberships)
      .innerJoin(organizations, eq(memberships.orgId, organizations.id))
      .where(eq(memberships.userId, user.id!));

    const orgs = results.map((r) => ({
      ...r.org,
      role: r.membership.role,
    }));

    return NextResponse.json({ organizations: orgs });
  } catch (error) {
    return errorResponse(error);
  }
}

/**
 * POST /api/organizations
 * Create a new organization. Creator becomes owner.
 * Body: { name: string, slug?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth();
    const body = await request.json();

    const { name, slug } = body;
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json(
        { error: "Organization name is required" },
        { status: 400 },
      );
    }

    const orgSlug =
      slug ||
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");

    // Check slug uniqueness
    const existing = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.slug, orgSlug))
      .limit(1);

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "An organization with this slug already exists" },
        { status: 409 },
      );
    }

    const orgId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();

    // Create org + owner membership in sequence
    const [newOrg] = await db
      .insert(organizations)
      .values({
        id: orgId,
        name: name.trim(),
        slug: orgSlug,
        plan: "free",
      })
      .returning();

    await db.insert(memberships).values({
      id: membershipId,
      orgId: orgId,
      userId: user.id!,
      role: "owner",
    });

    return NextResponse.json(
      { organization: newOrg, role: "owner" },
      { status: 201 },
    );
  } catch (error) {
    return errorResponse(error);
  }
}
