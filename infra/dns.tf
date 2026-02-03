# =============================================================================
# Aware Infrastructure — Route 53 & ACM Certificate
# =============================================================================
# After first apply:
#   - Check `terraform output nameservers` for the NS records
#   - Update your domain registrar (Porkbun) nameservers to those values
#   - Wait for propagation (~15min–48h) before DNS records resolve publicly
# =============================================================================

# ---------------------------------------------------------------------------
# Route 53 Hosted Zone — public zone (Terraform-managed)
# ---------------------------------------------------------------------------

resource "aws_route53_zone" "main" {
  name = var.domain

  tags = {
    Name = "${local.name_prefix}-zone"
  }
}

# ---------------------------------------------------------------------------
# ACM Certificate — wildcard + apex domain
# ---------------------------------------------------------------------------

# Request a certificate covering *.wareit.ai and wareit.ai
resource "aws_acm_certificate" "main" {
  domain_name               = var.domain
  subject_alternative_names = ["*.${var.domain}"]
  validation_method         = "DNS"

  lifecycle {
    create_before_destroy = true
  }

  tags = {
    Name = "${local.name_prefix}-cert"
  }
}

# Create DNS validation records in Route 53
resource "aws_route53_record" "cert_validation" {
  for_each = {
    for dvo in aws_acm_certificate.main.domain_validation_options : dvo.domain_name => {
      name   = dvo.resource_record_name
      record = dvo.resource_record_value
      type   = dvo.resource_record_type
    }
  }

  allow_overwrite = true
  name            = each.value.name
  records         = [each.value.record]
  ttl             = 60
  type            = each.value.type
  zone_id         = aws_route53_zone.main.zone_id
}

# Wait for certificate validation to complete
resource "aws_acm_certificate_validation" "main" {
  certificate_arn         = aws_acm_certificate.main.arn
  validation_record_fqdns = [for record in aws_route53_record.cert_validation : record.fqdn]
}

# ---------------------------------------------------------------------------
# DNS Records
# ---------------------------------------------------------------------------

# api.wareit.ai → ALB
resource "aws_route53_record" "api" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "api.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}

# *.wareit.ai → ALB (catches all tenant gateway subdomains)
# Tenant gateways are addressed as {slug}.wareit.ai
# This wildcard record ensures all of them resolve to the ALB,
# where host-based listener rules route to the correct target group.
# Explicit records (api.wareit.ai, etc.) take priority over the wildcard.
resource "aws_route53_record" "gateway_wildcard" {
  zone_id = aws_route53_zone.main.zone_id
  name    = "*.${var.domain}"
  type    = "A"

  alias {
    name                   = aws_lb.main.dns_name
    zone_id                = aws_lb.main.zone_id
    evaluate_target_health = true
  }
}
