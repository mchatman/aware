/**
 * OAuth routes for the Aware API.
 * Handles Google and Microsoft OAuth flows, token storage,
 * and connection management for the Mac app thin-client.
 * @module
 */

import { Router } from "express";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import { eq, and } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { oauthAccounts } from "../db/schema.js";
import { requireAuth, type AuthenticatedRequest } from "../middleware/auth.js";

export const oauthRouter = Router();

/* ------------------------------------------------------------------ */
/*  Provider configuration                                             */
/* ------------------------------------------------------------------ */

import { getProviderConfig } from "../config/oauth-providers.js";

function getCallbackUrl(provider: string): string {
  const base = process.env.API_BASE_URL ?? "http://localhost:3001";
  return `${base}/api/oauth/${provider}/callback`;
}

/* ------------------------------------------------------------------ */
/*  GET /api/oauth/:provider/authorize                                 */
/* ------------------------------------------------------------------ */

oauthRouter.get("/:provider/authorize", requireAuth, (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as string;
    const config = getProviderConfig(provider);

    if (!config) {
      res.status(400).json({ error: `Unsupported provider: ${provider}`, code: "BAD_PROVIDER" });
      return;
    }

    const clientId = process.env[config.clientIdEnv];
    if (!clientId) {
      res
        .status(500)
        .json({ error: `${config.clientIdEnv} not configured`, code: "MISSING_CONFIG" });
      return;
    }

    const state = crypto.randomBytes(32).toString("hex");
    const scopes = (req.query.scopes as string | undefined)
      ? (req.query.scopes as string).split(",")
      : config.defaultScopes;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: getCallbackUrl(provider),
      response_type: "code",
      scope: scopes.join(" "),
      state,
      access_type: "offline",
      prompt: "consent",
    });

    const url = `${config.authorizeUrl}?${params.toString()}`;
    res.json({ data: { url, state } });
  } catch (err) {
    console.error("OAuth authorize error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /api/oauth/:provider/callback                                  */
/* ------------------------------------------------------------------ */

/** Token response shape from OAuth providers. */
interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

/** Decode the `sub` (provider account id) from an ID token without verification. */
function decodeIdTokenSub(idToken: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString()) as {
      sub?: string;
    };
    return payload.sub;
  } catch {
    return undefined;
  }
}

oauthRouter.get("/:provider/callback", async (req: Request, res: Response) => {
  try {
    const provider = req.params.provider as string;
    const config = getProviderConfig(provider);

    if (!config) {
      res.status(400).json({ error: `Unsupported provider: ${provider}`, code: "BAD_PROVIDER" });
      return;
    }

    const code = req.query.code as string | undefined;
    const userId = req.query.user_id as string | undefined;

    if (!code) {
      res.status(400).json({ error: "Missing authorization code", code: "MISSING_CODE" });
      return;
    }

    const clientId = process.env[config.clientIdEnv];
    const clientSecret = process.env[config.clientSecretEnv];

    if (!clientId || !clientSecret) {
      res.status(500).json({ error: "OAuth credentials not configured", code: "MISSING_CONFIG" });
      return;
    }

    // Exchange code for tokens
    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
        redirect_uri: getCallbackUrl(provider),
      }),
    });

    if (!tokenRes.ok) {
      const text = await tokenRes.text();
      console.error("OAuth token exchange failed:", text);
      res.status(502).json({ error: "Token exchange failed", code: "TOKEN_EXCHANGE_FAILED" });
      return;
    }

    const tokens = (await tokenRes.json()) as TokenResponse;

    // Extract provider account id from id_token (if present) or use a fallback
    let providerAccountId = tokens.id_token ? decodeIdTokenSub(tokens.id_token) : undefined;
    if (!providerAccountId) {
      providerAccountId = `${provider}_${crypto.randomUUID()}`;
    }

    const expiresAt = tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null;

    // Upsert: if the user already connected this provider account, update tokens
    if (userId) {
      const db = getDb();

      const existing = await db
        .select({ id: oauthAccounts.id })
        .from(oauthAccounts)
        .where(
          and(
            eq(oauthAccounts.userId, userId),
            eq(oauthAccounts.provider, provider as "google" | "microsoft"),
            eq(oauthAccounts.providerAccountId, providerAccountId),
          ),
        )
        .limit(1);

      if (existing.length > 0) {
        await db
          .update(oauthAccounts)
          .set({
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            expiresAt,
            scope: tokens.scope ?? null,
            updatedAt: new Date(),
          })
          .where(eq(oauthAccounts.id, existing[0].id));
      } else {
        await db.insert(oauthAccounts).values({
          userId,
          provider: provider as "google" | "microsoft",
          providerAccountId,
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token ?? null,
          expiresAt,
          scope: tokens.scope ?? null,
        });
      }
    }

    // Redirect to custom URL scheme so the Mac app can close the browser
    const appScheme = process.env.OAUTH_APP_SCHEME ?? "aware";
    const redirectUrl = `${appScheme}://oauth/callback?provider=${provider}&success=true`;
    res.redirect(redirectUrl);
  } catch (err) {
    console.error("OAuth callback error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /api/oauth/connections                                         */
/* ------------------------------------------------------------------ */

oauthRouter.get("/connections", requireAuth, async (req: Request, res: Response) => {
  try {
    const { sub } = (req as AuthenticatedRequest).user;
    const db = getDb();

    const connections = await db
      .select({
        id: oauthAccounts.id,
        provider: oauthAccounts.provider,
        providerAccountId: oauthAccounts.providerAccountId,
        scope: oauthAccounts.scope,
        createdAt: oauthAccounts.createdAt,
      })
      .from(oauthAccounts)
      .where(eq(oauthAccounts.userId, sub));

    res.json({ data: { connections } });
  } catch (err) {
    console.error("Connections list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  DELETE /api/oauth/connections/:id                                   */
/* ------------------------------------------------------------------ */

oauthRouter.delete("/connections/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const { sub } = (req as AuthenticatedRequest).user;
    const id = req.params.id as string;
    const db = getDb();

    const deleted = await db
      .delete(oauthAccounts)
      .where(and(eq(oauthAccounts.id, id), eq(oauthAccounts.userId, sub)))
      .returning({ id: oauthAccounts.id });

    if (deleted.length === 0) {
      res.status(404).json({ error: "Connection not found", code: "NOT_FOUND" });
      return;
    }

    res.json({ data: { message: "Connection removed" } });
  } catch (err) {
    console.error("Connection delete error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
