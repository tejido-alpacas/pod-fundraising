# The data both apps share. These are the two things that must never be recreated by accident,
# so Terraform owns them. The Workers themselves (code, bindings, secrets, hostnames) are
# deployed by Wrangler from each app's wrangler.jsonc: see deploy.sh.
#
# The names are fixed because the apps' wrangler.jsonc files name the same resources.

# Our database. Both Workers bind it as `DB`. packages/db holds the schema and migrations.
resource "cloudflare_d1_database" "tejido" {
  account_id = var.account_id
  name       = "tejido"

  lifecycle {
    prevent_destroy = true
  }
}

# Uploaded evidence. The App binds it as `EVIDENCE`. It is private: files are served through
# the App's /evidence/{sha256}.{ext} route, never straight from the bucket.
resource "cloudflare_r2_bucket" "evidence" {
  account_id = var.account_id
  name       = "tejido-evidence"

  lifecycle {
    prevent_destroy = true
  }
}
