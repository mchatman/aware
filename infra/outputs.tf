# =============================================================================
# Aware Infrastructure — Outputs
# =============================================================================
# These values are needed by:
#   - CI/CD pipelines (ECR URLs, ECS cluster)
#   - API provisioning service (ALB listener, VPC config, security groups)
#   - Operational dashboards and monitoring
# =============================================================================

# ---------------------------------------------------------------------------
# VPC & Networking
# ---------------------------------------------------------------------------

output "vpc_id" {
  description = "VPC ID"
  value       = aws_vpc.main.id
}

output "public_subnet_ids" {
  description = "Public subnet IDs (ALB lives here)"
  value       = [for s in aws_subnet.public : s.id]
}

output "private_subnet_ids" {
  description = "Private subnet IDs (ECS tasks and RDS live here)"
  value       = [for s in aws_subnet.private : s.id]
}

# ---------------------------------------------------------------------------
# Load Balancer
# ---------------------------------------------------------------------------

output "alb_dns_name" {
  description = "ALB DNS name (use for CNAME or alias records)"
  value       = aws_lb.main.dns_name
}

output "alb_arn" {
  description = "ALB ARN (needed for dynamic target group creation by API)"
  value       = aws_lb.main.arn
}

output "alb_zone_id" {
  description = "ALB canonical hosted zone ID (for Route 53 alias records)"
  value       = aws_lb.main.zone_id
}

output "https_listener_arn" {
  description = "HTTPS listener ARN (needed for dynamic listener rules by API)"
  value       = aws_lb_listener.https.arn
}

# ---------------------------------------------------------------------------
# ECR Repositories
# ---------------------------------------------------------------------------

output "ecr_api_repository_url" {
  description = "ECR repository URL for the API image"
  value       = aws_ecr_repository.api.repository_url
}

output "ecr_gateway_repository_url" {
  description = "ECR repository URL for the gateway image"
  value       = aws_ecr_repository.gateway.repository_url
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

output "rds_endpoint" {
  description = "RDS Postgres endpoint (host:port)"
  value       = aws_db_instance.main.endpoint
}

output "rds_address" {
  description = "RDS Postgres hostname (without port)"
  value       = aws_db_instance.main.address
}

# ---------------------------------------------------------------------------
# ECS
# ---------------------------------------------------------------------------

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.main.name
}

output "ecs_cluster_arn" {
  description = "ECS cluster ARN"
  value       = aws_ecs_cluster.main.arn
}

output "api_service_name" {
  description = "ECS service name for the API"
  value       = aws_ecs_service.api.name
}

output "gateway_task_definition_arn" {
  description = "Gateway task definition ARN (template — base for per-tenant definitions)"
  value       = aws_ecs_task_definition.gateway_template.arn
}

# ---------------------------------------------------------------------------
# Security Groups
# ---------------------------------------------------------------------------

output "alb_security_group_id" {
  description = "ALB security group ID"
  value       = aws_security_group.alb.id
}

output "api_security_group_id" {
  description = "API security group ID"
  value       = aws_security_group.api.id
}

output "gateway_security_group_id" {
  description = "Gateway security group ID (needed for dynamic task creation by API)"
  value       = aws_security_group.gateway.id
}

output "db_security_group_id" {
  description = "Database security group ID"
  value       = aws_security_group.db.id
}

# ---------------------------------------------------------------------------
# Secrets
# ---------------------------------------------------------------------------

output "database_url_secret_arn" {
  description = "Secrets Manager ARN for the database URL"
  value       = aws_secretsmanager_secret.database_url.arn
}

output "jwt_secret_arn" {
  description = "Secrets Manager ARN for the JWT secret"
  value       = aws_secretsmanager_secret.jwt_secret.arn
}

# ---------------------------------------------------------------------------
# DNS & TLS
# ---------------------------------------------------------------------------

output "route53_zone_id" {
  description = "Route 53 hosted zone ID for wareit.ai"
  value       = aws_route53_zone.main.zone_id
}

output "nameservers" {
  description = "Route 53 nameservers — set these at your domain registrar (Porkbun)"
  value       = aws_route53_zone.main.name_servers
}

output "acm_certificate_arn" {
  description = "ACM certificate ARN (covers *.wareit.ai and wareit.ai)"
  value       = aws_acm_certificate.main.arn
}

# ---------------------------------------------------------------------------
# IAM (needed by API provisioning service)
# ---------------------------------------------------------------------------

output "ecs_task_execution_role_arn" {
  description = "ECS task execution role ARN"
  value       = aws_iam_role.ecs_task_execution.arn
}

output "gateway_task_role_arn" {
  description = "Gateway task role ARN"
  value       = aws_iam_role.gateway_task.arn
}

# ---------------------------------------------------------------------------
# EKS
# ---------------------------------------------------------------------------

output "eks_cluster_name" {
  description = "EKS cluster name"
  value       = aws_eks_cluster.main.name
}

output "eks_cluster_endpoint" {
  description = "EKS cluster API endpoint"
  value       = aws_eks_cluster.main.endpoint
}

output "eks_cluster_certificate_authority" {
  description = "EKS cluster CA certificate (base64-encoded)"
  value       = aws_eks_cluster.main.certificate_authority[0].data
  sensitive   = true
}

output "eks_oidc_provider_arn" {
  description = "EKS OIDC provider ARN (for IRSA role trust policies)"
  value       = aws_iam_openid_connect_provider.eks.arn
}

output "eks_oidc_provider_url" {
  description = "EKS OIDC provider URL (without https:// prefix)"
  value       = replace(aws_eks_cluster.main.identity[0].oidc[0].issuer, "https://", "")
}

output "eks_kubeconfig_command" {
  description = "AWS CLI command to configure kubectl"
  value       = "aws eks update-kubeconfig --region ${local.region} --name ${aws_eks_cluster.main.name}"
}
