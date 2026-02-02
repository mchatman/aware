# =============================================================================
# Aware Infrastructure — RDS Postgres
# =============================================================================
# Single Postgres 16 instance in private subnets.
# Password auto-generated and stored in Secrets Manager.
# =============================================================================

# ---------------------------------------------------------------------------
# DB Subnet Group — RDS only lives in private subnets
# ---------------------------------------------------------------------------

resource "aws_db_subnet_group" "main" {
  name       = "${local.name_prefix}-db-subnet-group"
  subnet_ids = [for s in aws_subnet.private : s.id]

  tags = {
    Name = "${local.name_prefix}-db-subnet-group"
  }
}

# ---------------------------------------------------------------------------
# RDS Postgres Instance
# ---------------------------------------------------------------------------

resource "aws_db_instance" "main" {
  identifier = "${local.name_prefix}-postgres"

  # Engine
  engine               = "postgres"
  engine_version       = "16"
  instance_class       = var.db_instance_class
  parameter_group_name = "default.postgres16"

  # Storage — 20GB gp3, no autoscaling yet
  allocated_storage = 20
  storage_type      = "gp3"

  # Database
  db_name  = var.db_name
  username = var.db_username
  password = random_password.db_password.result

  # Networking — private subnets only
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible    = false
  port                   = 5432

  # Availability — single AZ for cost optimization
  multi_az = false

  # Backups
  backup_retention_period = var.environment == "production" ? 7 : 1
  backup_window           = "03:00-04:00"
  maintenance_window      = "sun:04:00-sun:05:00"

  # Snapshots — skip final snapshot in non-prod
  skip_final_snapshot       = var.environment != "production"
  final_snapshot_identifier = var.environment == "production" ? "${local.name_prefix}-final-snapshot" : null

  # Encryption
  storage_encrypted = true

  # Monitoring
  performance_insights_enabled = false

  # Deletion protection in production
  deletion_protection = var.environment == "production"

  tags = {
    Name = "${local.name_prefix}-postgres"
  }
}
