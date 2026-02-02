/**
 * Tenant provisioning service for the Aware API.
 * Manages Docker containers for team gateway instances via dockerode.
 * Each team gets an isolated container running the OpenClaw gateway image.
 * @module
 */

import Docker from "dockerode";
import crypto from "node:crypto";
import { eq, max } from "drizzle-orm";

import { getDb } from "../db/connection.js";
import { tenants } from "../db/schema.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Info returned after provisioning a tenant container. */
export interface TenantInfo {
  id: string;
  teamId: string;
  containerId: string | null;
  containerName: string;
  port: number;
  gatewayUrl: string;
  status: string;
  imageTag: string;
}

/** Docker-level container status. */
export interface TenantStatus {
  running: boolean;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** First port in the tenant allocation range. */
const BASE_PORT = 19000;

/** Internal gateway port inside the container. */
const CONTAINER_PORT = 18789;

/* ------------------------------------------------------------------ */
/*  Singleton                                                          */
/* ------------------------------------------------------------------ */

let instance: TenantProvisioner | undefined;

/**
 * Returns (and lazily creates) the shared TenantProvisioner instance.
 */
export function getProvisioner(): TenantProvisioner {
  if (!instance) {
    instance = new TenantProvisioner();
  }
  return instance;
}

/* ------------------------------------------------------------------ */
/*  TenantProvisioner                                                  */
/* ------------------------------------------------------------------ */

/**
 * Manages Docker containers for team gateway instances.
 * Connects to the Docker Engine via unix socket using dockerode.
 */
export class TenantProvisioner {
  private docker: Docker;
  private imageName: string;

  constructor(opts?: { socketPath?: string; imageName?: string }) {
    this.docker = new Docker({
      socketPath: opts?.socketPath ?? "/var/run/docker.sock",
    });
    this.imageName = opts?.imageName ?? process.env.GATEWAY_IMAGE ?? "openclaw:latest";
  }

  /* ---------------------------------------------------------------- */
  /*  provision                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Provision a new tenant container for a team.
   * Allocates a port, creates the Docker container, starts it,
   * and records everything in the database.
   *
   * @param team - The team to provision for.
   * @returns Info about the newly provisioned tenant.
   * @throws If a tenant already exists for this team or Docker fails.
   */
  async provision(team: { id: string; slug: string }): Promise<TenantInfo> {
    const db = getDb();

    // Check if tenant already exists
    const [existing] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.teamId, team.id))
      .limit(1);

    if (existing) {
      throw new Error("Tenant already exists for this team");
    }

    const port = await this.allocatePort();
    const containerName = `aware-gw-${team.slug}`;
    const gatewayUrl = this.buildGatewayUrl(port, team.slug);
    const gatewayToken = crypto.randomBytes(32).toString("hex");
    const imageTag = "latest";
    const fullImage = `${this.imageName}:${imageTag}`;

    // Insert tenant row with status 'provisioning'
    const [tenant] = await db
      .insert(tenants)
      .values({
        teamId: team.id,
        containerName,
        port,
        gatewayUrl,
        status: "provisioning",
        imageTag,
      })
      .returning();

