# =============================================================================
# Aware Infrastructure — ECS Cluster, Task Definitions & Services
# =============================================================================
# - ECS Cluster with Container Insights
# - API task definition + service (always running)
# - Gateway task definition template (instances created dynamically by API)
# =============================================================================

# ---------------------------------------------------------------------------
# ECS Cluster
# ---------------------------------------------------------------------------

resource "aws_ecs_cluster" "main" {
  name = local.name_prefix

  setting {
    name  = "containerInsights"
    value = "enabled"
  }

  tags = {
    Name = "${local.name_prefix}"
  }
}

# ---------------------------------------------------------------------------
# CloudWatch Log Groups
# ---------------------------------------------------------------------------

# Log group for API containers
resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/aware-api"
  retention_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name = "aware-api-logs"
  }
}

# Log group for gateway containers (all tenants share this log group,
# differentiated by log stream prefix)
resource "aws_cloudwatch_log_group" "gateway" {
  name              = "/ecs/aware-gateway"
  retention_in_days = var.environment == "production" ? 30 : 7

  tags = {
    Name = "aware-gateway-logs"
  }
}

# ---------------------------------------------------------------------------
# API Task Definition
# ---------------------------------------------------------------------------

resource "aws_ecs_task_definition" "api" {
  family                   = "aware-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.api_cpu
  memory                   = var.api_memory
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.api_task.arn

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${aws_ecr_repository.api.repository_url}:${var.api_image_tag}"
      essential = true

      portMappings = [
        {
          containerPort = 3001
          hostPort      = 3001
          protocol      = "tcp"
        }
      ]

      # Non-sensitive environment variables
      environment = [
        { name = "API_HOST", value = "0.0.0.0" },
        { name = "API_PORT", value = "3001" },
        { name = "CORS_ORIGIN", value = "https://${var.domain}" },
        { name = "NODE_ENV", value = var.environment == "production" ? "production" : "development" },

        # Tenant provisioner — ECS mode
        { name = "ECS_CLUSTER_ARN", value = aws_ecs_cluster.main.arn },
        { name = "HTTPS_LISTENER_ARN", value = aws_lb_listener.https.arn },
        { name = "VPC_ID", value = aws_vpc.main.id },
        { name = "GATEWAY_IMAGE", value = aws_ecr_repository.gateway.repository_url },
        { name = "ECS_EXECUTION_ROLE_ARN", value = aws_iam_role.ecs_task_execution.arn },
        { name = "ECS_GATEWAY_TASK_ROLE_ARN", value = aws_iam_role.gateway_task.arn },
        { name = "GATEWAY_BASE_DOMAIN", value = var.domain },
        { name = "GATEWAY_LOG_GROUP", value = aws_cloudwatch_log_group.gateway.name },
        { name = "AWS_REGION", value = local.region },
      ]

      # Sensitive values pulled from Secrets Manager at container start
      secrets = [
        {
          name      = "DATABASE_URL"
          valueFrom = aws_secretsmanager_secret.database_url.arn
        },
        {
          name      = "JWT_SECRET"
          valueFrom = aws_secretsmanager_secret.jwt_secret.arn
        },
        {
          name      = "STRIPE_SECRET_KEY"
          valueFrom = aws_secretsmanager_secret.stripe_secret_key.arn
        },
        {
          name      = "STRIPE_WEBHOOK_SECRET"
          valueFrom = aws_secretsmanager_secret.stripe_webhook_secret.arn
        }
      ]

      # Logs → CloudWatch
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.api.name
          "awslogs-region"        = local.region
          "awslogs-stream-prefix" = "api"
        }
      }

      # Health check at container level
      healthCheck = {
        command     = ["CMD-SHELL", "curl -f http://localhost:3001/api/health || exit 1"]
        interval    = 30
        timeout     = 5
        retries     = 3
        startPeriod = 60
      }
    }
  ])

  tags = {
    Name = "aware-api"
  }
}

# ---------------------------------------------------------------------------
# API ECS Service
# ---------------------------------------------------------------------------

resource "aws_ecs_service" "api" {
  name            = "aware-api"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = var.api_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = [for s in aws_subnet.private : s.id]
    security_groups  = [aws_security_group.api.id]
    assign_public_ip = false
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "api"
    container_port   = 3001
  }

  # Give the container time to start before health checks kick in
  health_check_grace_period_seconds = 60

  # Rolling update deployment
  deployment_maximum_percent         = 200
  deployment_minimum_healthy_percent = 100

  # Ensure the ALB listener is ready before creating the service
  depends_on = [aws_lb_listener.https]

  tags = {
    Name = "aware-api"
  }
}

