terraform {
  required_version = ">= 1.9"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
  }
}

# Reads its token from the CLOUDFLARE_API_TOKEN environment variable, the same one Wrangler
# uses in deploy.sh. No credential is written in this folder.
provider "cloudflare" {}
