/**
 * Tenant provisioning service for the Aware API.
 * Manages ECS Fargate services for team gateway instances.
 * Each team gets an isolated ECS service running the OpenClaw gateway image.
 *
 * When AWS ECS is not configured (no ECS_CLUSTER_ARN), the provisioner
 * operates in local-dev mode: it records tenant rows in the DB but skips
 * all AWS calls. This lets local development work without AWS credentials.
 * @module
 */

import crypto from "node:crypto";
import { eq, max } from "drizzle-orm";

import {
  ECSClient,
  RegisterTaskDefinitionCommand,
  DeregisterTaskDefinitionCommand,
  CreateServiceCommand,
  UpdateServiceCommand,
  DeleteServiceCommand,
  DescribeServicesCommand,
  type KeyValuePair,
  type Secret,
} from "@aws-sdk/client-ecs";
import {
  ElasticLoadBalancingV2Client,
  CreateTargetGroupCommand,
  CreateRuleCommand,
  DeleteTargetGroupCommand,
  DeleteRuleCommand,
  DescribeRulesCommand,
  DescribeTargetGroupsCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  SecretsManagerClient,
  CreateSecretCommand,
  DeleteSecretCommand,
} from "@aws-sdk/client-secrets-manager";

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

/** Container-level status from ECS (or local-dev fallback). */
export interface TenantStatus {
  running: boolean;
  state: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/** Internal gateway port inside the container. */
const CONTAINER_PORT = 18789;

/** First port in the tenant allocation range (used for DB port column). */
const BASE_PORT = 19000;

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
/*  Configuration                                                      */
/* ------------------------------------------------------------------ */

/** ECS provisioner configuration sourced from environment variables. */
interface ECSConfig {
  region: string;
  clusterArn: string;
  httpsListenerArn: string;
  vpcId: string;
  gatewayImage: string;
  executionRoleArn: string;
  taskRoleArn: string;
  baseDomain: string;
  logGroup: string;
}

/**
 * Read ECS configuration from environment variables.
 * Returns null if `ECS_CLUSTER_ARN` is not set (local-dev mode).
 */
function loadECSConfig(): ECSConfig | null {
  const clusterArn = process.env.ECS_CLUSTER_ARN;
  if (!clusterArn) {
    return null;
  }

  return {
    region: process.env.AWS_REGION ?? "us-east-1",
    clusterArn,
    httpsListenerArn: requiredEnv("HTTPS_LISTENER_ARN"),
    vpcId: requiredEnv("VPC_ID"),
    gatewayImage: requiredEnv("GATEWAY_IMAGE"),
    executionRoleArn: requiredEnv("ECS_EXECUTION_ROLE_ARN"),
    taskRoleArn: requiredEnv("ECS_GATEWAY_TASK_ROLE_ARN"),
    baseDomain: process.env.GATEWAY_BASE_DOMAIN ?? "wareit.ai",
    logGroup: process.env.GATEWAY_LOG_GROUP ?? "/ecs/aware-gateway",
  };
}

/**
 * Read a required environment variable or throw a descriptive error.
 */
function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

/* ------------------------------------------------------------------ */
/*  TenantProvisioner                                                  */
/* ------------------------------------------------------------------ */

/**
 * Manages ECS Fargate services for team gateway instances.
 *
 * In production (ECS_CLUSTER_ARN is set), each tenant gets:
 *   - A Secrets Manager secret for its gateway token
 *   - A dedicated ECS task definition
 *   - An ALB target group + listener rule for host-based routing
 *   - An ECS Fargate service running one task
 *
 * In local-dev mode (ECS_CLUSTER_ARN absent), tenant rows are created
 * in the database with status "provisioning" but no AWS resources.
 */
export class TenantProvisioner {
  private readonly ecsConfig: ECSConfig | null;
  private readonly ecs: ECSClient | null;
  private readonly elbv2: ElasticLoadBalancingV2Client | null;
  private readonly secrets: SecretsManagerClient | null;

