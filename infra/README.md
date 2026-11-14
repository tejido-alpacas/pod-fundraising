# Infrastructure

Both apps run on Cloudflare, with no server of our own.

| Piece                    | What it is                                  | Who creates it    |
| ------------------------ | ------------------------------------------- | ----------------- |
| `tejido-web` Worker      | The Campaign Site and backend (`apps/web`)  | `infra/deploy.sh` |
| `tejido-app` Worker      | The App (`apps/app`)                        | `infra/deploy.sh` |
| `tejido` D1 database     | Our database. Both Workers bind it as `DB`  | Terraform         |
| `tejido-evidence` bucket | Uploaded evidence. The App binds `EVIDENCE` | Terraform         |
| The two hostnames        | A custom domain on each Worker              | `infra/deploy.sh` |

**Why the split.** Terraform owns the two things that hold data, which must never be recreated
by accident. Wrangler deploys everything that changes with the code: the Workers, their
bindings, their secrets and their hostnames, from each app's `wrangler.jsonc`.

You need Terraform 1.9 or later, and a Cloudflare API token in `CLOUDFLARE_API_TOKEN`. Start
from Cloudflare's "Edit Cloudflare Workers" token template, which covers Workers, R2 and the
zone, and add **D1: Edit**.

## First time

**1. Create the database and the bucket.** From this folder, copy `terraform.tfvars.example` to
`terraform.tfvars`, set `account_id`, then:

```bash
terraform init
```

```bash
terraform apply
```

Commit the `.terraform.lock.hcl` that `init` writes.

**2. Tell Qatom.** `terraform output` prints `oidc_redirect_uri` and `checkin_endpoint`.
Register the first on the sign-in client, exactly as printed, and set the second as the external
endpoint of both catalog items.

**3. Write the production configuration.** An env file with the ten values from the root
README, kept outside the repository. `OIDC_REDIRECT_URI` is the `oidc_redirect_uri` output.
Wrangler expands `$NAME` inside this file, so write a literal dollar sign as `\$`.

**4. Deploy, uploading the configuration as Worker secrets.**

```bash
infra/deploy.sh --secrets path/to/production.env
```

## Deploying

Run deploys from your own terminal. Agents are told never to deploy, and
`.claude/settings.json` makes Claude Code refuse `infra/deploy.sh`, `terraform apply` and
`destroy`, and the Wrangler commands that touch the live account. The match is on the text of
the command, so Claude Code also refuses any shell command that merely mentions one of them.

```bash
infra/deploy.sh
```

It builds both apps, applies any new database migrations, then deploys both Workers. It deploys
what is on disk, not a commit, so check `git status` first.

- **A configuration value changed.** Run it with `--secrets` again. Secrets are additive: values
  already on a Worker stay until overwritten.
- **The demo needs the fixtures.** Run it once with `--seed`. A second run fails on the
  fixtures' ids instead of duplicating them.
- **Logs.** `npx wrangler tail tejido-web` or `tejido-app`, or the Worker's Logs tab in the
  dashboard.

## The hostnames

`web_hostname` and `app_hostname` default to `tejido.net` and `app.tejido.net`. Their zone must
be in the same Cloudflare account. Wrangler creates the DNS record for each.

**`tejido.net` is currently the existing Tejido site.** Deploying takes that hostname over. If
it already has a DNS record, Wrangler stops and asks before replacing it; nothing is switched
silently. To try the deploy somewhere harmless first, set the two hostnames in
`terraform.tfvars` to a spare pair, such as `pod.tejido.net` and `app-pod.tejido.net`.

The two apps need separate hostnames: the session cookie and `OIDC_REDIRECT_URI` belong to the
App alone.

## Local development

Nothing here is needed to run locally. `npm run dev` uses Wrangler's local D1 and R2, kept in
`./data`. The `database_id` in the three `wrangler.jsonc` files is a placeholder that names
that local database; `deploy.sh` writes the real id into a `wrangler.deploy.jsonc` copy, which
git ignores.

## Known gaps

- **No scheduled jobs yet.** The cadence scheduler and reconciler will need a cron trigger on
  `tejido-web` when Track C builds them.
- **No backups configured.** D1 keeps 30 days of point-in-time recovery (`wrangler d1
time-travel`); the R2 bucket has no versioning.
- **State is local.** `terraform.tfstate` stays on the machine that ran `apply` and is ignored
  by git, so one person owns the infrastructure. Add a remote backend to share it.
- **Terraform refuses to destroy** the database and the bucket. To remove them, delete the
  `prevent_destroy` blocks in `main.tf` first.
