#!/usr/bin/env bash
# Deploys a commit to the server Terraform built. Run it from anywhere in the repository:
#
#     infra/deploy.sh            deploys HEAD
#     infra/deploy.sh main       deploys any ref
#
# Only committed files are shipped. It bundles the ref, uploads it to the releases bucket and
# asks the server, through Systems Manager, to build and switch to it. Needs the AWS CLI and
# Terraform, with credentials for the account, and `terraform apply` already run.
set -euo pipefail

root=$(git rev-parse --show-toplevel)
ref=${1:-HEAD}
sha=$(git -C "$root" rev-parse --short=12 "$ref^{commit}")

output() { terraform -chdir="$root/infra" output -raw "$1"; }
region=$(output region)
bucket=$(output releases_bucket)
instance=$(output instance_id)

key="releases/$(date -u +%Y%m%dT%H%M%SZ)-$sha.tar.gz"
echo "Uploading $sha to s3://$bucket/$key"
git -C "$root" archive --format=tar.gz "$ref" | aws s3 cp --region "$region" --only-show-errors - "s3://$bucket/$key"

command=$(aws ssm send-command --region "$region" \
	--instance-ids "$instance" \
	--document-name AWS-RunShellScript \
	--comment "Deploy $sha" \
	--timeout-seconds 120 \
	--parameters "{\"commands\":[\"/usr/local/bin/tejido-deploy $key\"],\"executionTimeout\":[\"1200\"]}" \
	--query Command.CommandId --output text)
echo "Building on $instance (command $command). This takes a few minutes."

invocation() {
	aws ssm get-command-invocation --region "$region" --command-id "$command" \
		--instance-id "$instance" --query "$1" --output text 2>/dev/null || true
}

status=
# Up to 25 minutes: longer than the server's own 20 minute limit on the build.
for _ in $(seq 1 150); do
	sleep 10
	status=$(invocation Status)
	[[ $status == Pending || $status == InProgress || $status == Delayed || -z $status ]] || break
done

invocation StandardOutputContent
if [[ $status != Success ]]; then
	invocation StandardErrorContent >&2
	echo "Deploy failed: $status. The previous release is still running." >&2
	exit 1
fi

echo
echo "Campaign Site: $(output web_url)"
echo "App:           $(output app_url)"
