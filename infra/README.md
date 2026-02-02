# Aware Infrastructure

Terraform configuration for the Aware B2B voice AI platform on AWS.

## Architecture

```
                         ┌──────────────────────────┐
                         │       Route 53            │
                         │  api.wareit.ai            │
                         │  *.gw.wareit.ai           │
                         └────────────┬─────────────┘
                                      │
                         ┌────────────▼─────────────┐
                         │    ALB (public subnets)   │
                         │    HTTPS + ACM cert       │
                         └──┬──────────────────┬────┘
                            │                  │
               ┌────────────▼──────┐  ┌───────▼──────────────┐
               │   API Service     │  │  Gateway Tasks        │
               │   (ECS Fargate)   │  │  (ECS Fargate)        │
               │   port 3001       │  │  port 18789           │
               │                   │  │  1 per tenant         │
               └────────┬─────────┘  └───────────────────────┘
                        │              (created dynamically)
               ┌────────▼─────────┐
               │   RDS Postgres   │
               │   (private)      │
               └──────────────────┘
```

**Shared API** handles auth, billing, connectors, and tenant provisioning.  
**Per-tenant gateways** run OpenClaw containers, provisioned dynamically by the API.

## Prerequisites

1. **Terraform** >= 1.5 ([install](https://developer.hashicorp.com/terraform/downloads))
2. **AWS CLI** configured with credentials that have admin access
3. **Domain**: `wareit.ai` must have a Route 53 hosted zone. If it doesn't exist:
   ```bash
   aws route53 create-hosted-zone --name wareit.ai --caller-reference $(date +%s)
   ```
   Then update your domain registrar's NS records to point to the Route 53 nameservers.

## Quick Start

```bash
# 1. Navigate to the infra directory
cd infra/

# 2. Copy and customize variables
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars if needed

# 3. Initialize Terraform
terraform init

# 4. Preview changes
terraform plan

# 5. Apply infrastructure
terraform apply
```

## After Apply

### Build & Push Docker Images

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
  docker login --username AWS --password-stdin $(terraform output -raw ecr_api_repository_url | cut -d/ -f1)

# Build and push API image
docker build -t aware-api -f ../Dockerfile.api ..
docker tag aware-api:latest $(terraform output -raw ecr_api_repository_url):latest
docker push $(terraform output -raw ecr_api_repository_url):latest

# Build and push gateway image
docker build -t aware-gateway -f ../Dockerfile.gateway ..
docker tag aware-gateway:latest $(terraform output -raw ecr_gateway_repository_url):latest
docker push $(terraform output -raw ecr_gateway_repository_url):latest

# Force ECS to pick up new images
aws ecs update-service --cluster $(terraform output -raw ecs_cluster_name) \
  --service aware-api --force-new-deployment
```

### Set Stripe Secrets

```bash
# Set your Stripe secret key
aws secretsmanager put-secret-value \
  --secret-id aware/production/stripe-secret-key \
  --secret-string "sk_live_YOUR_KEY_HERE"

# Set your Stripe webhook secret
aws secretsmanager put-secret-value \
  --secret-id aware/production/stripe-webhook-secret \
  --secret-string "whsec_YOUR_SECRET_HERE"
```

### Enable Remote State (recommended for teams)

After the initial apply, set up remote state:

```bash
# Create S3 bucket for state
aws s3api create-bucket --bucket aware-terraform-state --region us-east-1
aws s3api put-bucket-versioning --bucket aware-terraform-state \
  --versioning-configuration Status=Enabled

# Create DynamoDB table for state locking
aws dynamodb create-table \
  --table-name aware-terraform-lock \
  --attribute-definitions AttributeName=LockID,AttributeType=S \
  --key-schema AttributeName=LockID,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region us-east-1
```

Then uncomment the `backend "s3"` block in `main.tf` and run `terraform init` to migrate.

## Dynamic Tenant Provisioning

Tenant gateways are **not managed by Terraform**. The API provisioning service creates them dynamically using the AWS SDK:

1. Creates a Secrets Manager secret for the tenant's gateway token
2. Registers a new ECS task definition (based on the template)
3. Creates a target group and ALB listener rule (`gw-{slug}.wareit.ai`)
4. Creates an ECS service running the gateway container

The API needs these Terraform outputs:
- `ecs_cluster_arn` — where to run tasks
- `https_listener_arn` — where to add routing rules
- `vpc_id` — for target groups
- `private_subnet_ids` — for task networking
- `gateway_security_group_id` — for task networking
- `ecs_task_execution_role_arn` — for new task definitions
- `gateway_task_role_arn` — for new task definitions

## Cost Estimate (minimal setup)

| Resource | Monthly Cost (approx) |
|----------|----------------------|
| NAT Gateway | ~$32 |
| ALB | ~$16 |
| RDS db.t4g.micro | ~$12 |
| ECS Fargate (API, 0.25 vCPU) | ~$8 |
| Secrets Manager (5 secrets) | ~$2 |
| ECR (storage) | ~$1 |
| Route 53 | ~$0.50 |
| **Total (before gateways)** | **~$72/mo** |

Each tenant gateway adds ~$8/mo (0.25 vCPU Fargate task).

## Files

| File | Purpose |
|------|---------|
| `main.tf` | Provider, backend, locals |
| `variables.tf` | Input variables with defaults |
| `vpc.tf` | VPC, subnets, IGW, NAT, route tables |
| `security.tf` | Security groups (ALB, API, Gateway, DB) |
| `ecr.tf` | ECR repositories for container images |
| `rds.tf` | RDS Postgres instance |
| `iam.tf` | IAM roles for ECS tasks |
| `ecs.tf` | ECS cluster, task definitions, API service |
| `alb.tf` | ALB, listeners, target groups, routing rules |
| `dns.tf` | Route 53 records, ACM certificate |
| `secrets.tf` | Secrets Manager resources |
| `outputs.tf` | Exported values for CI/CD and API |
