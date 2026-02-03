/**
 * Tenant provisioning service for the Aware API.
 * Manages Kubernetes resources for team gateway instances on EKS.
 * Each team gets an isolated pod running the OpenClaw gateway image.
 *
 * When EKS is not configured (no EKS_CLUSTER_NAME), the provisioner
 * operates in local-dev mode: it records tenant rows in the DB but skips
 * all Kubernetes/AWS calls. This lets local development work without
 * AWS credentials or a cluster.
 * @module
 */

import crypto from "node:crypto";
import { eq, max } from "drizzle-orm";

import { KubeConfig, AppsV1Api, CoreV1Api, NetworkingV1Api } from "@kubernetes/client-node";
import { EKSClient, DescribeClusterCommand } from "@aws-sdk/client-eks";

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

/** Container-level status from Kubernetes (or local-dev fallback). */
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

/** Kubernetes namespace for tenant resources. */
const NAMESPACE = "tenants";

/** Token cache TTL — 14 minutes (EKS tokens expire at 15). */
const TOKEN_TTL_MS = 14 * 60 * 1000;

/** Static token TTL for dev mode — 1 hour. */
const STATIC_TOKEN_TTL_MS = 60 * 60 * 1000;

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

/** K8s provisioner configuration sourced from environment variables. */
interface K8sConfig {
  region: string;
  clusterName: string;
  gatewayImage: string;
  baseDomain: string;
  /** Direct endpoint override for dev (skips DescribeCluster). */
  clusterEndpoint?: string;
  /** Direct CA data override for dev. */
  clusterCA?: string;
  /** Direct bearer token override for dev. */
  authToken?: string;
}

/**
 * Read K8s configuration from environment variables.
 * Returns null if `EKS_CLUSTER_NAME` is not set (local-dev mode).
 */
