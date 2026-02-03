# k3s Migration Plan

## Overview

Migrate from ECS Fargate (container-per-tenant) to k3s on a single EC2 instance.
Each tenant becomes a Kubernetes Pod instead of a separate ECS service.
Portable to EKS for production — same manifests, same API.

## Architecture

```
Route 53
  api.wareit.ai    ─┐
  *.wareit.ai      ─┤
                    ↓
              Elastic IP
                    ↓
         ┌─────────────────────────────────┐
         │  EC2 (t3.small) + k3s           │
         │                                 │
         │  Traefik Ingress (:443)         │
         │    api.wareit.ai  → API svc     │
         │    acme.wareit.ai → tenant pod  │
         │    globex.wareit.ai → tenant pod│
         │                                 │
         │  Pods:                          │
         │    aware-api (always running)   │
         │    postgres (StatefulSet)       │
         │    tenant-acme                  │
         │    tenant-globex                │
         │                                 │
         │  cert-manager (Let's Encrypt)   │
         └─────────────────────────────────┘
```

## What Changes

### Remove
- ECS cluster, task definitions, services
- ALB, target groups, listener rules
- NAT Gateway (~$32/mo saved)
- Private subnets (single node doesn't need them)
- ACM certificate (replaced by cert-manager + Let's Encrypt)
- Secrets Manager (replaced by Kubernetes Secrets)
- IAM ECS roles

### Keep
- Route 53 hosted zone
- ECR repositories (k3s pulls images from ECR)
- VPC (simplified — public subnet only)

### Add
- EC2 instance with k3s (user-data bootstrap)
- Elastic IP
- Security group (22, 80, 443, 6443)
- Kubernetes manifests:
  - API Deployment + Service + IngressRoute
  - Postgres StatefulSet + PVC + Service
  - cert-manager (Helm chart)
  - Tenant template (Deployment + Service + IngressRoute)

### API Provisioner Rewrite
- Replace ECS/ALB/SecretsManager SDK calls with Kubernetes API
- Provision tenant = create Deployment + Service + IngressRoute
- Remove tenant = delete those resources
- Start/stop = scale replicas 1/0
- Inspect = read pod status

## Cost Comparison

| | Current (ECS Fargate) | k3s |
|---|---|---|
| Compute (base) | ~$8/mo (API task) | ~$15/mo (t3.small) |
| NAT Gateway | ~$32/mo | $0 |
| ALB | ~$16/mo | $0 (Traefik built-in) |
| RDS | ~$12/mo | $0 (Postgres pod) |
| Secrets Manager | ~$2/mo | $0 (K8s Secrets) |
| ACM | $0 | $0 (Let's Encrypt) |
| Per tenant | ~$8/mo each | ~$0 (shared node) |
| EIP | $0 | $3.75/mo |
| **Total (0 tenants)** | **~$70/mo** | **~$19/mo** |
| **Total (10 tenants)** | **~$150/mo** | **~$19/mo** |
| **Total (50 tenants)** | **~$470/mo** | **~$19/mo*** |

*Until you need a bigger instance. t3.small (2GB) handles ~20-30 tenants.
Upgrade to t3.medium (4GB, ~$30/mo) for 50+.

## Kubernetes Manifests

### API (always running)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: aware
spec:
  replicas: 1
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
    spec:
      containers:
      - name: api
        image: <ecr>/aware-api:latest
        ports:
        - containerPort: 3001
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: aware-secrets
              key: database-url
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: aware-secrets
              key: jwt-secret
```

### Tenant (created dynamically by API)
```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tenant-{slug}
  namespace: aware
  labels:
    app: tenant
    tenant: {slug}
spec:
  replicas: 1
  selector:
    matchLabels:
      tenant: {slug}
  template:
    metadata:
      labels:
        app: tenant
        tenant: {slug}
    spec:
      containers:
      - name: gateway
        image: <ecr>/aware-gateway:latest
        ports:
        - containerPort: 18789
        env:
        - name: OPENCLAW_GATEWAY_TOKEN
          valueFrom:
            secretKeyRef:
              name: tenant-{slug}-token
              key: token
        resources:
          requests:
            memory: "64Mi"
            cpu: "50m"
          limits:
            memory: "256Mi"
            cpu: "250m"
```

### Ingress (per tenant)
```yaml
apiVersion: traefik.io/v1alpha1
kind: IngressRoute
metadata:
  name: tenant-{slug}
  namespace: aware
spec:
  entryPoints:
  - websecure
  routes:
  - match: Host(`{slug}.wareit.ai`)
    kind: Rule
    services:
    - name: tenant-{slug}
      port: 18789
  tls:
    certResolver: letsencrypt
```

## Migration Steps

### Phase 1: Terraform
1. Add EC2 instance + EIP + security group
2. k3s bootstrap via user-data script
3. Update Route 53 to point at EIP
4. Keep old ECS infra running in parallel

### Phase 2: Kubernetes Manifests
1. Deploy Postgres StatefulSet
2. Migrate data from RDS
3. Deploy API
4. Deploy cert-manager + ClusterIssuer

### Phase 3: API Provisioner
1. Replace ECS SDK with @kubernetes/client-node
2. Provision = create Deployment + Service + IngressRoute + Secret
3. Remove = delete resources
4. Start/stop = scale replicas

### Phase 4: Cutover
1. Test tenant provisioning end-to-end
2. Switch DNS to EIP
3. Tear down old ECS/ALB/NAT infra

### Phase 5: EKS (later, when needed)
1. Create EKS cluster
2. Apply same manifests
3. Update ECR pull config + DNS
4. Done — no app changes needed
