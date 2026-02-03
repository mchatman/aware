# ECS + EKS Migration Plan

## Overview

Migrate from ECS Fargate per-tenant to a split architecture:
- **ECS Fargate** — API (auth, billing, provisioning) — simple, set-and-forget
- **EKS** — Tenant gateways — Kubernetes handles scheduling, scaling, health checks
- **RDS** — Postgres (managed backups, failover)

## Architecture

```
Route 53
  api.wareit.ai ──→ ALB ──→ ECS Fargate (API)
  *.wareit.ai   ──→ NLB/Ingress ──→ EKS (tenant pods)
                                        │
                    RDS Postgres ←───────┘
                    (shared by API + tenants)
```

## Cost Estimate

| Resource | Monthly |
|---|---|
| EKS control plane | $75 |
| EC2 t3.small node (spot) | ~$6 |
| ECS Fargate (API, 0.25 vCPU) | ~$8 |
| RDS db.t4g.micro | ~$12 |
| ALB (API) | ~$16 |
| ECR | ~$1 |
| Route 53 | ~$0.50 |
| **Total** | **~$119/mo** |

Tenants share the EKS node — no per-tenant cost.
Current setup: ~$70/mo base + ~$8/mo per tenant.
Break-even at ~6 tenants. Cheaper at scale.

## What Changes

### ECS (stays, simplified)
- API task definition + service — same as today
- ALB with `api.wareit.ai` listener rule — same as today
- Remove: gateway task template, per-tenant services, per-tenant target groups/listener rules

### EKS (new)
- Cluster with one managed node group (t3.small spot)
- AWS Load Balancer Controller or Nginx Ingress for routing
- cert-manager + Let's Encrypt for TLS on `*.wareit.ai`
- Each tenant = Deployment + Service + Ingress + Secret

### RDS (stays)
- No changes

### API Provisioner (rewrite)
- Remove: ECS, ELBv2, SecretsManager SDK calls
- Add: @kubernetes/client-node
- Provision = create K8s Deployment + Service + Ingress + Secret
- Remove = delete those resources
- Start/stop = scale replicas 1/0
- Inspect = read pod status

## Kubernetes Manifests

### Namespace
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: tenants
```

### Tenant Deployment (template — created by API)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {slug}
  namespace: tenants
  labels:
    app: gateway
    tenant: {slug}
spec:
  replicas: 1
  selector:
    matchLabels:
      tenant: {slug}
  template:
    metadata:
      labels:
        app: gateway
        tenant: {slug}
    spec:
      containers:
      - name: gateway
        image: {ecr_url}/aware-gateway:latest
        ports:
        - containerPort: 18789
        env:
        - name: OPENCLAW_GATEWAY_TOKEN
          valueFrom:
            secretKeyRef:
              name: {slug}
              key: token
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "256Mi"
            cpu: "250m"
        readinessProbe:
          httpGet:
            path: /
            port: 18789
          initialDelaySeconds: 5
          periodSeconds: 10
        livenessProbe:
          httpGet:
            path: /
            port: 18789
          initialDelaySeconds: 15
          periodSeconds: 30
```

### Tenant Service
```yaml
apiVersion: v1
kind: Service
metadata:
  name: {slug}
  namespace: tenants
spec:
  selector:
    tenant: {slug}
  ports:
  - port: 18789
    targetPort: 18789
```

### Tenant Ingress
```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {slug}
  namespace: tenants
  annotations:
    cert-manager.io/cluster-issuer: letsencrypt
spec:
  ingressClassName: nginx
  tls:
  - hosts:
    - {slug}.wareit.ai
    secretName: {slug}-tls
  rules:
  - host: {slug}.wareit.ai
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: {slug}
            port:
              number: 18789
```

### Tenant Secret
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: {slug}
  namespace: tenants
type: Opaque
data:
  token: {base64-encoded-gateway-token}