function loadK8sConfig(): K8sConfig | null {
  const clusterName = process.env.EKS_CLUSTER_NAME;
  if (!clusterName) {
    return null;
  }

  return {
    region: process.env.AWS_REGION ?? "us-east-1",
    clusterName,
    gatewayImage: requiredEnv("GATEWAY_IMAGE"),
    baseDomain: process.env.GATEWAY_BASE_DOMAIN ?? "wareit.ai",
    clusterEndpoint: process.env.EKS_CLUSTER_ENDPOINT,
    clusterCA: process.env.EKS_CLUSTER_CA,
    authToken: process.env.EKS_AUTH_TOKEN,
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
/*  EKS IAM Token Generation (SigV4 presigned STS URL)                 */
/* ------------------------------------------------------------------ */

/**
 * Generate an EKS bearer token by creating a SigV4-presigned STS
 * GetCallerIdentity URL with the cluster name embedded.
 * This is the standard IAM authentication mechanism for EKS.
 *
 * Uses Node built-in crypto — no external signing libraries needed.
 */
async function generateEKSToken(
  clusterName: string,
  region: string,
  credentials: { accessKeyId: string; secretAccessKey: string; sessionToken?: string },
): Promise<string> {
  const host = `sts.${region}.amazonaws.com`;
  const datetime = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const date = datetime.slice(0, 8);
  const scope = `${date}/${region}/sts/aws4_request`;

  // Build query parameters (everything except X-Amz-Signature)
  const queryParams: Record<string, string> = {
    Action: "GetCallerIdentity",
    Version: "2011-06-15",
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${credentials.accessKeyId}/${scope}`,
    "X-Amz-Date": datetime,
    "X-Amz-Expires": "60",
    "X-Amz-SignedHeaders": "host;x-k8s-aws-id",
  };

  if (credentials.sessionToken) {
    queryParams["X-Amz-Security-Token"] = credentials.sessionToken;
  }

  // Canonical query string: sorted by key, URI-encoded
  const sortedKeys = Object.keys(queryParams).sort();
  const canonicalQueryString = sortedKeys
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(queryParams[k])}`)
    .join("&");

  // Canonical headers (lowercase, sorted)
  const canonicalHeaders = `host:${host}\nx-k8s-aws-id:${clusterName}\n`;

  // SHA-256 of empty request body
  const emptyBodyHash = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

  // Canonical request
  const canonicalRequest = [
    "GET",
    "/",
    canonicalQueryString,
    canonicalHeaders,
    "host;x-k8s-aws-id",
    emptyBodyHash,
  ].join("\n");

  // String to sign
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    datetime,
    scope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  // Derive signing key: HMAC chain
  const kDate = crypto
    .createHmac("sha256", `AWS4${credentials.secretAccessKey}`)
    .update(date)
    .digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update("sts").digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();

  // Final signature
  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  // Assemble presigned URL
  const url = `https://${host}/?${canonicalQueryString}&X-Amz-Signature=${signature}`;

  return `k8s-aws-v1.${Buffer.from(url).toString("base64url")}`;
}

/* ------------------------------------------------------------------ */
/*  TenantProvisioner                                                  */
/* ------------------------------------------------------------------ */

/**
 * Manages Kubernetes resources for team gateway instances on EKS.
 *
 * In production (EKS_CLUSTER_NAME is set), each tenant gets:
 *   - A K8s Secret for its gateway token
 *   - A Deployment running the gateway container
 *   - A ClusterIP Service
 *   - An Ingress with TLS (cert-manager + nginx)
 *
 * In local-dev mode (EKS_CLUSTER_NAME absent), tenant rows are created
 * in the database with status "provisioning" but no K8s resources.
 */
export class TenantProvisioner {
  private readonly k8sConfig: K8sConfig | null;
  private kubeConfig: KubeConfig | null = null;
  private tokenExpiry = 0;

  constructor() {
    this.k8sConfig = loadK8sConfig();

    if (this.k8sConfig) {
      console.log("[tenant-provisioner] K8s mode — cluster:", this.k8sConfig.clusterName);
    } else {
      console.warn(
        "[tenant-provisioner] Local-dev mode — EKS_CLUSTER_NAME not set, skipping K8s calls",
      );
    }
  }

  /* ---------------------------------------------------------------- */
  /*  K8s client helpers                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Build (and cache) a KubeConfig pointing at the EKS cluster.
   * In dev mode, uses explicit EKS_CLUSTER_ENDPOINT / CA / TOKEN env vars.
   * In production, calls DescribeCluster + generates an IAM-based bearer token.
   */
  private async getKubeConfig(): Promise<KubeConfig> {
    if (this.kubeConfig && Date.now() < this.tokenExpiry) {
      return this.kubeConfig;
    }

    const cfg = this.k8sConfig!;
    const kc = new KubeConfig();

    // Dev shortcut: explicit endpoint + CA + token env vars
    if (cfg.clusterEndpoint && cfg.clusterCA && cfg.authToken) {
      kc.loadFromClusterAndUser(
        {
          name: cfg.clusterName,
          server: cfg.clusterEndpoint,
          caData: cfg.clusterCA,
          skipTLSVerify: false,
        },
        { name: "api-user", token: cfg.authToken },
      );
      this.tokenExpiry = Date.now() + STATIC_TOKEN_TTL_MS;
      this.kubeConfig = kc;
      console.log("[tenant-provisioner] K8s config loaded from env vars (dev mode)");
      return kc;
    }

    // Production: IAM auth via EKS DescribeCluster + STS presigned URL
    const eksClient = new EKSClient({ region: cfg.region });
    const describeResult = await eksClient.send(
      new DescribeClusterCommand({ name: cfg.clusterName }),
    );
    const cluster = describeResult.cluster;

    if (!cluster?.endpoint || !cluster?.certificateAuthority?.data) {
      throw new Error(`Failed to describe EKS cluster: ${cfg.clusterName}`);
    }

    // Resolve IAM credentials from the EKS client's credential chain
    const credentials = await eksClient.config.credentials();
    const token = await generateEKSToken(cfg.clusterName, cfg.region, credentials);

    kc.loadFromClusterAndUser(
      {
        name: cfg.clusterName,
        server: cluster.endpoint,
        caData: cluster.certificateAuthority.data,
        skipTLSVerify: false,
      },
      { name: "api-user", token },
    );

    this.tokenExpiry = Date.now() + TOKEN_TTL_MS;
    this.kubeConfig = kc;
    console.log("[tenant-provisioner] K8s config loaded via IAM auth");
    return kc;
  }

  /**
   * Get fresh K8s API clients (core, apps, networking).
   * Handles token refresh automatically.
   */
  private async getK8sClients() {
    const kc = await this.getKubeConfig();
    return {
      core: kc.makeApiClient(CoreV1Api),
      apps: kc.makeApiClient(AppsV1Api),
      networking: kc.makeApiClient(NetworkingV1Api),
    };
  }

  /* ---------------------------------------------------------------- */
  /*  provision                                                        */
  /* ---------------------------------------------------------------- */

  /**
   * Provision a new tenant gateway for a team.
   *
   * In K8s mode: creates a Secret, Deployment, Service, and Ingress
   * in the `tenants` namespace.
   *
   * In local-dev mode: inserts a DB row with status "provisioning".
   *
   * @param team - The team to provision for.
   * @returns Info about the newly provisioned tenant.
   * @throws If a tenant already exists for this team or K8s calls fail.
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
    if (!this.isK8sConfigured()) {
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

    // --- K8s provisioning ---
    const cfg = this.k8sConfig!;
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
      const { core, apps, networking } = await this.getK8sClients();

      // 1. Create K8s Secret for the gateway token
      console.log(`[tenant-provisioner] Creating K8s Secret: ${team.slug}`);
      await core.createNamespacedSecret({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: team.slug,
            namespace: NAMESPACE,
            labels: { app: "gateway", tenant: team.slug, "managed-by": "aware-api" },
          },
          type: "Opaque",
          data: { token: Buffer.from(gatewayToken).toString("base64") },
        },
      });

      // 2. Create Deployment
      console.log(`[tenant-provisioner] Creating K8s Deployment: ${team.slug}`);
      await apps.createNamespacedDeployment({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: team.slug,
            namespace: NAMESPACE,
            labels: { app: "gateway", tenant: team.slug, "managed-by": "aware-api" },
          },
          spec: {
            replicas: 1,
            selector: { matchLabels: { tenant: team.slug } },
            template: {
              metadata: {
                labels: { app: "gateway", tenant: team.slug },
              },
              spec: {
                containers: [
                  {
                    name: "gateway",
                    image: `${cfg.gatewayImage}:${imageTag}`,
                    ports: [{ containerPort: CONTAINER_PORT }],
                    env: [
                      {
                        name: "OPENCLAW_GATEWAY_TOKEN",
                        valueFrom: {
                          secretKeyRef: { name: team.slug, key: "token" },
                        },
                      },
                    ],
                    resources: {
                      requests: { memory: "64Mi", cpu: "50m" },
                      limits: { memory: "256Mi", cpu: "250m" },
                    },
                    readinessProbe: {
                      httpGet: { path: "/", port: CONTAINER_PORT },
                      initialDelaySeconds: 5,
                      periodSeconds: 10,
                    },
                    livenessProbe: {
                      httpGet: { path: "/", port: CONTAINER_PORT },
                      initialDelaySeconds: 15,
                      periodSeconds: 30,
                    },
                  },
                ],
              },
            },
          },
        },
      });

      // 3. Create Service (ClusterIP)
      console.log(`[tenant-provisioner] Creating K8s Service: ${team.slug}`);
      await core.createNamespacedService({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: team.slug,
            namespace: NAMESPACE,
            labels: { app: "gateway", tenant: team.slug, "managed-by": "aware-api" },
          },
          spec: {
            selector: { tenant: team.slug },
            ports: [{ port: CONTAINER_PORT, targetPort: CONTAINER_PORT }],
          },
        },
      });

      // 4. Create Ingress (nginx + cert-manager TLS)
      console.log(`[tenant-provisioner] Creating K8s Ingress: ${team.slug}`);
      const hostname = `${team.slug}.${cfg.baseDomain}`;
      await networking.createNamespacedIngress({
        namespace: NAMESPACE,
        body: {
          metadata: {
            name: team.slug,
            namespace: NAMESPACE,
            labels: { app: "gateway", tenant: team.slug, "managed-by": "aware-api" },
            annotations: {
              "cert-manager.io/cluster-issuer": "letsencrypt",
            },
          },
          spec: {
            ingressClassName: "nginx",
            tls: [
              {
                hosts: [hostname],
                secretName: `${team.slug}-tls`,
              },
            ],
            rules: [
              {
                host: hostname,
                http: {
                  paths: [
                    {
                      path: "/",
                      pathType: "Prefix",
                      backend: {
                        service: {
                          name: team.slug,
                          port: { number: CONTAINER_PORT },
                        },
                      },
                    },
                  ],
                },
              },
            ],
          },
        },
      });

      // 5. Update tenant row with deployment name and status
      await db
        .update(tenants)
        .set({
          containerId: team.slug,
          status: "running",
          updatedAt: new Date(),
        })
        .where(eq(tenants.id, tenant.id));

      console.log(`[tenant-provisioner] Tenant provisioned: ${team.slug} → ${gatewayUrl}`);

      return {
        id: tenant.id,
        teamId: team.id,
        containerId: team.slug,
        containerName,
        port,
        gatewayUrl,
        status: "running",
        imageTag,
      };
    } catch (err) {
      // Mark tenant as error if any K8s operation fails
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
   * Start a stopped tenant by scaling the Deployment replicas to 1.
   * @param teamId - The team whose tenant to start.
   * @throws If no tenant exists or K8s patch fails.
   */
  async start(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!this.isK8sConfigured()) {
      console.log(`[tenant-provisioner] Local-dev: start is a no-op for ${tenant.containerName}`);
      const db = getDb();
      await db
        .update(tenants)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      return;
    }

    if (!tenant.containerId) {
      throw new Error("Tenant has no deployment — may need re-provisioning");
    }

    console.log(`[tenant-provisioner] Scaling up deployment: ${tenant.containerName}`);

    const { apps } = await this.getK8sClients();
    await apps.patchNamespacedDeploymentScale({
      name: tenant.containerName,
      namespace: NAMESPACE,
      body: { spec: { replicas: 1 } },
    });

    const db = getDb();
    await db
      .update(tenants)
      .set({ status: "running", updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    console.log(`[tenant-provisioner] Deployment scaled up: ${tenant.containerName}`);
  }

  /* ---------------------------------------------------------------- */
  /*  stop                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Stop a running tenant by scaling the Deployment replicas to 0.
   * @param teamId - The team whose tenant to stop.
   * @throws If no tenant exists or K8s patch fails.
   */
  async stop(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!this.isK8sConfigured()) {
      console.log(`[tenant-provisioner] Local-dev: stop is a no-op for ${tenant.containerName}`);
      const db = getDb();
      await db
        .update(tenants)
        .set({ status: "stopped", updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
      return;
    }

    if (!tenant.containerId) {
      throw new Error("Tenant has no deployment — may need re-provisioning");
    }

    console.log(`[tenant-provisioner] Scaling down deployment: ${tenant.containerName}`);

    const { apps } = await this.getK8sClients();
    await apps.patchNamespacedDeploymentScale({
      name: tenant.containerName,
      namespace: NAMESPACE,
      body: { spec: { replicas: 0 } },
    });

    const db = getDb();
    await db
      .update(tenants)
      .set({ status: "stopped", updatedAt: new Date() })
      .where(eq(tenants.id, tenant.id));

    console.log(`[tenant-provisioner] Deployment scaled down: ${tenant.containerName}`);
  }

  /* ---------------------------------------------------------------- */
  /*  remove                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Remove a tenant entirely: delete Ingress, Service, Deployment,
   * Secret, and DB row.
   *
   * @param teamId - The team whose tenant to remove.
   * @throws If no tenant exists for this team.
   */
  async remove(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);
    const slug = tenant.containerName;

    if (this.isK8sConfigured()) {
      console.log(`[tenant-provisioner] Removing K8s resources for: ${slug}`);
      const { core, apps, networking } = await this.getK8sClients();

      // Delete in reverse order: Ingress → Service → Deployment → Secret
      try {
        await networking.deleteNamespacedIngress({ name: slug, namespace: NAMESPACE });
        console.log(`[tenant-provisioner] Ingress deleted: ${slug}`);
      } catch (err) {
        console.warn(`[tenant-provisioner] Failed to delete Ingress:`, err);
      }

      try {
        await core.deleteNamespacedService({ name: slug, namespace: NAMESPACE });
        console.log(`[tenant-provisioner] Service deleted: ${slug}`);
      } catch (err) {
        console.warn(`[tenant-provisioner] Failed to delete Service:`, err);
      }

      try {
        await apps.deleteNamespacedDeployment({ name: slug, namespace: NAMESPACE });
        console.log(`[tenant-provisioner] Deployment deleted: ${slug}`);
      } catch (err) {
        console.warn(`[tenant-provisioner] Failed to delete Deployment:`, err);
      }

      try {
        await core.deleteNamespacedSecret({ name: slug, namespace: NAMESPACE });
        console.log(`[tenant-provisioner] Secret deleted: ${slug}`);
      } catch (err) {
        console.warn(`[tenant-provisioner] Failed to delete Secret:`, err);
      }
    } else {
      console.log(`[tenant-provisioner] Local-dev: skipping K8s cleanup for ${slug}`);
    }

    // Delete DB row
    const db = getDb();
    await db.delete(tenants).where(eq(tenants.id, tenant.id));
    console.log(`[tenant-provisioner] Tenant DB row deleted for ${slug}`);
  }

  /* ---------------------------------------------------------------- */
  /*  inspect                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Get Deployment status for a team's tenant.
   * @param teamId - The team whose tenant to inspect.
   * @returns Current deployment status.
   * @throws If no tenant exists.
   */
  async inspect(teamId: string): Promise<TenantStatus> {
    const tenant = await this.getTenant(teamId);

    if (!this.isK8sConfigured() || !tenant.containerId) {
      return {
        running: tenant.status === "running",
        state: tenant.status ?? "unknown",
        startedAt: null,
        finishedAt: null,
      };
    }

    try {
      const { apps } = await this.getK8sClients();
      const deployment = await apps.readNamespacedDeployment({
        name: tenant.containerName,
        namespace: NAMESPACE,
      });

      const running = (deployment.status?.readyReplicas ?? 0) > 0;
      const replicas = deployment.spec?.replicas ?? 0;
      const state = replicas === 0 ? "stopped" : running ? "running" : "starting";

      return {
        running,
        state,
        startedAt: deployment.metadata?.creationTimestamp
          ? new Date(deployment.metadata.creationTimestamp).toISOString()
          : null,
        finishedAt: null,
      };
    } catch (err) {
      console.error(`[tenant-provisioner] Failed to inspect deployment:`, err);
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
   * Sync the DB status with the actual Kubernetes Deployment state.
   * @param teamId - The team whose tenant status to sync.
   */
  async syncStatus(teamId: string): Promise<void> {
    const tenant = await this.getTenant(teamId);

    if (!this.isK8sConfigured() || !tenant.containerId) {
      return;
    }

    try {
      const status = await this.inspect(teamId);
      let dbStatus: string;

      if (status.running) {
        dbStatus = "running";
      } else if (status.state === "stopped") {
        dbStatus = "stopped";
      } else {
        // Transitional state (e.g. "starting") — keep current DB status
        return;
      }

      const db = getDb();
      await db
        .update(tenants)
        .set({ status: dbStatus as typeof tenant.status, updatedAt: new Date() })
        .where(eq(tenants.id, tenant.id));
    } catch {
      // Deployment read may fail if resource is being created/deleted
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
   * Check whether K8s is configured (production) or not (local-dev).
   */
  private isK8sConfigured(): boolean {
    return this.k8sConfig !== null;
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
}
