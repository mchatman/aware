/**
 * Aware API entry point.
 * Creates and configures the Express application serving auth, OAuth,
 * and health-check endpoints for the Mac thin-client.
 * @module
 */

import express from "express";
import type { Request, Response, NextFunction } from "express";
import { authRouter } from "./routes/auth.js";
import { oauthRouter } from "./routes/oauth.js";
import { teamsRouter } from "./routes/teams.js";
import { connectorsRouter } from "./routes/connectors.js";
import { gatewayTokensRouter } from "./routes/gateway-tokens.js";
import { billingRouter } from "./routes/billing.js";
import { stripeWebhookRouter } from "./routes/stripe-webhook.js";

/* ------------------------------------------------------------------ */
/*  App setup                                                          */
/* ------------------------------------------------------------------ */

export const app = express();

// Stripe webhook needs raw body BEFORE JSON parser
app.use("/api/webhooks/stripe", stripeWebhookRouter);

// JSON body parsing
app.use(express.json());

// CORS — configurable origin via CORS_ORIGIN env var
app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = process.env.CORS_ORIGIN ?? "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  next();
});

/* ------------------------------------------------------------------ */
/*  Routes                                                             */
/* ------------------------------------------------------------------ */

// Health check
app.get("/api/health", (_req: Request, res: Response) => {
  res.json({ data: { status: "ok", timestamp: new Date().toISOString() } });
});

// Auth routes
app.use("/api/auth", authRouter);

// OAuth routes
app.use("/api/oauth", oauthRouter);

// Team routes
app.use("/api/teams", teamsRouter);

// Connector routes (nested under teams/:teamId/connectors)
app.use("/api/teams/:teamId/connectors", connectorsRouter);

// Gateway token provisioning routes
app.use("/api/gateway", gatewayTokensRouter);

// Billing routes (nested under teams/:teamId/billing)
app.use("/api/teams/:teamId/billing", billingRouter);

/* ------------------------------------------------------------------ */
/*  Error handler                                                      */
/* ------------------------------------------------------------------ */

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal server error" });
});

/* ------------------------------------------------------------------ */
/*  Server start                                                       */
/* ------------------------------------------------------------------ */

/**
 * Starts the Aware API server.
 * Reads `API_HOST` (default `0.0.0.0`) and `API_PORT` (default `3001`) from env.
 * @returns A promise that resolves once the server is listening.
 */
export function startApiServer(): Promise<ReturnType<typeof app.listen>> {
  const host = process.env.API_HOST ?? "0.0.0.0";
  const port = parseInt(process.env.API_PORT ?? "3001", 10);

  return new Promise((resolve) => {
    const server = app.listen(port, host, () => {
      console.log(`Aware API listening on ${host}:${port}`);
      resolve(server);
    });
  });
}
