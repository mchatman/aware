# =============================================================================
# Aware Infrastructure — Input Variables
# =============================================================================

# ---------------------------------------------------------------------------
# General
# ---------------------------------------------------------------------------

variable "region" {
  description = "AWS region for all resources"
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "Deployment environment (production, staging, dev)"
  type        = string
  default     = "production"
}

variable "domain" {
  description = "Root domain for the Aware platform"
  type        = string
  default     = "wareit.ai"
}

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

variable "db_instance_class" {
  description = "RDS instance class — db.t4g.micro is the smallest/cheapest"
  type        = string
  default     = "db.t4g.micro"
}

variable "db_name" {
  description = "Name of the Postgres database"
  type        = string
  default     = "aware"
}

variable "db_username" {
  description = "Master username for the RDS instance"
  type        = string
  default     = "aware"
}

# ---------------------------------------------------------------------------
# Container Images
# ---------------------------------------------------------------------------

variable "api_image_tag" {
  description = "Docker image tag for the Aware API container"
  type        = string
  default     = "latest"
}

variable "gateway_image_tag" {
  description = "Docker image tag for the tenant gateway container"
  type        = string
  default     = "latest"
}

# ---------------------------------------------------------------------------
# ECS Task Sizing
# ---------------------------------------------------------------------------

variable "api_cpu" {
  description = "CPU units for the API task (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "api_memory" {
  description = "Memory (MiB) for the API task"
  type        = number
  default     = 512
}

variable "gateway_cpu" {
  description = "CPU units for each tenant gateway task (256 = 0.25 vCPU)"
  type        = number
  default     = 256
}

variable "gateway_memory" {
  description = "Memory (MiB) for each tenant gateway task"
  type        = number
  default     = 512
}

# ---------------------------------------------------------------------------
# ECS Service Scaling
# ---------------------------------------------------------------------------

variable "api_desired_count" {
  description = "Desired number of API task instances"
  type        = number
  default     = 1
}

# ---------------------------------------------------------------------------
# EKS Cluster
# ---------------------------------------------------------------------------

variable "eks_kubernetes_version" {
  description = "Kubernetes version for the EKS cluster"
  type        = string
  default     = "1.31"
}

variable "eks_node_instance_types" {
  description = "EC2 instance types for the EKS managed node group"
  type        = list(string)
  default     = ["t3.small"]
}

variable "eks_node_min_size" {
  description = "Minimum number of nodes in the EKS node group"
  type        = number
  default     = 1
}

variable "eks_node_max_size" {
  description = "Maximum number of nodes in the EKS node group"
  type        = number
  default     = 3
}

variable "eks_node_desired_size" {
  description = "Desired number of nodes in the EKS node group"
  type        = number
  default     = 1
}
