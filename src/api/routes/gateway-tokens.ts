/**
 * Gateway token provisioning routes for the Aware API.
 * Handles API key management and OAuth token dispensing
 * for tenant gateway containers.
 * @module
 */

import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { gatewayKeys, oauthAccounts, teamMembers } from "../db/schema.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";
import { requireTeamRole } from "./teams.js";
import { refreshOAuthToken } from "../services/token-refresh.js";

export const gatewayTokensRouter = Router();

/* ------------------------------------------------------------------ */
/*  POST /api/gateway/tokens                                           */
/* ------------------------------------------------------------------ */

gatewayTokensRouter.post("/tokens", async (req: Request, res: Response) => {
  try {
    const header = req.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or malformed authorization header", code: "UNAUTHORIZED" });
      return;
    }

    const rawKey = header.slice(7);
    const { userId, provider } = req.body as {
      userId?: string;
      provider?: string;
    };

    if (!userId || !provider) {
      res.status(400).json({ error: "userId and provider are required", code: "MISSING_FIELDS" });
      return;
    }

    const validProviders = ["google", "microsoft"];
    if (!validProviders.includes(provider)) {
      res.status(400).json({ error: `Unsupported provider: ${provider}`, code: "BAD_PROVIDER" });
      return;
    }

    const db = getDb();

    // Verify the gateway API key
    const keys = await db.select().from(gatewayKeys);

    let matchedKey: (typeof keys)[number] | undefined;
    for (const key of keys) {
      const valid = await bcrypt.compare(rawKey, key.keyHash);
      if (valid) {
        matchedKey = key;
        break;
      }
    }

    if (!matchedKey) {
      res.status(401).json({ error: "Invalid API key", code: "INVALID_KEY" });
      return;
    }

    // Update lastUsedAt
    await db
      .update(gatewayKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(gatewayKeys.id, matchedKey.id));

    // Verify the user is a member of the key's team
    const [membership] = await db
      .select({ id: teamMembers.id })
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, matchedKey.teamId), eq(teamMembers.userId, userId)))
      .limit(1);

    if (!membership) {
      res.status(404).json({ error: "User is not a member of this team", code: "NOT_FOUND" });
      return;
    }

    // Look up the OAuth account
    const [account] = await db
      .select()
      .from(oauthAccounts)
      .where(
        and(
          eq(oauthAccounts.userId, userId),
          eq(oauthAccounts.provider, provider as "google" | "microsoft"),
        ),
      )
      .limit(1);

    if (!account) {
      res.status(404).json({
        error: "No OAuth connection found for this user and provider",
        code: "NO_CONNECTION",
      });
      return;
    }

    // Check if token is expired and refresh if needed
    const now = new Date();
    const isExpired = account.expiresAt ? account.expiresAt < now : true;

    if (isExpired) {
      try {
        const refreshed = await refreshOAuthToken(account);
        res.json({
          data: {
            accessToken: refreshed.accessToken,
            expiresAt: refreshed.expiresAt.toISOString(),
            scope: account.scope,
          },
        });
        return;
      } catch (refreshErr) {
        console.error("Token refresh failed:", refreshErr);
        res.status(502).json({ error: "Token refresh failed", code: "REFRESH_FAILED" });
        return;
      }
    }

    res.json({
      data: {
        accessToken: account.accessToken,
        expiresAt: account.expiresAt?.toISOString() ?? null,
        scope: account.scope,
      },
    });
  } catch (err) {
    console.error("Gateway token error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/gateway/keys                                             */
/* ------------------------------------------------------------------ */

gatewayTokensRouter.post("/keys", requireAuth, async (req: Request, res: Response) => {
  try {
    const { sub } = (req as AuthenticatedRequest).user;
    const { teamId, label } = req.body as {
      teamId?: string;
      label?: string;
    };

    if (!teamId) {
      res.status(400).json({ error: "teamId is required", code: "MISSING_FIELDS" });
      return;
    }

    const db = getDb();

    // Verify the user is owner of this team
    const [membership] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, sub)))
      .limit(1);

    if (!membership || membership.role !== "owner") {
      res.status(403).json({ error: "Insufficient team role", code: "INSUFFICIENT_ROLE" });
      return;
    }

    const rawKey = crypto.randomBytes(32).toString("hex");
    const keyHash = await bcrypt.hash(rawKey, 12);

    const [key] = await db
      .insert(gatewayKeys)
      .values({ teamId, keyHash, label: label ?? null })
      .returning({ id: gatewayKeys.id, label: gatewayKeys.label });

    res.status(201).json({
      data: { id: key.id, key: rawKey, label: key.label },
    });
  } catch (err) {
    console.error("Create gateway key error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /api/gateway/keys                                              */
/* ------------------------------------------------------------------ */

gatewayTokensRouter.get("/keys", requireAuth, async (req: Request, res: Response) => {
  try {
    const teamId = req.query.teamId as string | undefined;

    if (!teamId) {
      res.status(400).json({ error: "teamId query param is required", code: "MISSING_FIELDS" });
      return;
    }

    // Verify the user is admin/owner of this team
    const { sub } = (req as AuthenticatedRequest).user;
    const db = getDb();

    const [membership] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, sub)))
      .limit(1);

    if (!membership || !["owner", "admin"].includes(membership.role)) {
      res.status(403).json({ error: "Insufficient team role", code: "INSUFFICIENT_ROLE" });
      return;
    }

    const keys = await db
      .select({
        id: gatewayKeys.id,
        label: gatewayKeys.label,
        lastUsedAt: gatewayKeys.lastUsedAt,
        createdAt: gatewayKeys.createdAt,
      })
      .from(gatewayKeys)
      .where(eq(gatewayKeys.teamId, teamId));

    res.json({ data: { keys } });
  } catch (err) {
    console.error("List gateway keys error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/gateway/keys/:keyId                                    */
/* ------------------------------------------------------------------ */

gatewayTokensRouter.delete("/keys/:keyId", requireAuth, async (req: Request, res: Response) => {
  try {
    const keyId = req.params.keyId as string;
    const { sub } = (req as AuthenticatedRequest).user;
    const db = getDb();

    // Find the key
    const [key] = await db.select().from(gatewayKeys).where(eq(gatewayKeys.id, keyId)).limit(1);

    if (!key) {
      res.status(404).json({ error: "Key not found", code: "NOT_FOUND" });
      return;
    }

    // Verify the user is owner of the key's team
    const [membership] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, key.teamId), eq(teamMembers.userId, sub)))
      .limit(1);

    if (!membership || membership.role !== "owner") {
      res.status(403).json({ error: "Insufficient team role", code: "INSUFFICIENT_ROLE" });
      return;
    }

    await db.delete(gatewayKeys).where(eq(gatewayKeys.id, keyId));

    res.json({ data: { message: "Key revoked" } });
  } catch (err) {
    console.error("Delete gateway key error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
