# =============================================================================
# Aware Infrastructure — EKS Cluster & Node Group
# =============================================================================
# EKS cluster for tenant gateway orchestration.
# Managed node group with spot instances for cost optimization.
# OIDC provider enables IRSA for pod-level AWS permissions.
# =============================================================================

# ---------------------------------------------------------------------------
# CloudWatch Log Group — EKS control plane logs
# ---------------------------------------------------------------------------

resource "aws_cloudwatch_log_group" "eks" {
  name              = "/aws/eks/${local.eks_cluster_name}/cluster"
  retention_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name = "${local.name_prefix}-eks-logs"
  }
}

# ---------------------------------------------------------------------------
# EKS Cluster
# ---------------------------------------------------------------------------

resource "aws_eks_cluster" "main" {
  name     = local.eks_cluster_name
  role_arn = aws_iam_role.eks_cluster.arn
  version  = var.eks_kubernetes_version

  vpc_config {
    # Include both public and private subnets — control plane ENIs go in
    # private subnets, public subnets available for load balancers
    subnet_ids = concat(
      [for s in aws_subnet.private : s.id],
      [for s in aws_subnet.public : s.id]
    )
    endpoint_private_access = true
    endpoint_public_access  = true
  }

  # Use EKS API for access management (modern approach, replaces aws-auth configmap)
  access_config {
    authentication_mode                         = "API_AND_CONFIG_MAP"
    bootstrap_cluster_creator_admin_permissions = true
  }

  # Send control plane logs to CloudWatch
  enabled_cluster_log_types = ["api", "audit", "authenticator"]

  depends_on = [
    aws_iam_role_policy_attachment.eks_cluster_policy,
    aws_cloudwatch_log_group.eks,
  ]

  tags = {
    Name = local.eks_cluster_name
  }
}

# ---------------------------------------------------------------------------
# OIDC Provider — enables IAM Roles for Service Accounts (IRSA)
# ---------------------------------------------------------------------------
# Allows Kubernetes service accounts to assume IAM roles.
# Used by: AWS Load Balancer Controller, cert-manager, tenant pods (future).

data "tls_certificate" "eks" {
  url = aws_eks_cluster.main.identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "eks" {
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.eks.certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.main.identity[0].oidc[0].issuer

  tags = {
    Name = "${local.name_prefix}-eks-oidc"
  }
}

# ---------------------------------------------------------------------------
# Managed Node Group — spot instances for cost optimization
# ---------------------------------------------------------------------------
# Tenant gateway pods run here. Spot instances reduce costs significantly
# (~70% savings vs on-demand). Min 1 node keeps the cluster warm.

resource "aws_eks_node_group" "main" {
  cluster_name    = aws_eks_cluster.main.name
  node_group_name = "${local.name_prefix}-nodes"
  node_role_arn   = aws_iam_role.eks_node_group.arn

  # Nodes in private subnets — internet access via NAT gateway
  subnet_ids = [for s in aws_subnet.private : s.id]

  capacity_type  = "SPOT"
  instance_types = var.eks_node_instance_types

  scaling_config {
    min_size     = var.eks_node_min_size
    max_size     = var.eks_node_max_size
    desired_size = var.eks_node_desired_size
  }

  update_config {
    max_unavailable = 1
  }

  depends_on = [
    aws_iam_role_policy_attachment.eks_node_worker,
    aws_iam_role_policy_attachment.eks_node_cni,
    aws_iam_role_policy_attachment.eks_node_ecr,
  ]

  tags = {
    Name = "${local.name_prefix}-nodes"
  }
}

# ---------------------------------------------------------------------------
# EKS Access Entry — allow API ECS task role to manage K8s resources
# ---------------------------------------------------------------------------
# The API provisioner (running on ECS Fargate) needs to create/delete
# Kubernetes Deployments, Services, Ingresses, and Secrets for tenants.
# This access entry maps the API's IAM role to cluster admin permissions.

resource "aws_eks_access_entry" "api_task" {
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_role.api_task.arn
  type          = "STANDARD"

  tags = {
    Name = "${local.name_prefix}-api-eks-access"
  }
}

resource "aws_eks_access_policy_association" "api_task" {
  cluster_name  = aws_eks_cluster.main.name
  principal_arn = aws_iam_role.api_task.arn
  policy_arn    = "arn:aws:eks::aws:cluster-access-policy/AmazonEKSClusterAdminPolicy"

  access_scope {
    type = "cluster"
  }
}
