#!/bin/bash
# Installed on the server as /usr/local/bin/tejido-deploy. infra/deploy.sh runs it, as root,
# through Systems Manager:
#
#     tejido-deploy releases/20261114T120000Z-abc123def456.tar.gz
#
# It unpacks that bundle from S3, fetches the .env file, installs, builds, migrates the
# database and restarts both apps. A failed build leaves the running release untouched.
set -euo pipefail

key=${1:?Usage: tejido-deploy <key of the release bundle in S3>}
# shellcheck disable=SC1091
source /etc/tejido/deploy.conf

id=$(basename "$key" .tar.gz)
release=/opt/tejido/releases/$id
bundle=$(mktemp)
trap 'rm -f "$bundle"' EXIT

echo "==> Fetching $key"
aws s3 cp --region "$REGION" --only-show-errors "s3://$RELEASES_BUCKET/$key" "$bundle"
rm -rf "$release"
mkdir -p "$release"
tar -xzf "$bundle" -C "$release"

# The .env file is the whole configuration: the ten values packages/config requires. It is
# read from Parameter Store on every deploy, so changing a value is: update the parameter,
# deploy again. Its contents are never printed.
echo "==> Fetching configuration from $ENV_PARAMETER_NAME"
(
	umask 027
	aws ssm get-parameter --region "$REGION" --name "$ENV_PARAMETER_NAME" --with-decryption \
		--query Parameter.Value --output text > /etc/tejido/env.new
)
chown root:tejido /etc/tejido/env.new
mv /etc/tejido/env.new /etc/tejido/env
ln -sfn /etc/tejido/env "$release/.env"
chown -R tejido:tejido "$release"

# The full output goes to a log on the server; Systems Manager only returns the first 24,000
# characters of what is printed here, so a failure prints the end of the log instead.
log=/var/log/tejido-deploy.log
echo "==> Installing, building, migrating (full output in $log)"
if ! runuser -u tejido -- env PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/tejido bash -euo pipefail -c "
	cd '$release'
	npm ci --no-audit --no-fund
	npm run build
	npm run db:migrate
" > "$log" 2>&1; then
	tail -n 60 "$log" >&2
	exit 1
fi

echo "==> Switching to $id"
ln -sfn "$release" /opt/tejido/current
systemctl restart tejido-web tejido-app
sleep 3
systemctl is-active tejido-web tejido-app

# Keep this release and the two before it.
ls -1dt /opt/tejido/releases/*/ | tail -n +4 | xargs -r rm -rf

echo "==> Deployed $id"