  constructor() {
    this.ecsConfig = loadECSConfig();

    if (this.ecsConfig) {
      const region = this.ecsConfig.region;
      this.ecs = new ECSClient({ region });
      this.elbv2 = new ElasticLoadBalancingV2Client({ region });
      this.secrets = new SecretsManagerClient({ region });
      console.log("[tenant-provisioner] ECS mode — cluster:", this.ecsConfig.clusterArn);
    } else {
      this.ecs = null;
      this.elbv2 = null;
      this.secrets = null;
      console.warn(
        "[tenant-provisioner] Local-dev mode — ECS_CLUSTER_ARN not set, skipping AWS calls",
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /*  provision                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Provision a new tenant gateway for a team.
   *
   * In ECS mode: creates Secrets Manager secret, task definition,
   * ALB target group + listener rule, and ECS service.
   *
   * In local-dev mode: inserts a DB row with status "provisioning".
   *
   * @param team - The team to provision for.
   * @returns Info about the newly provisioned tenant.
   * @throws If a tenant already exists for this team or AWS calls fail.
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
    const containerName = team.slug;
    const gatewayToken = crypto.randomBytes(32).toString("hex");
    const imageTag = "latest";

    // Local-dev fallback
    if (!this.isECSConfigured()) {
      const gatewayUrl = `http://localhost:${port}`;

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

      console.log(`[tenant-provisioner] Local-dev: created tenant row for ${team.slug}`);

      return {
        id: tenant.id,
        teamId: team.id,
        containerId: null,
        containerName,
        port,
        gatewayUrl,
        status: "provisioning",
        imageTag,
      };
    }

    // --- ECS provisioning ---
    const cfg = this.ecsConfig!;
    const gatewayUrl = `wss://${team.slug}.${cfg.baseDomain}`;

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
      // 1. Create Secrets Manager secret for the gateway token
      const secretName = `aware/gateway-token/${team.slug}`;
      console.log(`[tenant-provisioner] Creating secret: ${secretName}`);

      const secretResult = await this.secrets!.send(
        new CreateSecretCommand({
          Name: secretName,
          SecretString: gatewayToken,
          Description: `Gateway token for tenant ${team.slug}`,
          Tags: [
            { Key: "tenant", Value: team.slug },
            { Key: "managed-by", Value: "aware-api" },
          ],
        }),
      );
      const secretArn = secretResult.ARN!;
      console.log(`[tenant-provisioner] Secret created: ${secretArn}`);

      // 2. Register ECS task definition for this tenant
      const taskFamily = team.slug;
      console.log(`[tenant-provisioner] Registering task definition: ${taskFamily}`);

      const environment: KeyValuePair[] = [
        { name: "HOME", value: "/home/node" },
        { name: "TERM", value: "xterm-256color" },
      ];

      const secrets_list: Secret[] = [{ name: "OPENCLAW_GATEWAY_TOKEN", valueFrom: secretArn }];

      const taskDefResult = await this.ecs!.send(
        new RegisterTaskDefinitionCommand({
          family: taskFamily,
          requiresCompatibilities: ["EC2"],
          networkMode: "bridge",
          executionRoleArn: cfg.executionRoleArn,
          taskRoleArn: cfg.taskRoleArn,
          containerDefinitions: [
            {
              name: "gateway",
              image: `${cfg.gatewayImage}:${imageTag}`,
              essential: true,
              command: ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"],
              portMappings: [
                {
                  containerPort: CONTAINER_PORT,
                  hostPort: 0, // Dynamic port — ALB routes via target group
                  protocol: "tcp",
                },
              ],
              memory: 256, // Hard limit in MiB for EC2 launch type
              environment,
              secrets: secrets_list,
              logConfiguration: {
                logDriver: "awslogs",
                options: {
                  "awslogs-group": cfg.logGroup,
                  "awslogs-region": cfg.region,
                  "awslogs-stream-prefix": team.slug,
                },
              },
            },
          ],
          tags: [
            { key: "tenant", value: team.slug },
            { key: "managed-by", value: "aware-api" },
          ],
        }),
      );
      const taskDefArn = taskDefResult.taskDefinition!.taskDefinitionArn!;
      console.log(`[tenant-provisioner] Task definition registered: ${taskDefArn}`);

      // 3. Create ALB target group
      const tgName = team.slug.slice(0, 32); // ALB TG names max 32 chars
      console.log(`[tenant-provisioner] Creating target group: ${tgName}`);

      const tgResult = await this.elbv2!.send(
        new CreateTargetGroupCommand({
          Name: tgName,
          Protocol: "HTTP",
          Port: CONTAINER_PORT,
          VpcId: cfg.vpcId,
          TargetType: "ip",
          HealthCheckProtocol: "HTTP",
          HealthCheckPort: String(CONTAINER_PORT),
          HealthCheckPath: "/",
          HealthCheckIntervalSeconds: 30,
          HealthCheckTimeoutSeconds: 5,
          HealthyThresholdCount: 2,
          UnhealthyThresholdCount: 3,
          Tags: [
            { Key: "tenant", Value: team.slug },
            { Key: "managed-by", Value: "aware-api" },
          ],
        }),
      );
      const tgArn = tgResult.TargetGroups![0].TargetGroupArn!;
      console.log(`[tenant-provisioner] Target group created: ${tgArn}`);

      // 4. Create ALB listener rule (host-header based routing)
      const hostHeader = `${team.slug}.${cfg.baseDomain}`;
      console.log(`[tenant-provisioner] Creating listener rule for: ${hostHeader}`);

      // Find the next available priority
      const priority = await this.getNextRulePriority();

      await this.elbv2!.send(
        new CreateRuleCommand({
          ListenerArn: cfg.httpsListenerArn,
          Priority: priority,
          Conditions: [
            {
              Field: "host-header",
              Values: [hostHeader],
            },
          ],
          Actions: [
            {
              Type: "forward",
              TargetGroupArn: tgArn,
            },
          ],
          Tags: [
            { Key: "tenant", Value: team.slug },
            { Key: "managed-by", Value: "aware-api" },
          ],
        }),
      );
      console.log(
        `[tenant-provisioner] Listener rule created for ${hostHeader} (priority ${priority})`,
      );

      // 5. Create ECS service
      const serviceName = team.slug;
      console.log(`[tenant-provisioner] Creating ECS service: ${serviceName}`);

      const serviceResult = await this.ecs!.send(
        new CreateServiceCommand({
          cluster: cfg.clusterArn,
          serviceName,
          taskDefinition: taskDefArn,
          desiredCount: 1,
          launchType: "EC2",
          loadBalancers: [
            {
              targetGroupArn: tgArn,
              containerName: "gateway",
              containerPort: CONTAINER_PORT,
            },
          ],
          healthCheckGracePeriodSeconds: 60,
          deploymentConfiguration: {
            maximumPercent: 200,
            minimumHealthyPercent: 100,
          },
          tags: [
            { key: "tenant", value: team.slug },
            { key: "managed-by", value: "aware-api" },
          ],
        }),
      );
      const serviceArn = serviceResult.service!.serviceArn!;
      console.log(`[tenant-provisioner] ECS service created: ${serviceArn}`);

      // 6. Update tenant row with ECS service ARN and status
      await db
        .update(tenants)
        .set({
          containerId: serviceArn,
          status: "running",
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant.id));

      return {
        id: tenant.id,
        teamId: team.id,
        containerId: serviceArn,
        containerName,
        port,
        gatewayUrl,
        status: "running",
        imageTag,
      };
    } catch (err) {
      // Mark tenant as error if any AWS operation fails
      await db
        .update(tenants)
        .set({ status: "error", updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));

      console.error(`[tenant-provisioner] Provision failed for ${team.slug}:`, err);
      throw err;
    }
  }

  /* ---------------------------------------------------------------- */
  /*  start                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Start a stopped tenant by setting ECS service desired count to 1.
   * @param teamId - The team whose tenant to start.
   * @throws If no tenant exists or ECS update fails.
   */
  async start(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!this.isECSConfigured()) {
      console.log(`[tenant-provisioner] Local-dev: start is a no-op for ${tenant.containerName}`);
      const db = getDb();
      await db
        .update(tenants)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      return;
    }

    if (!tenant.containerId) {
      throw new Error("Tenant has no ECS service ARN — may need re-provisioning");
    }

    console.log(`[tenant-provisioner] Starting ECS service: ${tenant.containerName}`);

    await this.ecs!.send(
      new UpdateServiceCommand({
        cluster: this.ecsConfig!.clusterArn,
        service: tenant.containerName,
        desiredCount: 1,
      }),
    );

    const db = getDb();
    await db
      .update(tenants)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    console.log(`[tenant-provisioner] ECS service started: ${tenant.containerName}`);
  }

  /* ---------------------------------------------------------------- */
  /*  stop                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Stop a running tenant by setting ECS service desired count to 0.
   * @param teamId - The team whose tenant to stop.
   * @throws If no tenant exists or ECS update fails.
   */
  async stop(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!this.isECSConfigured()) {
      console.log(`[tenant-provisioner] Local-dev: stop is a no-op for ${tenant.containerName}`);
      const db = getDb();
      await db
        .update(tenants)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      return;
    }

    if (!tenant.containerId) {
      throw new Error("Tenant has no ECS service ARN — may need re-provisioning");
    }

    console.log(`[tenant-provisioner] Stopping ECS service: ${tenant.containerName}`);

    await this.ecs!.send(
      new UpdateServiceCommand({
        cluster: this.ecsConfig!.clusterArn,
        service: tenant.containerName,
        desiredCount: 0,
      }),
    );

    const db = getDb();
    await db
      .update(tenants)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    console.log(`[tenant-provisioner] ECS service stopped: ${tenant.containerName}`);
  }

  /* ---------------------------------------------------------------- */
  /*  remove                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Remove a tenant entirely: delete ECS service, task definition,
   * ALB listener rule + target group, Secrets Manager secret, and DB row.
   *
   * @param teamId - The team whose tenant to remove.
   * @throws If no tenant exists for this team.
   */
  async remove(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);
    const slug = tenant.containerName;

    if (this.isECSConfigured()) {
      const cfg = this.ecsConfig!;

      // 1. Scale down service first (fast operation)
      if (tenant.containerId) {
        console.log(`[tenant-provisioner] Scaling down ECS service: ${tenant.containerName}`);
        try {
          await this.withTimeout(
            this.ecs!.send(
              new UpdateServiceCommand({
                cluster: cfg.clusterArn,
                service: tenant.containerName,
                desiredCount: 0,
              }),
            ),
            10000, // 10 second timeout
          );
        } catch (err) {
          console.warn(`[tenant-provisioner] Failed to scale down service:`, err);
        }

        // Mark tenant as stopped in DB immediately (being torn down)
        const db = getDb();
        await db
          .update(tenants)
          .set({ status: "stopped", updatedAt: new Date() })
          .where(eq(tenants.id, tenant.id));

        // Start async cleanup (don't wait for completion)
        this.cleanupTenantResources(cfg, tenant.containerName, slug).catch((err) => {
          console.error(`[tenant-provisioner] Async cleanup failed for ${slug}:`, err);
        });
      }
    } else {
      console.log(
        `[tenant-provisioner] Local-dev: skipping AWS cleanup for ${tenant.containerName}`,
      );
    }

    // Delete DB row immediately (tenant is marked as removing)
    const db = getDb();
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    console.log(`[tenant-provisioner] Tenant DB row deleted for ${slug}`);
  }

