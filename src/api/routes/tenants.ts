/**
 * Tenant provisioning routes for the Aware API.
 * Handles container lifecycle management for team gateway instances.
 * Mounted under /api/teams/:teamId/tenant.
 * @module
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { eq } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { tenants } from "../db/schema.js";
import { requireAuth } from "../middleware/auth.js";
import { requireTeamRole } from "./teams.js";
import { getProvisioner } from "../services/tenant-provisioner.js";

export const tenantsRouter = Router({ mergeParams: true });

/* ------------------------------------------------------------------ */
/*  GET /api/teams/:teamId/tenant                                      */
/* ------------------------------------------------------------------ */

tenantsRouter.get("/", requireAuth, requireTeamRole(), async (req: Request, res: Response) => {
  try {
    const teamId = req.params.teamId as string;
    const db = getDb();

    const [tenant] = await db.select().from(tenants).where(eq(tenants.teamId, teamId)).limit(1);

    if (!tenant) {
      res.json({ data: { tenant: null } });
      return;
    }

    res.json({
      data: {
        tenant: {
          id: tenant.id,
          containerId: tenant.containerId,
          containerName: tenant.containerName,
          port: tenant.port,
          gatewayUrl: tenant.gatewayUrl,
          status: tenant.status,
          imageTag: tenant.imageTag,
          createdAt: tenant.createdAt.toISOString(),
          updatedAt: tenant.updatedAt.toISOString(),
        },
      },
    });
  } catch (err) {
    console.error("Get tenant error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/tenant/provision                           */
/* ------------------------------------------------------------------ */

tenantsRouter.post(
  "/provision",
  requireAuth,
  requireTeamRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const db = getDb();

      // Check if tenant already exists
      const [existing] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.teamId, teamId))
        .limit(1);

      if (existing) {
        res.status(409).json({ error: "Tenant already exists", code: "TENANT_EXISTS" });
        return;
      }

      // Get team slug for container naming
      const { teams } = await import("../db/schema.js");
      const [team] = await db
        .select({ id: teams.id, slug: teams.slug })
        .from(teams)
        .where(eq(teams.id, teamId))
        .limit(1);

      if (!team) {
        res.status(404).json({ error: "Team not found", code: "NOT_FOUND" });
        return;
      }

      const provisioner = getProvisioner();
      const tenant = await provisioner.provision({ id: team.id, slug: team.slug });

      res.status(201).json({ data: { tenant } });
    } catch (err) {
      console.error("Provision tenant error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/tenant/start                               */
/* ------------------------------------------------------------------ */

tenantsRouter.post(
  "/start",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;

      const provisioner = getProvisioner();
      await provisioner.start(teamId);
      await provisioner.syncStatus(teamId);

      const db = getDb();
      const [tenant] = await db.select().from(tenants).where(eq(tenants.teamId, teamId)).limit(1);

      res.json({
        data: {
          tenant: tenant
            ? {
                id: tenant.id,
                containerId: tenant.containerId,
                containerName: tenant.containerName,
                port: tenant.port,
                gatewayUrl: tenant.gatewayUrl,
                status: tenant.status,
                imageTag: tenant.imageTag,
              }
            : null,
        },
      });
    } catch (err) {
      console.error("Start tenant error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/tenant/stop                                */
/* ------------------------------------------------------------------ */

tenantsRouter.post(
  "/stop",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;

      const provisioner = getProvisioner();
      await provisioner.stop(teamId);

      const db = getDb();
      const [tenant] = await db.select().from(tenants).where(eq(tenants.teamId, teamId)).limit(1);

      res.json({
        data: {
          tenant: tenant
            ? {
                id: tenant.id,
                containerId: tenant.containerId,
                containerName: tenant.containerName,
                port: tenant.port,
                gatewayUrl: tenant.gatewayUrl,
                status: tenant.status,
                imageTag: tenant.imageTag,
              }
            : null,
        },
      });
    } catch (err) {
      console.error("Stop tenant error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  POST /api/teams/:teamId/tenant/restart                             */
/* ------------------------------------------------------------------ */

tenantsRouter.post(
  "/restart",
  requireAuth,
  requireTeamRole("owner", "admin"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;

      const provisioner = getProvisioner();
      await provisioner.stop(teamId);
      await provisioner.start(teamId);
      await provisioner.syncStatus(teamId);

      const db = getDb();
      const [tenant] = await db.select().from(tenants).where(eq(tenants.teamId, teamId)).limit(1);

      res.json({
        data: {
          tenant: tenant
            ? {
                id: tenant.id,
                containerId: tenant.containerId,
                containerName: tenant.containerName,
                port: tenant.port,
                gatewayUrl: tenant.gatewayUrl,
                status: tenant.status,
                imageTag: tenant.imageTag,
              }
            : null,
        },
      });
    } catch (err) {
      console.error("Restart tenant error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/* ------------------------------------------------------------------ */
/*  DELETE /api/teams/:teamId/tenant                                   */
/* ------------------------------------------------------------------ */

tenantsRouter.delete(
  "/",
  requireAuth,
  requireTeamRole("owner"),
  async (req: Request, res: Response) => {
    try {
      const teamId = req.params.teamId as string;
      const db = getDb();

      // Check tenant exists
      const [existing] = await db
        .select({ id: tenants.id })
        .from(tenants)
        .where(eq(tenants.teamId, teamId))
        .limit(1);

      if (!existing) {
        res.status(404).json({ error: "No tenant found", code: "NOT_FOUND" });
        return;
      }

      const provisioner = getProvisioner();
      await provisioner.remove(teamId);

      res.json({ data: { message: "Tenant removed" } });
    } catch (err) {
      console.error("Remove tenant error:", err);
      res.status(500).json({ error: "Internal server error" });
    }
  },
);