```

## Provisioner Rewrite

```typescript
// Before (ECS)
import { ECSClient, CreateServiceCommand } from "@aws-sdk/client-ecs";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { SecretsManagerClient } from "@aws-sdk/client-secrets-manager";

// After (Kubernetes)
import * as k8s from "@kubernetes/client-node";

class TenantProvisioner {
  private k8sApps: k8s.AppsV1Api;
  private k8sCore: k8s.CoreV1Api;
  private k8sNetworking: k8s.NetworkingV1Api;

  async provision(team: { id: string; slug: string }) {
    const namespace = "tenants";
    const token = crypto.randomBytes(32).toString("hex");

    // 1. Create Secret
    await this.k8sCore.createNamespacedSecret(namespace, {
      metadata: { name: team.slug },
      type: "Opaque",
      data: { token: Buffer.from(token).toString("base64") },
    });

    // 2. Create Deployment
    await this.k8sApps.createNamespacedDeployment(namespace, {
      metadata: { name: team.slug, labels: { app: "gateway", tenant: team.slug } },
      spec: { /* ... from template above */ },
    });

    // 3. Create Service
    await this.k8sCore.createNamespacedService(namespace, {
      metadata: { name: team.slug },
      spec: { /* ... */ },
    });

    // 4. Create Ingress
    await this.k8sNetworking.createNamespacedIngress(namespace, {
      metadata: { name: team.slug },
      spec: { /* ... */ },
    });

    // 5. Update DB
    const gatewayUrl = `wss://${team.slug}.wareit.ai`;
    // ... insert tenant row with status "running"
  }

  async stop(teamId: string) {
    // Scale to 0
    await this.k8sApps.patchNamespacedDeploymentScale(slug, "tenants", {
      spec: { replicas: 0 },
    });
  }

  async start(teamId: string) {
    // Scale to 1
    await this.k8sApps.patchNamespacedDeploymentScale(slug, "tenants", {
      spec: { replicas: 1 },
    });
  }

  async remove(teamId: string) {
    await this.k8sNetworking.deleteNamespacedIngress(slug, "tenants");
    await this.k8sCore.deleteNamespacedService(slug, "tenants");
    await this.k8sApps.deleteNamespacedDeployment(slug, "tenants");
    await this.k8sCore.deleteNamespacedSecret(slug, "tenants");
  }

  async inspect(teamId: string) {
    const deployment = await this.k8sApps.readNamespacedDeployment(slug, "tenants");
    const running = (deployment.body.status?.readyReplicas ?? 0) > 0;
    // ...
  }
}
```

## Terraform Changes

### Keep (modify)
- `vpc.tf` — keep VPC, add EKS subnets if needed
- `rds.tf` — no changes
- `dns.tf` — update wildcard to point at EKS ingress
- `ecr.tf` — no changes
- `security.tf` — add EKS security groups

### Keep (as-is)
- `secrets.tf` — for API secrets (JWT, Stripe, DB URL)
- API-related ALB + ECS resources

### Remove
- Gateway task definition template
- Gateway-specific IAM roles (replace with EKS IRSA if needed)

### Add
- `eks.tf` — EKS cluster + managed node group
- `k8s/` directory — base Kubernetes manifests (namespace, ingress controller, cert-manager)

## Migration Steps

### Phase 1: EKS Cluster
1. Add EKS cluster + node group to Terraform
2. Install Nginx Ingress Controller + cert-manager
3. Create `tenants` namespace
4. Verify with a test pod

### Phase 2: API Provisioner
1. Add `@kubernetes/client-node` dependency
2. Rewrite TenantProvisioner to use K8s API
3. Configure API pod/task with kubeconfig or IRSA for EKS access
4. Test provision/start/stop/remove locally

### Phase 3: DNS + Cutover
1. Point `*.wareit.ai` at EKS ingress
2. Re-provision existing tenants
3. Remove old ECS gateway resources from Terraform

### Phase 4: Cleanup
1. Remove ECS gateway Terraform resources
2. Remove ECS/ELBv2/SecretsManager SDK deps from API
3. Update docs
