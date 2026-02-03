# =============================================================================
# Aware Infrastructure — Application Load Balancer
# =============================================================================
# Internet-facing ALB handling:
#   - api.wareit.ai → API service (port 3001)
#   - {slug}.wareit.ai → tenant gateways (dynamic, managed by API)
# =============================================================================

# ---------------------------------------------------------------------------
# Application Load Balancer
# ---------------------------------------------------------------------------

resource "aws_lb" "main" {
  name               = "${local.name_prefix}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = [for s in aws_subnet.public : s.id]

  enable_deletion_protection = var.environment == "production"

  tags = {
    Name = "${local.name_prefix}-alb"
  }
}

# ---------------------------------------------------------------------------
# HTTP Listener (port 80) — redirect everything to HTTPS
# ---------------------------------------------------------------------------

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }

  tags = {
    Name = "${local.name_prefix}-http-redirect"
  }
}

# ---------------------------------------------------------------------------
# HTTPS Listener (port 443) — default action returns 404
# ---------------------------------------------------------------------------
# Specific routes are added via listener rules below.
# Tenant gateway rules are created dynamically by the API provisioning service.

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = aws_acm_certificate_validation.main.certificate_arn

  default_action {
    type = "fixed-response"
    fixed_response {
      content_type = "application/json"
      message_body = "{\"error\":\"not_found\",\"message\":\"No route matched\"}"
      status_code  = "404"
    }
  }

  tags = {
    Name = "${local.name_prefix}-https"
  }
}

# ---------------------------------------------------------------------------
# API Target Group
# ---------------------------------------------------------------------------

resource "aws_lb_target_group" "api" {
  name        = "${local.name_prefix}-api-tg"
  port        = 3001
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"

  health_check {
    enabled             = true
    path                = "/api/health"
    port                = "traffic-port"
    protocol            = "HTTP"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    timeout             = 5
    interval            = 30
    matcher             = "200"
  }

  # Allow targets to deregister gracefully
  deregistration_delay = 30

  tags = {
    Name = "${local.name_prefix}-api-tg"
  }
}

# ---------------------------------------------------------------------------
# API Listener Rule — api.wareit.ai → API target group
# ---------------------------------------------------------------------------

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 100

  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }

  condition {
    host_header {
      values = ["api.${var.domain}"]
    }
  }

  tags = {
    Name = "${local.name_prefix}-api-rule"
  }
}

# ---------------------------------------------------------------------------
# Tenant Gateway Routing — DYNAMIC (managed by API, not Terraform)
# ---------------------------------------------------------------------------
# Each tenant gets:
#   1. A target group (port 18789, target type IP)
#   2. A listener rule: {slug}.wareit.ai → their target group
#   3. An ECS service running their gateway container
#
# The API provisioning service creates these using the AWS SDK with:
#   - HTTPS listener ARN (from outputs)
#   - VPC ID (from outputs)
#   - Gateway security group ID (from outputs)
#   - Private subnet IDs (from outputs)
#   - ECS cluster ARN (from outputs)
#   - Gateway task definition (registered per-tenant, based on template)
#
# Example dynamic target group creation (pseudocode):
#   aws elbv2 create-target-group \
#     --name {slug} \
#     --protocol HTTP --port 18789 \
#     --vpc-id {vpc_id} --target-type ip
#
#   aws elbv2 create-rule \
#     --listener-arn {https_listener_arn} \
#     --conditions Field=host-header,Values={slug}.wareit.ai \
#     --actions Type=forward,TargetGroupArn={tg_arn} \
#     --priority {dynamic_priority}
