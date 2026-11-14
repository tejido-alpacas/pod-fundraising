# Infrastructure

Terraform for hosting both apps on AWS behind CloudFront.

```
viewer ──https──▶ CloudFront "web" ──http :3000──▶ ┌──────────── one EC2 server ────────────┐
                                                    │ tejido-web   node build   (apps/web)   │
viewer ──https──▶ CloudFront "app" ──http :3001──▶ │ tejido-app   node build   (apps/app)   │
                                                    │ /var/lib/tejido  database + evidence   │
                                                    └────────────────────────────────────────┘
```

**Why one server.** Both apps are Node servers, not static sites, and they share a SQLite file
and an evidence folder on disk. So they run side by side on one machine, with that data on its
own encrypted volume. CloudFront gives each app its own HTTPS hostname, which the App needs: its
session cookie and `OIDC_REDIRECT_URI` belong to it alone.

| File                          | What it holds                                                     |
| ----------------------------- | ----------------------------------------------------------------- |
| `main.tf`                     | Security group, releases bucket, server role, server, data volume |
| `cloudfront.tf`               | The two distributions                                             |
| `variables.tf`, `outputs.tf`  | Inputs (all have defaults) and the URLs to hand to Qatom          |
| `instance/user-data.sh.tftpl` | Runs once at first boot: Node 24, the data volume, two services   |
| `instance/tejido-deploy.sh`   | Installed on the server; builds and switches to a release         |
| `deploy.sh`                   | Run on your machine; ships a commit to the server                 |

You need Terraform 1.9 or later, the AWS CLI, and credentials for the account. The account must
still have its default VPC in the chosen region.

## First time

**1. Build it.** From this folder:

```bash
terraform init
```

```bash
terraform apply
```

Commit the `.terraform.lock.hcl` that `init` writes. The apply takes about five minutes, most of
it CloudFront, and prints the URLs:

```bash
terraform output
```

**2. Tell Qatom.** Register `oidc_redirect_uri` on the sign-in client, exactly as printed. Set
`checkin_endpoint` as the external endpoint of both catalog items.

**3. Store the configuration.** Write the production `.env`: the ten values from the root
README, with these two set for this server:

```
DATABASE_URL=file:/var/lib/tejido/tejido.db
OIDC_REDIRECT_URI=<the oidc_redirect_uri output>
```

Keep it outside the repository, without comments (the parameter holds 4 KB), and store it as one
encrypted parameter. Terraform never sees it, so no secret reaches the state file:

```bash
aws ssm put-parameter --region us-east-1 --name /tejido/env --type SecureString --overwrite --value file://path/to/production.env
```

**4. Deploy.**

```bash
infra/deploy.sh
```

## Deploying

`infra/deploy.sh [ref]` ships a commit, `HEAD` by default. Only committed files go. The server
runs `npm ci`, `npm run build` and `npm run db:migrate`, then restarts both apps. If any step
fails, the previous release keeps running and the end of the build log is printed.

- **A configuration value changed.** Run `put-parameter` again, then deploy again.
- **The demo needs the fixtures.** Deploys migrate but never seed. Seed once, from a shell on
  the server (below): `cd /opt/tejido/current && sudo -u tejido npm run db:seed`.

## Looking at the server

There is no SSH and no open port except the two CloudFront uses. Open a shell with Session
Manager:

```bash
aws ssm start-session --region us-east-1 --target "$(terraform output -raw instance_id)"
```

| What                 | Where                                                        |
| -------------------- | ------------------------------------------------------------ |
| App logs             | `sudo journalctl -u tejido-web -f`, likewise `tejido-app`    |
| Last deploy's output | `/var/log/tejido-deploy.log`                                 |
| First boot's output  | `/var/log/tejido-boot.log`                                   |
| Releases             | `/opt/tejido/releases/`, with `/opt/tejido/current` pointing |
| Database, evidence   | `/var/lib/tejido/`                                           |

## Custom hostnames

Without any, the apps are served at the two `cloudfront.net` names. To use real ones, copy
`terraform.tfvars.example` to `terraform.tfvars` and set the aliases and a certificate. The
certificate must be in `us-east-1`, whatever region the server is in, and must cover every
alias. Then point a CNAME for each alias at its entry in the `distribution_domains` output, and
update `OIDC_REDIRECT_URI`, its registration with Qatom, and the items' external endpoint.

## Known gaps

Fine for the hackathon; fix before real money or real people's data.

- **CloudFront to the server is plain HTTP.** The server has no certificate. Session cookies and
  `X-Tejido-Checkin-Secret` cross that hop unencrypted. The fix is a load balancer with a
  certificate, or a certificate on the server, either of which needs a domain.
- **Any CloudFront distribution can reach the server**, not just ours: the security group admits
  CloudFront's address range. Someone who learns the server's address could front it with their
  own distribution. They would still need a session or the check-in secret to do anything.
- **No backups.** The database and evidence are one volume in one zone. Snapshot it before
  anything risky.
- **State is local.** `terraform.tfstate` stays on the machine that ran `apply` and is ignored
  by git, so one person owns the infrastructure. Add an S3 backend to share it.
- **A deploy restarts both apps**, a second or two of 502s.

## Tearing down

The data volume refuses to be destroyed. To remove everything, delete the `prevent_destroy`
block in `main.tf` first, then:

```bash
terraform destroy
```
