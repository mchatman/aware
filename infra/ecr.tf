# =============================================================================
# Aware Infrastructure — ECR Repositories
# =============================================================================
# Two repositories: one for the shared API, one for tenant gateway images.
# =============================================================================

# ---------------------------------------------------------------------------
# API ECR Repository — shared backend API image
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "api" {
  name                 = "aware-api"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "production"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "aware-api"
  }
}

# Keep only the last 10 untagged images to save storage costs
resource "aws_ecr_lifecycle_policy" "api" {
  repository = aws_ecr_repository.api.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

# ---------------------------------------------------------------------------
# Gateway ECR Repository — per-tenant OpenClaw gateway image
# ---------------------------------------------------------------------------

resource "aws_ecr_repository" "gateway" {
  name                 = "aware-gateway"
  image_tag_mutability = "MUTABLE"
  force_delete         = var.environment != "production"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name = "aware-gateway"
  }
}

# Keep only the last 10 untagged images to save storage costs
resource "aws_ecr_lifecycle_policy" "gateway" {
  repository = aws_ecr_repository.gateway.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Keep last 10 images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 10
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}