# ---------------------------------------------------------------------------
# Gateway Task Definition — TEMPLATE
# ---------------------------------------------------------------------------
# This is a reference template. The API provisioning service uses this as a
# base to create per-tenant task definitions with tenant-specific config
# (gateway token, log stream prefix, etc.).
#
# Do NOT create an ECS service for this — tenant gateway services are
# managed dynamically by the API.

resource "aws_ecs_task_definition" "gateway_template" {
  family                   = "aware-gateway-template"
  requires_compatibilities = ["EC2"]
  network_mode             = "bridge"
  execution_role_arn       = aws_iam_role.ecs_task_execution.arn
  task_role_arn            = aws_iam_role.gateway_task.arn

  container_definitions = jsonencode([
    {
      name      = "gateway"
      image     = "${aws_ecr_repository.gateway.repository_url}:${var.gateway_image_tag}"
      essential = true
      memory    = 256

      # OpenClaw gateway command
      command = ["node", "dist/index.js", "gateway", "--bind", "lan", "--port", "18789"]

      portMappings = [
        {
          containerPort = 18789
          hostPort      = 0 # Dynamic port — ALB routes via target group
          protocol      = "tcp"
        }
      ]

      # Non-sensitive environment variables
      environment = [
        { name = "HOME", value = "/home/node" },
        { name = "TERM", value = "xterm-256color" },
      ]

      # Per-tenant secrets — the API provisioning service will override
      # OPENCLAW_GATEWAY_TOKEN with the actual tenant-specific secret ARN
      secrets = [
        {
          name      = "OPENCLAW_GATEWAY_TOKEN"
          valueFrom = aws_secretsmanager_secret.gateway_token_placeholder.arn
        }
      ]

      # Logs → CloudWatch (stream prefix will be overridden per-tenant)
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          "awslogs-group"         = aws_cloudwatch_log_group.gateway.name
          "awslogs-region"        = local.region
          "awslogs-stream-prefix" = "gateway"
        }
      }
    }
  ])

  tags = {
    Name = "aware-gateway-template"
  }
}

# ---------------------------------------------------------------------------
# EC2 Capacity for Gateway Tasks
# ---------------------------------------------------------------------------
# Shared EC2 instance(s) that host tenant gateway containers.
# ECS schedules multiple containers onto these instances.

resource "aws_launch_template" "gateway_ec2" {
  name_prefix   = "${local.name_prefix}-gw-"
  image_id      = data.aws_ssm_parameter.ecs_ami.value
  instance_type = var.gateway_ec2_instance_type

  iam_instance_profile {
    arn = aws_iam_instance_profile.ecs_ec2.arn
  }

  vpc_security_group_ids = [aws_security_group.gateway.id]

  user_data = base64encode(<<-EOF
    #!/bin/bash
    echo "ECS_CLUSTER=${aws_ecs_cluster.main.name}" >> /etc/ecs/ecs.config
  EOF
  )

  tag_specifications {
    resource_type = "instance"
    tags = {
      Name = "${local.name_prefix}-gateway"
    }
  }
}

# Latest ECS-optimized Amazon Linux 2023 AMI
data "aws_ssm_parameter" "ecs_ami" {
  name = "/aws/service/ecs/optimized-ami/amazon-linux-2023/recommended/image_id"
}

resource "aws_autoscaling_group" "gateway" {
  name_prefix         = "${local.name_prefix}-gw-"
  min_size            = var.gateway_ec2_min_size
  max_size            = var.gateway_ec2_max_size
  desired_capacity    = var.gateway_ec2_desired_size
  vpc_zone_identifier = [for s in aws_subnet.private : s.id]

  launch_template {
    id      = aws_launch_template.gateway_ec2.id
    version = "$Latest"
  }

  tag {
    key                 = "Name"
    value               = "${local.name_prefix}-gateway"
    propagate_at_launch = true
  }

  tag {
    key                 = "AmazonECSManaged"
    value               = "true"
    propagate_at_launch = true
  }
}

resource "aws_ecs_capacity_provider" "gateway_ec2" {
  name = "${local.name_prefix}-gateway-ec2"

  auto_scaling_group_provider {
    auto_scaling_group_arn         = aws_autoscaling_group.gateway.arn
    managed_termination_protection = "DISABLED"

    managed_scaling {
      status                    = "ENABLED"
      target_capacity           = 100
      minimum_scaling_step_size = 1
      maximum_scaling_step_size = 1
    }
  }
}

resource "aws_ecs_cluster_capacity_providers" "main" {
  cluster_name       = aws_ecs_cluster.main.name
  capacity_providers = [aws_ecs_capacity_provider.gateway_ec2.name, "FARGATE"]

  default_capacity_provider_strategy {
    capacity_provider = aws_ecs_capacity_provider.gateway_ec2.name
    weight            = 1
  }
}
