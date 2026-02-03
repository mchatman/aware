# =============================================================================
# Aware Infrastructure — Main Configuration
# =============================================================================
# B2B voice AI platform: shared API + per-tenant OpenClaw gateway containers
# Region: us-east-1 | Domain: wareit.ai
# =============================================================================

terraform {
  required_version = ">= 1.5"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.5"
    }
  }

  # ---------------------------------------------------------------------------
  # Remote State Backend (S3 + DynamoDB)
  # ---------------------------------------------------------------------------
  # Uncomment after creating the S3 bucket and DynamoDB table:
  #
  #   aws s3api create-bucket --bucket aware-terraform-state --region us-east-1
  #   aws s3api put-bucket-versioning --bucket aware-terraform-state \
  #     --versioning-configuration Status=Enabled
  #   aws dynamodb create-table \
  #     --table-name aware-terraform-lock \
  #     --attribute-definitions AttributeName=LockID,AttributeType=S \
  #     --key-schema AttributeName=LockID,KeyType=HASH \
  #     --billing-mode PAY_PER_REQUEST \
  #     --region us-east-1
  #
  # Then uncomment the block below and run `terraform init` to migrate state.
  # ---------------------------------------------------------------------------
  # backend "s3" {
  #   bucket         = "aware-terraform-state"
  #   key            = "aware/terraform.tfstate"
  #   region         = "us-east-1"
  #   dynamodb_table = "aware-terraform-lock"
  #   encrypt        = true
  # }
}

provider "aws" {
  region  = var.region
  profile = "ware-prod-admin"

  default_tags {
    tags = {
      Project     = "aware"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

# ---------------------------------------------------------------------------
# Data sources
# ---------------------------------------------------------------------------

# Current AWS account identity
data "aws_caller_identity" "current" {}

# Current region
data "aws_region" "current" {}

# ---------------------------------------------------------------------------
# Locals — common tags and naming
# ---------------------------------------------------------------------------

locals {
  name_prefix = "aware-${var.environment}"

  common_tags = {
    Project     = "aware"
    Environment = var.environment
    ManagedBy   = "terraform"
  }

  account_id = data.aws_caller_identity.current.account_id
  region     = data.aws_region.current.name
}
