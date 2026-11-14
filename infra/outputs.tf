output "account_id" {
  value = var.account_id
}

output "d1_database_id" {
  description = "deploy.sh writes this into each app's Wrangler configuration."
  value       = cloudflare_d1_database.tejido.id
}

output "evidence_bucket" {
  value = cloudflare_r2_bucket.evidence.name
}

output "web_hostname" {
  value = var.web_hostname
}

output "app_hostname" {
  value = var.app_hostname
}

output "web_url" {
  description = "The Campaign Site."
  value       = "https://${var.web_hostname}"
}

output "app_url" {
  description = "The App."
  value       = "https://${var.app_hostname}"
}

output "oidc_redirect_uri" {
  description = "Put this in OIDC_REDIRECT_URI and register it with Qatom, exactly."
  value       = "https://${var.app_hostname}/auth/callback"
}

output "checkin_endpoint" {
  description = "The external endpoint of both catalog items in Qatom."
  value       = "https://${var.web_hostname}/api/checkins"
}