  /**
   * Perform async cleanup of AWS resources for a tenant.
   * This runs in the background and doesn't block the API response.
   */
  private async cleanupTenantResources(
    cfg: ECSConfig,
    containerName: string,
    slug: string,
  ): Promise<void> {
    console.log(`[tenant-provisioner] Starting async cleanup for ${slug}`);

    // 1. Delete ECS service (this can take several minutes)
    try {
      console.log(`[tenant-provisioner] Deleting ECS service: ${containerName}`);
      await this.withTimeout(
        this.ecs!.send(
          new DeleteServiceCommand({
            cluster: cfg.clusterArn,
            service: containerName,
            force: true,
          }),
        ),
        120000, // 2 minute timeout
      );
      console.log(`[tenant-provisioner] ECS service deleted: ${containerName}`);
    } catch (err) {
      console.warn(`[tenant-provisioner] Failed to delete ECS service:`, err);
    }

    // 2. Deregister task definition
    const taskFamily = slug;
    try {
      console.log(`[tenant-provisioner] Deregistering task definition: ${taskFamily}`);
      await this.withTimeout(
        this.ecs!.send(
          new DeregisterTaskDefinitionCommand({
            taskDefinition: `${taskFamily}:1`,
          }),
        ),
        30000, // 30 second timeout
      );
      console.log(`[tenant-provisioner] Task definition deregistered: ${taskFamily}`);
    } catch (err) {
      console.warn(`[tenant-provisioner] Failed to deregister task definition:`, err);
    }

    // 3. Delete ALB listener rule + target group
    try {
      await this.withTimeout(this.deleteListenerRuleForSlug(slug), 30000);
      await this.withTimeout(this.deleteTargetGroupForSlug(slug), 30000);
    } catch (err) {
      console.warn(`[tenant-provisioner] Failed to delete ALB resources:`, err);
    }

    // 4. Delete Secrets Manager secret
    const secretName = `aware/gateway-token/${slug}`;
    try {
      console.log(`[tenant-provisioner] Deleting secret: ${secretName}`);
      await this.withTimeout(
        this.secrets!.send(
          new DeleteSecretCommand({
            SecretId: secretName,
            ForceDeleteWithoutRecovery: true,
          }),
        ),
        30000, // 30 second timeout
      );
      console.log(`[tenant-provisioner] Secret deleted: ${secretName}`);
    } catch (err) {
      console.warn(`[tenant-provisioner] Failed to delete secret:`, err);
    }

    console.log(`[tenant-provisioner] Async cleanup completed for ${slug}`);
  }

