import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usageRecords } from "@/lib/db/schema";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";
import crypto from "crypto";

type RouteContext = { params: Promise<{ orgId: string }> };

const VALID_TYPES = ["message", "tokens_in", "tokens_out", "tool_call"];

/**
 * POST /api/organizations/[orgId]/analytics/record
 * Record a usage event. Called internally by the OpenClaw proxy.
 * Body: { userId: string, type: string, count: number }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    await requireOrgMembership(orgId);

    const body = await request.json();
    const { userId, type, count } = body;

    if (!userId || typeof userId !== "string") {
      return NextResponse.json(
        { error: "userId is required" },
        { status: 400 },
      );
    }

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json(
        {
          error: `type must be one of: ${VALID_TYPES.join(", ")}`,
        },
        { status: 400 },
      );
    }

    if (typeof count !== "number" || count < 0 || !Number.isInteger(count)) {
      return NextResponse.json(
        { error: "count must be a non-negative integer" },
        { status: 400 },
      );
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayStr = today.toISOString().split("T")[0];

    const [record] = await db
      .insert(usageRecords)
      .values({
        orgId,
        userId,
        type: type as "message" | "tokens_in" | "tokens_out" | "tool_call",
        count,
        date: todayStr,
      })
      .returning();

    return NextResponse.json({ record }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}
