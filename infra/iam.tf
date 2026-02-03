# =============================================================================
# Aware Infrastructure — IAM Roles & Policies
# =============================================================================
# Three roles:
#   1. ECS Task Execution Role — used by ECS agent to pull images, get secrets
#   2. API Task Role — runtime permissions for the API container
#   3. Gateway Task Role — runtime permissions for gateway containers
# =============================================================================

# ---------------------------------------------------------------------------
# ECS Task Execution Role
# ---------------------------------------------------------------------------
# This role is used by the ECS agent itself (not the container) to:
# - Pull images from ECR
# - Write logs to CloudWatch
# - Read secrets from Secrets Manager

resource "aws_iam_role" "ecs_task_execution" {
  name = "${local.name_prefix}-ecs-task-execution"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-ecs-task-execution"
  }
}

# Attach the AWS-managed ECS task execution policy (ECR + CloudWatch basics)
resource "aws_iam_role_policy_attachment" "ecs_task_execution_managed" {
  role       = aws_iam_role.ecs_task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

# Additional policy for reading secrets from Secrets Manager
resource "aws_iam_role_policy" "ecs_task_execution_secrets" {
  name = "${local.name_prefix}-execution-secrets"
  role = aws_iam_role.ecs_task_execution.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue"
        ]
        Resource = [
          "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:aware/${var.environment}/*"
        ]
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# API Task Role — runtime permissions for the API container
# ---------------------------------------------------------------------------

resource "aws_iam_role" "api_task" {
  name = "${local.name_prefix}-api-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-api-task"
  }
}

# API can read secrets at runtime (e.g., dynamically fetching config)
resource "aws_iam_role_policy" "api_task_secrets" {
  name = "${local.name_prefix}-api-secrets"
  role = aws_iam_role.api_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ReadSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:GetSecretValue",
          "secretsmanager:DescribeSecret"
        ]
        Resource = [
          "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:aware/${var.environment}/*"
        ]
      },
      {
        Sid    = "CreateTenantSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:PutSecretValue",
          "secretsmanager:TagResource"
        ]
        Resource = [
          "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:aware/${var.environment}/tenant/*"
        ]
      }
    ]
  })
}

# API can write logs to CloudWatch
resource "aws_iam_role_policy" "api_task_logs" {
  name = "${local.name_prefix}-api-logs"
  role = aws_iam_role.api_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/aware-*"
      }
    ]
  })
}

# API can manage ECS tasks for tenant provisioning
resource "aws_iam_role_policy" "api_task_ecs" {
  name = "${local.name_prefix}-api-ecs-provisioning"
  role = aws_iam_role.api_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "ManageGatewayTasks"
        Effect = "Allow"
        Action = [
          "ecs:RunTask",
          "ecs:StopTask",
          "ecs:DescribeTasks",
          "ecs:RegisterTaskDefinition",
          "ecs:DeregisterTaskDefinition",
          "ecs:CreateService",
          "ecs:UpdateService",
          "ecs:DeleteService",
          "ecs:DescribeServices",
          "ecs:TagResource"
        ]
        Resource = "*"
      },
      {
        Sid    = "PassRolesToTasks"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          aws_iam_role.ecs_task_execution.arn,
          aws_iam_role.gateway_task.arn
        ]
      },
      {
        Sid    = "ManageTargetGroups"
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:CreateTargetGroup",
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets",
          "elasticloadbalancing:CreateRule",
          "elasticloadbalancing:DeleteRule",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:ModifyRule",
          "elasticloadbalancing:AddTags"
        ]
        Resource = "*"
      },
      {
        Sid    = "ManageTenantSecrets"
        Effect = "Allow"
        Action = [
          "secretsmanager:CreateSecret",
          "secretsmanager:DeleteSecret",
          "secretsmanager:UpdateSecret",
          "secretsmanager:TagResource"
        ]
        Resource = "arn:aws:secretsmanager:${local.region}:${local.account_id}:secret:aware/gateway-token/*"
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Gateway Task Role — runtime permissions for gateway containers
# ---------------------------------------------------------------------------

resource "aws_iam_role" "gateway_task" {
  name = "${local.name_prefix}-gateway-task"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ecs-tasks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-gateway-task"
  }
}

# Gateway containers can write logs to CloudWatch
resource "aws_iam_role_policy" "gateway_task_logs" {
  name = "${local.name_prefix}-gateway-logs"
  role = aws_iam_role.gateway_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "WriteLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${local.region}:${local.account_id}:log-group:/ecs/aware-gateway:*"
      }
    ]
  })
}

# =============================================================================
# EKS IAM Roles
# =============================================================================

# ---------------------------------------------------------------------------
# EKS Cluster Role — assumed by the EKS control plane
# ---------------------------------------------------------------------------

resource "aws_iam_role" "eks_cluster" {
  name = "${local.name_prefix}-eks-cluster"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "eks.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-eks-cluster"
  }
}

resource "aws_iam_role_policy_attachment" "eks_cluster_policy" {
  role       = aws_iam_role.eks_cluster.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

# ---------------------------------------------------------------------------
# EKS Node Group Role — assumed by EC2 instances in the managed node group
# ---------------------------------------------------------------------------

resource "aws_iam_role" "eks_node_group" {
  name = "${local.name_prefix}-eks-node-group"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
        Action = "sts:AssumeRole"
      }
    ]
  })

  tags = {
    Name = "${local.name_prefix}-eks-node-group"
  }
}

# Worker node policy — allows nodes to connect to the EKS cluster
resource "aws_iam_role_policy_attachment" "eks_node_worker" {
  role       = aws_iam_role.eks_node_group.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

# CNI policy — allows nodes to manage pod networking (VPC CNI plugin)
resource "aws_iam_role_policy_attachment" "eks_node_cni" {
  role       = aws_iam_role.eks_node_group.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

# ECR read-only — allows nodes to pull container images from ECR
resource "aws_iam_role_policy_attachment" "eks_node_ecr" {
  role       = aws_iam_role.eks_node_group.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

# ---------------------------------------------------------------------------
# API Task Role — EKS permissions for tenant provisioning
# ---------------------------------------------------------------------------
# The API ECS task needs to call eks:DescribeCluster to get the cluster
# endpoint and CA cert for Kubernetes API authentication.

resource "aws_iam_role_policy" "api_task_eks" {
  name = "${local.name_prefix}-api-eks"
  role = aws_iam_role.api_task.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "DescribeEKSCluster"
        Effect = "Allow"
        Action = [
          "eks:DescribeCluster"
        ]
        Resource = "arn:aws:eks:${local.region}:${local.account_id}:cluster/${local.eks_cluster_name}"
      }
    ]
  })
}