  /**
   * Wrapper to add timeout to async operations.
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs);
    });

    return Promise.race([promise, timeoutPromise]);
  }

  /* ---------------------------------------------------------------- */
  /*  inspect                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Get ECS service status for a team's tenant.
   * @param teamId - The team whose tenant to inspect.
   * @returns Current service status.
   * @throws If no tenant exists.
   */
  async inspect(teamId: string): Promise<TenantStatus> {
    const tenant = await this.getTenant(teamId);

    if (!this.isECSConfigured() || !tenant.containerId) {
      return {
        running: tenant.status === "running",
        state: tenant.status ?? "unknown",
        startedAt: null,
        finishedAt: null,
      };
    }

    try {
      const result = await this.ecs!.send(
        new DescribeServicesCommand({
          cluster: this.ecsConfig!.clusterArn,
          services: [tenant.containerName],
        }),
      );

      const service = result.services?.[0];
      if (!service) {
        return {
          running: false,
          state: "not_found",
          startedAt: null,
          finishedAt: null,
        };
      }

      const running = (service.runningCount ?? 0) > 0;
      const state = service.status ?? "UNKNOWN";

      return {
        running,
        state,
        startedAt: service.createdAt?.toISOString() ?? null,
        finishedAt: null,
      };
    } catch (err) {
      console.error(`[tenant-provisioner] Failed to inspect ECS service:`, err);
      return {
        running: false,
        state: "error",
        startedAt: null,
        finishedAt: null,
      };
    }
  }

