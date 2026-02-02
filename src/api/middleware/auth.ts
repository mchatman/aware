/**
 * JWT authentication middleware and token helpers for the Aware API.
 * Uses `jose` for signing/verification (HS256).
 * @module
 */

import { SignJWT, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";
import crypto from "node:crypto";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Payload embedded in access JWTs. */
export interface JwtPayload {
  sub: string; // user id
  email: string;
}

/** Extended request with authenticated user context. */
export interface AuthenticatedRequest extends Request {
  user: JwtPayload;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

function getSecret(): Uint8Array {
  const raw = process.env.JWT_SECRET;
  if (!raw) throw new Error("JWT_SECRET environment variable is required");
  return new TextEncoder().encode(raw);
}

/* ------------------------------------------------------------------ */
/*  Token generation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generate a short-lived access token (15 min) for a user.
 */
export async function generateAccessToken(payload: JwtPayload): Promise<string> {
  return new SignJWT({ email: payload.email })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("15m")
    .sign(getSecret());
}

/**
 * Generate a long-lived opaque refresh token (random hex string).
 * The caller is responsible for persisting it in the `sessions` table.
 */
export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

/**
 * Convenience: produce both an access token and a refresh token.
 */
export async function generateTokenPair(payload: JwtPayload): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const [accessToken, refreshToken] = await Promise.all([
    generateAccessToken(payload),
    Promise.resolve(generateRefreshToken()),
  ]);
  return { accessToken, refreshToken };
}

/* ------------------------------------------------------------------ */
/*  Middleware                                                          */
/* ------------------------------------------------------------------ */

/**
 * Express middleware that verifies the `Authorization: Bearer <token>` header,
 * extracts the user payload, and attaches it to `req.user`.
 * Returns 401 on missing/invalid tokens.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or malformed authorization header" });
    return;
  }

  const token = header.slice(7);
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });

    if (!payload.sub || typeof payload.email !== "string") {
      res.status(401).json({ error: "Invalid token payload" });
      return;
    }

    (req as AuthenticatedRequest).user = {
      sub: payload.sub,
      email: payload.email,
    };

    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}
