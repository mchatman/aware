/**
 * Plan limit definitions and enforcement for the Aware API.
 * Maps plan tiers to resource limits and provides runtime checking
 * against current team usage.
 * @module
 */

import { eq, and } from "drizzle-orm";
import { getDb } from "../db/connection.js";
import { subscriptions, teamMembers, connectors, usageRecords } from "../db/schema.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Resource limits for a billing plan tier. Use -1 for unlimited. */
export interface PlanLimits {
  maxTeamMembers: number;
  maxConnectors: number;
  aiTokensPerMonth: number;
  apiCallsPerMonth: number;
}

/** Result of a limit check. */
export interface LimitCheckResult {
  allowed: boolean;
  current: number;
  max: number;
}

/* ------------------------------------------------------------------ */
/*  Limit definitions                                                  */
/* ------------------------------------------------------------------ */

const PLAN_LIMITS: Record<string, PlanLimits> = {
  free: {
    maxTeamMembers: 1,
    maxConnectors: 2,
    aiTokensPerMonth: 100_000,
    apiCallsPerMonth: 1_000,
  },
  pro: {
    maxTeamMembers: 10,
    maxConnectors: -1,
    aiTokensPerMonth: 1_000_000,
    apiCallsPerMonth: 10_000,
  },
  enterprise: {
    maxTeamMembers: -1,
    maxConnectors: -1,
    aiTokensPerMonth: -1,
    apiCallsPerMonth: -1,
  },
};

/**
 * Get the resource limits for a plan tier.
 * @param tier - The plan tier name.
 * @returns The limits for the given tier.
 */
export function getPlanLimits(tier: "free" | "pro" | "enterprise"): PlanLimits {
  return PLAN_LIMITS[tier];
}

/* ------------------------------------------------------------------ */
/*  Runtime limit checking                                             */
/* ------------------------------------------------------------------ */

/**
 * Check whether a team has capacity for a specific resource.
 * Looks up the team's current plan tier and compares current usage
 * against the plan's limit.
 *
 * @param teamId - The team to check.
 * @param limit - Which limit to check.
 * @returns Whether the team is allowed more of this resource, plus current/max counts.
 */
export async function checkTeamLimit(
  teamId: string,
  limit: keyof PlanLimits,
): Promise<LimitCheckResult> {
  const db = getDb();

  // Get current plan tier
  const [sub] = await db
    .select({ planTier: subscriptions.planTier })
    .from(subscriptions)
    .where(eq(subscriptions.teamId, teamId))
    .limit(1);

  const tier = (sub?.planTier ?? "free") as "free" | "pro" | "enterprise";
  const limits = getPlanLimits(tier);
  const max = limits[limit];

  // Unlimited — always allowed
  if (max === -1) {
    return { allowed: true, current: 0, max: -1 };
  }

  const current = await getCurrentUsage(teamId, limit);
  return { allowed: current < max, current, max };
}

/* ------------------------------------------------------------------ */
/*  Internal usage counters                                            */
/* ------------------------------------------------------------------ */

async function getCurrentUsage(teamId: string, limit: keyof PlanLimits): Promise<number> {
  const db = getDb();

  switch (limit) {
    case "maxTeamMembers": {
      const members = await db
        .select({ id: teamMembers.id })
        .from(teamMembers)
        .where(eq(teamMembers.teamId, teamId));
      return members.length;
    }
    case "maxConnectors": {
      const conns = await db
        .select({ id: connectors.id })
        .from(connectors)
        .where(eq(connectors.teamId, teamId));
      return conns.length;
    }
    case "aiTokensPerMonth": {
      const record = await getCurrentPeriodUsage(teamId);
      return record?.aiTokensUsed ?? 0;
    }
    case "apiCallsPerMonth": {
      const record = await getCurrentPeriodUsage(teamId);
      return record?.apiCallsCount ?? 0;
    }
  }
}

async function getCurrentPeriodUsage(teamId: string) {
  const db = getDb();
  const now = new Date();

  // Get the subscription to find the current period
  const [sub] = await db
    .select({
      currentPeriodStart: subscriptions.currentPeriodStart,
      currentPeriodEnd: subscriptions.currentPeriodEnd,
    })
    .from(subscriptions)
    .where(eq(subscriptions.teamId, teamId))
    .limit(1);

  if (!sub?.currentPeriodStart || !sub?.currentPeriodEnd) {
    // No subscription or free tier — use calendar month boundaries
    const periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);

    const [record] = await db
      .select({
        aiTokensUsed: usageRecords.aiTokensUsed,
        apiCallsCount: usageRecords.apiCallsCount,
      })
      .from(usageRecords)
      .where(
        and(
          eq(usageRecords.teamId, teamId),
          eq(usageRecords.periodStart, periodStart),
          eq(usageRecords.periodEnd, periodEnd),
        ),
      )
      .limit(1);

    return record ?? null;
  }

  const [record] = await db
    .select({
      aiTokensUsed: usageRecords.aiTokensUsed,
      apiCallsCount: usageRecords.apiCallsCount,
    })
    .from(usageRecords)
    .where(
      and(
        eq(usageRecords.teamId, teamId),
        eq(usageRecords.periodStart, sub.currentPeriodStart),
        eq(usageRecords.periodEnd, sub.currentPeriodEnd),
      ),
    )
    .limit(1);

  return record ?? null;
}