  /* ---------------------------------------------------------------- */
  /*  syncStatus                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Sync the DB status with the actual ECS service state.
   * @param teamId - The team whose tenant status to sync.
   */
  async syncStatus(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!this.isECSConfigured() || !tenant.containerId) {
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
      // ECS describe may fail if service is being created/deleted
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
   * Check whether ECS is configured (production) or not (local-dev).
   */
  private isECSConfigured(): boolean {
    return this.ecsConfig !== null;
  }

  /**
   * Allocate the next available port for a tenant.
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
   * Fetch the tenant row for a team or throw a 404-style error.
   */
  private async getTenant(teamId: string) {
    const db = getDb();
    const [tenant] = await db.select().from(tenants).where(eq(tenants.teamId, teamId)).limit(1);

    if (!tenant) {
      throw new Error("No tenant found for this team");
    }

    return tenant;
  }

  /**
   * Determine the next available ALB listener rule priority.
   * Lists existing rules and returns max + 1 (starting at 100).
   */
  private async getNextRulePriority(): Promise<number> {
    const cfg = this.ecsConfig!;

    const result = await this.elbv2!.send(
      new DescribeRulesCommand({
        ListenerArn: cfg.httpsListenerArn,
      }),
    );

    const priorities = (result.Rules ?? [])
      .map((r) => Number(r.Priority))
      .filter((p) => !Number.isNaN(p));

    if (priorities.length === 0) {
      return 100;
    }

    return Math.max(...priorities) + 1;
  }

  /**
   * Find and delete the ALB listener rule for a given tenant slug.
   * Matches rules by host-header condition containing `{slug}.{domain}`.
   */
  private async deleteListenerRuleForSlug(slug: string): Promise<void> {
    const cfg = this.ecsConfig!;
    const hostHeader = `${slug}.${cfg.baseDomain}`;

    try {
      console.log(`[tenant-provisioner] Looking up listener rule for: ${hostHeader}`);

      const rulesResult = await this.elbv2!.send(
        new DescribeRulesCommand({
          ListenerArn: cfg.httpsListenerArn,
        }),
      );

      const rule = (rulesResult.Rules ?? []).find((r) =>
        r.Conditions?.some((c) => c.Field === "host-header" && c.Values?.includes(hostHeader)),
      );

      if (rule?.RuleArn) {
        await this.elbv2!.send(new DeleteRuleCommand({ RuleArn: rule.RuleArn }));
        console.log(`[tenant-provisioner] Listener rule deleted for ${hostHeader}`);
      } else {
        console.warn(`[tenant-provisioner] No listener rule found for ${hostHeader}`);
      }
    } catch (err) {
      console.warn(`[tenant-provisioner] Failed to delete listener rule:`, err);
    }
  }

  /**
   * Delete the ALB target group for a given tenant slug.
   * Target group name: `{slug}` (truncated to 32 chars).
   */
  private async deleteTargetGroupForSlug(slug: string): Promise<void> {
    const tgName = slug.slice(0, 32);

    try {
      console.log(`[tenant-provisioner] Deleting target group: ${tgName}`);

      const descResult = await this.elbv2!.send(
        new DescribeTargetGroupsCommand({ Names: [tgName] }),
      );

      const tgArn = descResult.TargetGroups?.[0]?.TargetGroupArn;
      if (tgArn) {
        await this.elbv2!.send(new DeleteTargetGroupCommand({ TargetGroupArn: tgArn }));
        console.log(`[tenant-provisioner] Target group deleted: ${tgName}`);
      } else {
        console.warn(`[tenant-provisioner] Target group not found: ${tgName}`);
      }
    } catch (err) {
      console.warn(`[tenant-provisioner] Failed to delete target group:`, err);
    }
  }
}
