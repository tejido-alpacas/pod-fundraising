#!/usr/bin/env bash
# Builds both apps and deploys them as Cloudflare Workers. Run it from anywhere in the
# repository, after `terraform apply` in this folder:
#
#     infra/deploy.sh                         deploy the working tree
#     infra/deploy.sh --secrets prod.env      also upload the configuration values
#     infra/deploy.sh --seed                  also load the fixtures into the database
#
# It deploys what is on disk, not a commit: check `git status` first. Needs Terraform, and
# CLOUDFLARE_API_TOKEN in the environment (the same token Terraform uses).
set -euo pipefail

secrets=
seed=false
while (($#)); do
	case $1 in
		--secrets)
			secrets=$(realpath "${2:?--secrets needs the path of an env file}")
			shift 2
			;;
		--seed)
			seed=true
			shift
			;;
		*)
			echo "Usage: infra/deploy.sh [--secrets <env file>] [--seed]" >&2
			exit 1
			;;
	esac
done

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN to a Cloudflare API token}"

root=$(git rev-parse --show-toplevel)
cd "$root"

output() { terraform -chdir=infra output -raw "$1"; }
CLOUDFLARE_ACCOUNT_ID=$(output account_id)
export CLOUDFLARE_ACCOUNT_ID
database_id=$(output d1_database_id)

# The committed wrangler.jsonc files carry a placeholder database id, which is what names the
# local database. Each deploy writes a copy with the real id from Terraform beside it.
placeholder=00000000-0000-0000-0000-000000000000
configure() {
	grep -q "$placeholder" "apps/$1/wrangler.jsonc" || {
		echo "apps/$1/wrangler.jsonc no longer has the placeholder database id." >&2
		exit 1
	}
	sed "s/$placeholder/$database_id/" "apps/$1/wrangler.jsonc" > "apps/$1/wrangler.deploy.jsonc"
}
configure web
configure app

echo "==> Building"
npm run build

# Before the new code goes live, so it never meets an old schema.
echo "==> Migrating the database"
npx wrangler d1 migrations apply tejido --remote --config apps/web/wrangler.deploy.jsonc

if $seed; then
	echo "==> Seeding the fixtures"
	npm run db:seed:sql > infra/seed.sql
	npx wrangler d1 execute tejido --remote --yes --file infra/seed.sql \
		--config apps/web/wrangler.deploy.jsonc
fi

deploy() {
	local app=$1 hostname=$2
	local args=(--config "apps/$app/wrangler.deploy.jsonc" --domain "$hostname")
	# Secrets are additive: values already on the Worker stay until overwritten.
	[[ -n $secrets ]] && args+=(--secrets-file "$secrets")
	echo "==> Deploying $app to $hostname"
	npx wrangler deploy "${args[@]}"
}
deploy web "$(output web_hostname)"
deploy app "$(output app_hostname)"

echo
echo "Campaign Site: $(output web_url)"
echo "App:           $(output app_url)"
