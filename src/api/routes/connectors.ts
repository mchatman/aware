/**
 * Connector management routes for the Aware API.
 * Handles team-level OAuth connector configuration and status checks.
 * Mounted under /api/teams/:teamId/connectors.
 * @module
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { eq, and } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { connectors, oauthAccounts, teamMembers, users } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTeamRole } from "./teams.js";

export const connectorsRouter = Router({ mergeParams: true });

/* ------------------------------------------------------------------ */
/*  GET /api/teams/:teamId/connectors                                  */
/* ------------------------------------------------------------------ */

connectorsRouter.get("/", requireAuth, requireTeamRole(), async (req: Request, res: Response) => {
  try {
    const teamId = req.params.teamId as string;
    const db = getDb();

    const rows = await db.select().from(connectors).where(eq(connectors.teamId, teamId));

    res.json({ data: { connectors: rows } });
  } catch (err) {
    console.error("List connectors error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/connectors                                 */
/* ------------------------------------------------------------------ */

connectorsRouter.post(
  "/",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const { provider, scopes } = req.body as {
        provider?: string;
        scopes?: string;
      };

      if (!provider) {
        res.status(400).json({ error: "provider is required", code: "MISSING_FIELDS" });
        return;
      }

      const validProviders = ["google", "microsoft"];
      if (!validProviders.includes(provider)) {
        res.status(400).json({ error: `Unsupported provider: ${provider}`, code: "BAD_PROVIDER" });
        return;
      }

      const db = getDb();

      // Check for existing connector
      const existing = await db
        .select({ id: connectors.id })
        .from(connectors)
        .where(
          and(
            eq(connectors.teamId, teamId),
            eq(connectors.provider, provider as "google" | "microsoft"),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        res.status(409).json({
          error: "Connector already exists for this provider",
          code: "CONNECTOR_EXISTS",
        });
        return;
      }

      const [connector] = await db
        .insert(connectors)
        .values({
          teamId,
          provider: provider as "google" | "microsoft",
          scopes: scopes ?? null,
        })
        .returning();

      res.status(201).json({ data: { connector } });
    } catch (err) {
      console.error("Create connector error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  PATCH /api/teams/:teamId/connectors/:connectorId                   */
/* ------------------------------------------------------------------ */

connectorsRouter.patch(
  "/:connectorId",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const connectorId = req.params.connectorId as string;
      const { scopes, enabled } = req.body as {
        scopes?: string;
        enabled?: boolean;
      };

      if (scopes === undefined && enabled === undefined) {
        res.status(400).json({
          error: "scopes or enabled is required",
          code: "MISSING_FIELDS",
        });
        return;
      }

      const db = getDb();

      const [existing] = await db
        .select({ id: connectors.id })
        .from(connectors)
        .where(and(eq(connectors.id, connectorId), eq(connectors.teamId, teamId)))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "Connector not found", code: "NOT_FOUND" });
        return;
      }

      const updates: Record<string, unknown> = { updatedAt: new Date() };
      if (scopes !== undefined) updates.scopes = scopes;
      if (enabled !== undefined) updates.enabled = enabled;

      const [connector] = await db
        .update(connectors)
        .set(updates)
        .where(eq(connectors.id, connectorId))
        .returning();

      res.json({ data: { connector } });
    } catch (err) {
      console.error("Update connector error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  DELETE /api/teams/:teamId/connectors/:connectorId                  */
/* ------------------------------------------------------------------ */

connectorsRouter.delete(
  "/:connectorId",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const connectorId = req.params.connectorId as string;
      const db = getDb();

      const deleted = await db
        .delete(connectors)
        .where(and(eq(connectors.id, connectorId), eq(connectors.teamId, teamId)))
        .returning({ id: connectors.id });

      if (deleted.length === 0) {
        res.status(404).json({ error: "Connector not found", code: "NOT_FOUND" });
        return;
      }

      res.json({ data: { message: "Connector removed" } });
    } catch (err) {
      console.error("Delete connector error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  GET /api/teams/:teamId/connectors/:connectorId/status              */
/* ------------------------------------------------------------------ */

connectorsRouter.get(
  "/:connectorId/status",
  requireAuth,
  requireTeamRole(),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const connectorId = req.params.connectorId as string;
      const db = getDb();

      // Fetch the connector
      const [connector] = await db
        .select()
        .from(connectors)
        .where(and(eq(connectors.id, connectorId), eq(connectors.teamId, teamId)))
        .limit(1);

      if (!connector) {
        res.status(404).json({ error: "Connector not found", code: "NOT_FOUND" });
        return;
      }

      // Get all team members
      const members = await db
        .select({
          userId: teamMembers.userId,
          email: users.email,
          name: users.name,
        })
        .from(teamMembers)
        .innerJoin(users, eq(teamMembers.userId, users.id))
        .where(eq(teamMembers.teamId, teamId));

      // For each member, check if they have connected this provider
      const now = new Date();
      const memberStatuses: Array<{
        userId: string;
        email: string;
        name: string;
        connected: boolean;
        tokenStatus: "valid" | "expired" | "none";
      }> = [];

      for (const member of members) {
        const [account] = await db
          .select({
            id: oauthAccounts.id,
            expiresAt: oauthAccounts.expiresAt,
          })
          .from(oauthAccounts)
          .where(
            and(
              eq(oauthAccounts.userId, member.userId),
              eq(oauthAccounts.provider, connector.provider),
            ),
          )
          .limit(1);

        if (!account) {
          memberStatuses.push({
            userId: member.userId,
            email: member.email,
            name: member.name,
            connected: false,
            tokenStatus: "none",
          });
        } else {
          const expired = account.expiresAt ? account.expiresAt < now : false;
          memberStatuses.push({
            userId: member.userId,
            email: member.email,
            name: member.name,
            connected: true,
            tokenStatus: expired ? "expired" : "valid",
          });
        }
      }

      res.json({
        data: {
          connector: {
            id: connector.id,
            provider: connector.provider,
            enabled: connector.enabled,
          },
          members: memberStatuses,
        },
      });
    } catch (err) {
      console.error("Connector status error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);
