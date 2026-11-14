#!/usr/bin/env bash
# Builds both apps, migrates the live database and deploys both apps as Cloudflare Workers.
#
# GitHub runs this on every merge to `main` (the `deploy` job in .github/workflows/ci.yml).
# A person can also run it by hand, from anywhere in the repository:
#
#     infra/deploy.sh                         deploy the working tree
#     infra/deploy.sh --secrets prod.json     also upload the configuration values
#     infra/deploy.sh --seed                  also load the fixtures into the database
#
# It deploys what is on disk, not a commit: check `git status` first.
#
# It always needs CLOUDFLARE_API_TOKEN. The database id, the account id and the two hostnames
# come from one of two places, never a mix and never a default:
#
#   - From the environment, when TEJIDO_D1_DATABASE_ID is set. Then CLOUDFLARE_ACCOUNT_ID,
#     TEJIDO_WEB_HOSTNAME and TEJIDO_APP_HOSTNAME must be set too. This is what CI does.
#   - Otherwise from Terraform's outputs, on the machine that ran `terraform apply` here.
set -euo pipefail

secrets=
seed=false
while (($#)); do
	case $1 in
		--secrets)
			secrets=$(realpath "${2:?--secrets needs the path of a JSON or env file}")
			shift 2
			;;
		--seed)
			seed=true
			shift
			;;
		*)
			echo "Usage: infra/deploy.sh [--secrets <JSON or env file>] [--seed]" >&2
			exit 1
			;;
	esac
done

: "${CLOUDFLARE_API_TOKEN:?Set CLOUDFLARE_API_TOKEN to a Cloudflare API token}"

root=$(git rev-parse --show-toplevel)
cd "$root"

if [[ -n ${TEJIDO_D1_DATABASE_ID:-} ]]; then
	: "${CLOUDFLARE_ACCOUNT_ID:?TEJIDO_D1_DATABASE_ID is set, so CLOUDFLARE_ACCOUNT_ID must be set too}"
	: "${TEJIDO_WEB_HOSTNAME:?TEJIDO_D1_DATABASE_ID is set, so TEJIDO_WEB_HOSTNAME must be set too}"
	: "${TEJIDO_APP_HOSTNAME:?TEJIDO_D1_DATABASE_ID is set, so TEJIDO_APP_HOSTNAME must be set too}"
	database_id=$TEJIDO_D1_DATABASE_ID
	web_hostname=$TEJIDO_WEB_HOSTNAME
	app_hostname=$TEJIDO_APP_HOSTNAME
else
	output() { terraform -chdir=infra output -raw "$1"; }
	CLOUDFLARE_ACCOUNT_ID=$(output account_id)
	database_id=$(output d1_database_id)
	web_hostname=$(output web_hostname)
	app_hostname=$(output app_hostname)
fi
export CLOUDFLARE_ACCOUNT_ID

[[ $database_id =~ ^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$ ]] || {
	echo "The D1 database id does not look like an id (expected 8-4-4-4-12 hex digits)." >&2
	exit 1
}

# The committed wrangler.jsonc files carry a placeholder database id, which is what names the
# local database. Each deploy writes a copy with the real id beside it.
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

# Before the new code goes live, so it never meets an old schema. If a migration fails, the
# script stops here (set -e) and the Workers that are live stay as they were.
echo "==> Migrating the database"
npx wrangler d1 migrations apply tejido --remote --config apps/web/wrangler.deploy.jsonc

# By hand and once only. CI never passes --seed.
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
deploy web "$web_hostname"
deploy app "$app_hostname"

echo
echo "Campaign Site: https://$web_hostname"
echo "App:           https://$app_hostname"
