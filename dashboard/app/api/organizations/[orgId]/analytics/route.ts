import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { usageRecords } from "@/lib/db/schema";
import { eq, and, gte, sql, desc } from "drizzle-orm";
import { requireOrgMembership, errorResponse } from "@/lib/api-helpers";

type RouteContext = { params: Promise<{ orgId: string }> };

/**
 * GET /api/organizations/[orgId]/analytics
 * Get usage stats for the organization.
 * Query params:
 *   - days: 7 | 30 | 90 (default: 30)
 * Returns daily breakdown + totals + active user count.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const { orgId } = await context.params;
    await requireOrgMembership(orgId);

    const { searchParams } = new URL(request.url);
    const daysParam = searchParams.get("days");
    const days = [7, 30, 90].includes(Number(daysParam))
      ? Number(daysParam)
      : 30;

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);
    const startDateStr = startDate.toISOString().split("T")[0];

    // Daily breakdown by type
    const dailyStats = await db
      .select({
        date: usageRecords.date,
        type: usageRecords.type,
        total: sql<number>`sum(${usageRecords.count})::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.orgId, orgId),
          gte(usageRecords.date, startDateStr),
        ),
      )
      .groupBy(usageRecords.date, usageRecords.type)
      .orderBy(desc(usageRecords.date));

    // Aggregate totals by type
    const totals = await db
      .select({
        type: usageRecords.type,
        total: sql<number>`sum(${usageRecords.count})::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.orgId, orgId),
          gte(usageRecords.date, startDateStr),
        ),
      )
      .groupBy(usageRecords.type);

    // Active users count (distinct users with any usage in period)
    const activeUsersResult = await db
      .select({
        count: sql<number>`count(distinct ${usageRecords.userId})::int`,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.orgId, orgId),
          gte(usageRecords.date, startDateStr),
        ),
      );

    // Transform daily stats into a date-keyed structure
    const dailyBreakdown: Record<
      string,
      { messages: number; tokens_in: number; tokens_out: number; tool_calls: number }
    > = {};

    for (const row of dailyStats) {
      const dateKey = String(row.date);

      if (!dailyBreakdown[dateKey]) {
        dailyBreakdown[dateKey] = {
          messages: 0,
          tokens_in: 0,
          tokens_out: 0,
          tool_calls: 0,
        };
      }

      const type = row.type as keyof (typeof dailyBreakdown)[string];
      if (type in dailyBreakdown[dateKey]) {
        dailyBreakdown[dateKey][type] = row.total;
      }
    }

    // Transform totals
    const totalsByType: Record<string, number> = {};
    for (const row of totals) {
      totalsByType[row.type] = row.total;
    }

    return NextResponse.json({
      days,
      daily: dailyBreakdown,
      totals: {
        messages: totalsByType.message || 0,
        tokens_in: totalsByType.tokens_in || 0,
        tokens_out: totalsByType.tokens_out || 0,
        tool_calls: totalsByType.tool_call || 0,
      },
      activeUsers: activeUsersResult[0]?.count || 0,
    });
  } catch (error) {
    return errorResponse(error);
  }
}
