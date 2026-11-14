locals {
  hostnames = {
    for key, site in local.sites :
    key => try(site.aliases[0], aws_cloudfront_distribution.site[key].domain_name)
  }
}

output "web_url" {
  description = "The Campaign Site."
  value       = "https://${local.hostnames.web}"
}

output "app_url" {
  description = "The App."
  value       = "https://${local.hostnames.app}"
}

output "oidc_redirect_uri" {
  description = "Put this in OIDC_REDIRECT_URI and register it with Qatom, exactly."
  value       = "https://${local.hostnames.app}/auth/callback"
}

output "checkin_endpoint" {
  description = "The external endpoint of both catalog items in Qatom."
  value       = "https://${local.hostnames.web}/api/checkins"
}

output "distribution_domains" {
  description = "Point a CNAME for each alias at its distribution."
  value       = { for key, distribution in aws_cloudfront_distribution.site : key => distribution.domain_name }
}

output "region" {
  value = var.region
}

output "instance_id" {
  description = "For Session Manager: aws ssm start-session --target <id>."
  value       = aws_instance.server.id
}

output "releases_bucket" {
  value = aws_s3_bucket.releases.bucket
}

output "env_parameter_name" {
  value = var.env_parameter_name
}