    try {
      // Create Docker container
      const container = await this.docker.createContainer({
        Image: fullImage,
        name: containerName,
        Env: [`OPENCLAW_GATEWAY_TOKEN=${gatewayToken}`, "HOME=/home/node", "TERM=xterm-256color"],
        ExposedPorts: {
          [`${CONTAINER_PORT}/tcp`]: {},
        },
        HostConfig: {
          PortBindings: {
            [`${CONTAINER_PORT}/tcp`]: [{ HostPort: String(port) }],
          },
          RestartPolicy: { Name: "unless-stopped" },
        },
      });

      // Start the container
      await container.start();

      const containerId = container.id;

      // Update tenant row with containerId and status
      await db
        .update(tenants)
        .set({
          containerId,
          status: "running",
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant.id));

      return {
        id: tenant.id,
        teamId: team.id,
        containerId,
        containerName,
        port,
        gatewayUrl,
        status: "running",
        imageTag,
      };
    } catch (err) {
      // Mark tenant as error if Docker operations fail
      await db
        .update(tenants)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));

      throw err;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  start                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Start a stopped tenant container.
   * @param teamId - The team whose tenant to start.
   * @throws If no tenant exists or the container cannot be started.
   */
  async start(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!tenant.containerId) {
      throw new Error("Tenant has no container ID — may need re-provisioning");
    }

    const container = this.docker.getContainer(tenant.containerId);
    await container.start();

    const db = getDb();
    await db
      .update(tenants)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));
  }

  /* ---------------------------------------------------------------- */
  /*  stop                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Stop a running tenant container.
   * @param teamId - The team whose tenant to stop.
   * @throws If no tenant exists or the container cannot be stopped.
   */
  async stop(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!tenant.containerId) {
      throw new Error("Tenant has no container ID — may need re-provisioning");
    }

    const container = this.docker.getContainer(tenant.containerId);
    await container.stop();

    const db = getDb();
    await db
      .update(tenants)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));
  }

  /* ---------------------------------------------------------------- */
  /*  remove                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Remove a tenant container entirely and delete the DB row.
   * Stops the container first if it is running.
   * @param teamId - The team whose tenant to remove.
   * @throws If no tenant exists for this team.
   */
  async remove(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (tenant.containerId) {
      const container = this.docker.getContainer(tenant.containerId);
      try {
        await container.stop();
      } catch {
        // Container may already be stopped — ignore
      }
      try {
        await container.remove({ force: true });
      } catch {
        // Container may already be removed — ignore
      }
    }

    const db = getDb();
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
  }

  /* ---------------------------------------------------------------- */
  /*  inspect                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Get container status from Docker for a team's tenant.
   * @param teamId - The team whose tenant to inspect.
   * @returns Current Docker container status.
   * @throws If no tenant or container exists.
   */
  async inspect(teamId: string): Promise<TenantStatus> {
    const tenant = await this.getTenant(teamId);

    if (!tenant.containerId) {
      return {
        running: false,
        state: "no_container",
        startedAt: null,
        finishedAt: null,
      };
    }

    const container = this.docker.getContainer(tenant.containerId);
    const info = await container.inspect();

    return {
      running: info.State.Running,
      state: info.State.Status,
      startedAt: info.State.StartedAt ?? null,
      finishedAt: info.State.FinishedAt ?? null,
    };
  }

  /* ---------------------------------------------------------------- */
  /*  syncStatus                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Sync the DB status with the actual Docker container state.
   * @param teamId - The team whose tenant status to sync.
   */
  async syncStatus(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!tenant.containerId) {
      return;
    }

    try {
      const status = await this.inspect(teamId);
      const dbStatus = status.running ? "running" : "stopped";

      const db = getDb();
      await db
        .update(tenants)
        .set({ status: dbStatus, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
    } catch {
      // Container may not exist anymore
      const db = getDb();
      await db
        .update(tenants)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Private helpers                                                  */
  /* ---------------------------------------------------------------- */

  /**
   * Allocate the next available host port for a tenant container.
   * Queries the DB for the highest allocated port and increments by 1.
   * Starts at BASE_PORT (19000) if no tenants exist.
   */
  private async allocatePort(): Promise<number> {
    const db = getDb();

    const [result] = await db.select({ maxPort: max(tenants.port) }).from(tenants);

    const maxPort = result?.maxPort;
    return maxPort ? maxPort + 1 : BASE_PORT;
  }

  /**
   * Build the gateway URL for a tenant.
   * Uses GATEWAY_BASE_URL env for production (e.g., "https://gw-{slug}.aware.dev"),
   * falls back to localhost for development.
   */
  private buildGatewayUrl(port: number, slug: string): string {
    const baseUrl = process.env.GATEWAY_BASE_URL;
    if (baseUrl) {
      // Production: e.g., "https://gw-{slug}.aware.dev"
      return baseUrl.replace("{slug}", slug).replace("{port}", String(port));
    }
    // Development: direct port access
    return `http://localhost:${port}`;
  }

  /**
   * Fetch the tenant row for a team or throw 404-style error.
   */
  private async getTenant(teamId: string) {
    const db = getDb();

    const [tenant] = await db.select().from(tenants).where(eq(tenants.teamId, teamId)).limit(1);

    if (!tenant) {
      throw new Error("No tenant found for this team");
    }

    return tenant;
  }
}
