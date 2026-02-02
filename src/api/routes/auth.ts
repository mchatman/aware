/**
 * Authentication routes for the Aware API.
 * Handles registration, login, token refresh, profile, and logout.
 * @module
 */

import { Router } from "express";
import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { eq, and } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { users, sessions } from "../db/schema.js";
import {
  generateTokenPair,
  requireAuth,
  type AuthenticatedRequest,
  type JwtPayload,
} from "../middleware/auth.js";

export const authRouter = Router();

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const REFRESH_TOKEN_DAYS = 30;

function refreshExpiresAt(): Date {
  const d = new Date();
  d.setDate(d.getDate() + REFRESH_TOKEN_DAYS);
  return d;
}

async function issueTokens(user: { id: string; email: string }) {
  const payload: JwtPayload = { sub: user.id, email: user.email };
  const { accessToken, refreshToken } = await generateTokenPair(payload);

  const db = getDb();
  await db.insert(sessions).values({
    userId: user.id,
    refreshToken,
    expiresAt: refreshExpiresAt(),
  });

  return { accessToken, refreshToken };
}

/* ------------------------------------------------------------------ */
/*  POST /api/auth/register                                            */
/* ------------------------------------------------------------------ */

authRouter.post("/register", async (req: Request, res: Response) => {
  try {
    const { email, password, name } = req.body as {
      email?: string;
      password?: string;
      name?: string;
    };

    if (!email || !password || !name) {
      res
        .status(400)
        .json({ error: "email, password, and name are required", code: "MISSING_FIELDS" });
      return;
    }

    const db = getDb();

    // Check for existing user
    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "Email already registered", code: "EMAIL_EXISTS" });
      return;
    }

    const passwordHash = await bcrypt.hash(password, 12);

    const [user] = await db
      .insert(users)
      .values({ email, passwordHash, name })
      .returning({ id: users.id, email: users.email, name: users.name });

    const tokens = await issueTokens(user);

    res.status(201).json({
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        ...tokens,
      },
    });
  } catch (err) {
    console.error("Register error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/auth/login                                               */
/* ------------------------------------------------------------------ */

authRouter.post("/login", async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required", code: "MISSING_FIELDS" });
      return;
    }

    const db = getDb();
    const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (!user || !user.passwordHash) {
      res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
      return;
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      res.status(401).json({ error: "Invalid credentials", code: "INVALID_CREDENTIALS" });
      return;
    }

    const tokens = await issueTokens(user);

    res.json({
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        ...tokens,
      },
    });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/auth/refresh                                             */
/* ------------------------------------------------------------------ */

authRouter.post("/refresh", async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };

    if (!refreshToken) {
      res.status(400).json({ error: "refreshToken is required", code: "MISSING_FIELDS" });
      return;
    }

    const db = getDb();
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.refreshToken, refreshToken))
      .limit(1);

    if (!session || session.expiresAt < new Date()) {
      res.status(401).json({ error: "Invalid or expired refresh token", code: "INVALID_REFRESH" });
      // Clean up expired session if it exists
      if (session) {
        await db.delete(sessions).where(eq(sessions.id, session.id));
      }
      return;
    }

    const [user] = await db.select().from(users).where(eq(users.id, session.userId)).limit(1);

    if (!user) {
      res.status(401).json({ error: "User not found", code: "USER_NOT_FOUND" });
      return;
    }

    // Rotate: delete old session, issue new tokens
    await db.delete(sessions).where(eq(sessions.id, session.id));
    const tokens = await issueTokens(user);

    res.json({
      data: {
        user: { id: user.id, email: user.email, name: user.name },
        ...tokens,
      },
    });
  } catch (err) {
    console.error("Refresh error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  GET /api/auth/me                                                   */
/* ------------------------------------------------------------------ */

authRouter.get("/me", requireAuth, async (req: Request, res: Response) => {
  try {
    const { sub } = (req as AuthenticatedRequest).user;
    const db = getDb();

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);

    if (!user) {
      res.status(404).json({ error: "User not found", code: "USER_NOT_FOUND" });
      return;
    }

    res.json({ data: { user } });
  } catch (err) {
    console.error("Me error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/auth/logout                                              */
/* ------------------------------------------------------------------ */

authRouter.post("/logout", requireAuth, async (req: Request, res: Response) => {
  try {
    const { refreshToken } = req.body as { refreshToken?: string };
    const { sub } = (req as AuthenticatedRequest).user;

    const db = getDb();

    if (refreshToken) {
      // Delete the specific session
      await db
        .delete(sessions)
        .where(and(eq(sessions.refreshToken, refreshToken), eq(sessions.userId, sub)));
    } else {
      // No refresh token provided — revoke all sessions for user
      await db.delete(sessions).where(eq(sessions.userId, sub));
    }

    res.json({ data: { message: "Logged out" } });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
