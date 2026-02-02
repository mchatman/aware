/**
 * Billing management routes for the Aware API.
 * Handles subscription viewing, upgrades, cancellations,
 * and usage reporting. Mounted under /api/teams/:teamId/billing.
 * @module
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { eq, and } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { subscriptions, usageRecords, users, teamMembers } from "../db/schema.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireTeamRole } from "./teams.js";
import {
  createCustomer,
  cancelSubscription,
  resumeSubscription,
  createPortalSession,
  createCheckoutSession,
} from "../services/stripe.js";

export const billingRouter = Router({ mergeParams: true });

/* ------------------------------------------------------------------ */
/*  GET /api/teams/:teamId/billing                                     */
/* ------------------------------------------------------------------ */

billingRouter.get("/", requireAuth, requireTeamRole(), async (req: Request, res: Response) => {
  try {
    const teamId = req.params.teamId as string;
    const db = getDb();

    const [sub] = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.teamId, teamId))
      .limit(1);

    if (!sub) {
      // No subscription record — return free tier defaults
      res.json({
        data: {
          subscription: {
            planTier: "free",
            status: "active",
            currentPeriodStart: null,
            currentPeriodEnd: null,
            cancelAtPeriodEnd: false,
          },
        },
      });
      return;
    }

    res.json({
      data: {
        subscription: {
          planTier: sub.planTier,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart?.toISOString() ?? null,
          currentPeriodEnd: sub.currentPeriodEnd?.toISOString() ?? null,
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
        },
      },
    });
  } catch (err) {
    console.error("Get billing error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/billing/subscribe                          */
/* ------------------------------------------------------------------ */

billingRouter.post(
  "/subscribe",
  requireAuth,
  requireTeamRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const { sub } = (req as AuthenticatedRequest).user;
      const { priceId } = req.body as { priceId?: string };

      if (!priceId) {
        res.status(400).json({ error: "priceId is required", code: "MISSING_FIELDS" });
        return;
      }

      const db = getDb();

      // Look up existing subscription for this team
      const [existing] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.teamId, teamId))
        .limit(1);

      let customerId: string;

      if (existing?.stripeCustomerId) {
        customerId = existing.stripeCustomerId;
      } else {
        // Get team owner's email for the Stripe customer
        const [member] = await db
          .select({ email: users.email, name: users.name })
          .from(teamMembers)
          .innerJoin(users, eq(teamMembers.userId, users.id))
          .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, sub)))
          .limit(1);

        if (!member) {
          res.status(404).json({ error: "Team member not found", code: "NOT_FOUND" });
          return;
        }

        customerId = await createCustomer(member.email, member.name);

        // Create a free-tier subscription record with the new customer ID
        await db.insert(subscriptions).values({
          teamId,
          stripeCustomerId: customerId,
          planTier: "free",
          status: "active",
        });
      }

      const baseUrl = process.env.API_BASE_URL ?? "http://localhost:3001";
      const successUrl = `${baseUrl}/api/teams/${teamId}/billing?checkout=success`;
      const cancelUrl = `${baseUrl}/api/teams/${teamId}/billing?checkout=canceled`;

      const url = await createCheckoutSession(customerId, priceId, successUrl, cancelUrl);

      res.json({ data: { url } });
    } catch (err) {
      console.error("Subscribe error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/billing/cancel                             */
/* ------------------------------------------------------------------ */

billingRouter.post(
  "/cancel",
  requireAuth,
  requireTeamRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const db = getDb();

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.teamId, teamId))
        .limit(1);

      if (!sub || !sub.stripeSubscriptionId) {
        res.status(400).json({
          error: "No active subscription to cancel",
          code: "NO_SUBSCRIPTION",
        });
        return;
      }

      await cancelSubscription(sub.stripeSubscriptionId, true);

      await db
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: true, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));

      res.json({ data: { message: "Subscription will cancel at period end" } });
    } catch (err) {
      console.error("Cancel subscription error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/billing/resume                             */
/* ------------------------------------------------------------------ */

billingRouter.post(
  "/resume",
  requireAuth,
  requireTeamRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const db = getDb();

      const [sub] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.teamId, teamId))
        .limit(1);

      if (!sub || !sub.stripeSubscriptionId) {
        res.status(400).json({
          error: "No subscription to resume",
          code: "NO_SUBSCRIPTION",
        });
        return;
      }

      if (!sub.cancelAtPeriodEnd) {
        res.status(400).json({
          error: "Subscription is not scheduled for cancellation",
          code: "NOT_CANCELING",
        });
        return;
      }

      await resumeSubscription(sub.stripeSubscriptionId);

      await db
        .update(subscriptions)
        .set({ cancelAtPeriodEnd: false, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));

      res.json({ data: { message: "Subscription resumed" } });
    } catch (err) {
      console.error("Resume subscription error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/billing/portal                             */
/* ------------------------------------------------------------------ */

billingRouter.post(
  "/portal",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const { returnUrl } = req.body as { returnUrl?: string };

      if (!returnUrl) {
        res.status(400).json({ error: "returnUrl is required", code: "MISSING_FIELDS" });
        return;
      }

      const db = getDb();

      const [sub] = await db
        .select({ stripeCustomerId: subscriptions.stripeCustomerId })
        .from(subscriptions)
        .where(eq(subscriptions.teamId, teamId))
        .limit(1);

      if (!sub) {
        res.status(400).json({
          error: "No billing account found for this team",
          code: "NO_SUBSCRIPTION",
        });
        return;
      }

      const url = await createPortalSession(sub.stripeCustomerId, returnUrl);
      res.json({ data: { url } });
    } catch (err) {
      console.error("Portal session error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  GET /api/teams/:teamId/billing/usage                               */
/* ------------------------------------------------------------------ */

billingRouter.get("/usage", requireAuth, requireTeamRole(), async (req: Request, res: Response) => {
  try {
    const teamId = req.params.teamId as string;
    const db = getDb();
    const now = new Date();

    // Get subscription to determine current period
    const [sub] = await db
      .select({
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
      })
      .from(subscriptions)
      .where(eq(subscriptions.teamId, teamId))
      .limit(1);

    let periodStart: Date;
    let periodEnd: Date;

    if (sub?.currentPeriodStart && sub?.currentPeriodEnd) {
      periodStart = sub.currentPeriodStart;
      periodEnd = sub.currentPeriodEnd;
    } else {
      // Free tier: use calendar month
      periodStart = new Date(now.getFullYear(), now.getMonth(), 1);
      periodEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    }

    const [record] = await db
      .select({
        aiTokensUsed: usageRecords.aiTokensUsed,
        apiCallsCount: usageRecords.apiCallsCount,
        periodStart: usageRecords.periodStart,
        periodEnd: usageRecords.periodEnd,
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

    res.json({
      data: {
        usage: record
          ? {
              aiTokensUsed: record.aiTokensUsed,
              apiCallsCount: record.apiCallsCount,
              periodStart: record.periodStart.toISOString(),
              periodEnd: record.periodEnd.toISOString(),
            }
          : {
              aiTokensUsed: 0,
              apiCallsCount: 0,
              periodStart: periodStart.toISOString(),
              periodEnd: periodEnd.toISOString(),
            },
      },
    });
  } catch (err) {
    console.error("Usage error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
