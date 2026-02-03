# =============================================================================
# Aware Infrastructure — Secrets Manager
# =============================================================================
# Auto-generated secrets for DB password and JWT.
# Stripe secrets created as empty — set values via AWS CLI after apply.
# =============================================================================

# ---------------------------------------------------------------------------
# Random password generators
# ---------------------------------------------------------------------------

# Database password — auto-generated, stored in Secrets Manager
resource "random_password" "db_password" {
  length  = 32
  special = true
  # Keep special chars simple — avoid URL-encoding nightmares in connection strings
  override_special = "!#%()-_=+"
}

# JWT signing secret — auto-generated
resource "random_password" "jwt_secret" {
  length  = 64
  special = false
}

# ---------------------------------------------------------------------------
# Database URL secret
# ---------------------------------------------------------------------------

# Full Postgres connection string for the API
resource "aws_secretsmanager_secret" "database_url" {
  name                    = "aware/${var.environment}/database-url"
  description             = "Postgres connection string for the Aware API"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "aware-database-url"
  }
}

# Construct and store the database URL from RDS outputs
resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgresql://%s:%s@%s:%s/%s?sslmode=no-verify",
    var.db_username,
    urlencode(random_password.db_password.result),
    aws_db_instance.main.address,
    aws_db_instance.main.port,
    var.db_name
  )
}

# ---------------------------------------------------------------------------
# JWT Secret
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "jwt_secret" {
  name                    = "aware/${var.environment}/jwt-secret"
  description             = "JWT signing key for the Aware API"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "aware-jwt-secret"
  }
}

resource "aws_secretsmanager_secret_version" "jwt_secret" {
  secret_id     = aws_secretsmanager_secret.jwt_secret.id
  secret_string = random_password.jwt_secret.result
}

# ---------------------------------------------------------------------------
# Stripe Secret Key — set value via AWS CLI after apply
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "stripe_secret_key" {
  name                    = "aware/${var.environment}/stripe-secret-key"
  description             = "Stripe API secret key"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "aware-stripe-secret-key"
  }
}

# Placeholder — replace via:
#   aws secretsmanager put-secret-value \
#     --secret-id aware/production/stripe-secret-key \
#     --secret-string "sk_live_..."
resource "aws_secretsmanager_secret_version" "stripe_secret_key" {
  secret_id     = aws_secretsmanager_secret.stripe_secret_key.id
  secret_string = "REPLACE_ME_via_aws_cli"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Stripe Webhook Secret — set value via AWS CLI after apply
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "stripe_webhook_secret" {
  name                    = "aware/${var.environment}/stripe-webhook-secret"
  description             = "Stripe webhook signing secret"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "aware-stripe-webhook-secret"
  }
}

# Placeholder — replace via:
#   aws secretsmanager put-secret-value \
#     --secret-id aware/production/stripe-webhook-secret \
#     --secret-string "whsec_..."
resource "aws_secretsmanager_secret_version" "stripe_webhook_secret" {
  secret_id     = aws_secretsmanager_secret.stripe_webhook_secret.id
  secret_string = "REPLACE_ME_via_aws_cli"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Gateway Token Placeholder — per-tenant tokens created dynamically by API
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "gateway_token_placeholder" {
  name                    = "aware/${var.environment}/gateway-token-placeholder"
  description             = "Placeholder for gateway token reference in task template. Actual per-tenant tokens are created by the API provisioning service."
  recovery_window_in_days = 0

  tags = {
    Name = "aware-gateway-token-placeholder"
  }
}

resource "aws_secretsmanager_secret_version" "gateway_token_placeholder" {
  secret_id     = aws_secretsmanager_secret.gateway_token_placeholder.id
  secret_string = "PLACEHOLDER_REPLACED_PER_TENANT"

  lifecycle {
    ignore_changes = [secret_string]
  }
}

# ---------------------------------------------------------------------------
# Database Password (stored separately for reference)
# ---------------------------------------------------------------------------

resource "aws_secretsmanager_secret" "db_password" {
  name                    = "aware/${var.environment}/db-password"
  description             = "RDS master password (also embedded in database-url)"
  recovery_window_in_days = var.environment == "production" ? 30 : 0

  tags = {
    Name = "aware-db-password"
  }
}

resource "aws_secretsmanager_secret_version" "db_password" {
  secret_id     = aws_secretsmanager_secret.db_password.id
  secret_string = random_password.db_password.result
}
