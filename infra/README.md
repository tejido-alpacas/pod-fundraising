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

**Every merge to `main` deploys.** When a pull request is merged, GitHub runs the checks on
`main` and, if they are green, releases both apps to the live site. Nobody runs a command. The
rest of this page is the one-time setup, how to see what a deploy did, and what to do when one
fails.

## One-time setup, by a person

Until all four steps are done, the deploy after each merge fails without changing anything: it
checks the secrets, the database and the bucket before it builds or uploads.

**1. Create a Cloudflare API token.** Start from Cloudflare's "Edit Cloudflare Workers" token
template, which covers Workers, R2 and the zone, and add **D1: Edit**. Its zone resources must
include `tejido.net`. Terraform and the deploy both use this one token.

**2. Create the database and the bucket, once, with Terraform.** You need Terraform 1.9 or
later and the token in `CLOUDFLARE_API_TOKEN`. From this folder, copy
`terraform.tfvars.example` to `terraform.tfvars`, set `account_id`, then:

```bash
terraform init
```

```bash
terraform apply
```

Commit the `.terraform.lock.hcl` that `init` writes. The deploy never creates these two; it
finds the database by its name, `tejido`, and stops if it or the bucket is missing.

**3. Add the secrets to GitHub.** In the repository on GitHub: Settings → Secrets and variables
→ Actions → New repository secret. Add all eight. Paste each value into GitHub only, never
into a chat, a file in the repository or a pull request.

| Secret                        | What it is                                                   |
| ----------------------------- | ------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`        | The token from step 1                                        |
| `CLOUDFLARE_ACCOUNT_ID`       | The Cloudflare account id, the same as in `terraform.tfvars` |
| `SESSION_SECRET`              | Encrypts session cookies. Generate: `openssl rand -hex 32`   |
| `CHECKIN_SHARED_SECRET`       | Shared with Qatom (step 4). Generate: `openssl rand -hex 32` |
| `OIDC_CLIENT_SECRET`          | The secret of the Qatom sign-in client `tejido.net`          |
| `QATOM_ACCOUNT_CLIENT_ID`     | Tejido's merchant account on Qatom, not the sign-in client   |
| `QATOM_ACCOUNT_CLIENT_SECRET` | The merchant account's secret                                |
| `ANTHROPIC_API_KEY`           | Runs the model behind the agent chat                         |

The other four configuration values are not secret and are written in the `deploy` job of
`.github/workflows/ci.yml`: `PAYMENT_API_URL` (`https://pay.m.todaq.net`, production Qatom),
`QATOM_MCP_URL`, `OIDC_CLIENT_ID` and `OIDC_REDIRECT_URI`. Changing one is a pull request.

**4. Tell Qatom.** Register `https://app.tejido.net/auth/callback` as the redirect URI of the
sign-in client, exactly. Set `https://tejido.net/api/checkins` as the external endpoint of both
catalog items, with `CHECKIN_SHARED_SECRET` as the sensitive `X-Tejido-Checkin-Secret` header.

**Before the first deploy, read "The hostnames" below.** The first deploy takes `tejido.net`
over from the existing site without asking.

## What a deploy does

The `deploy` job in `.github/workflows/ci.yml` runs after the `check` and `terraform` jobs are
green, only on `main`. On a pull request it shows as skipped. In order:

1. Stops if any of the eight secrets is empty, naming the missing ones.
2. Finds the `tejido` database and the `tejido-evidence` bucket. Stops if either is missing.
3. Runs `infra/deploy.sh`, which builds both apps, applies any new database migrations, then
   replaces the `tejido-web` Worker and then the `tejido-app` Worker, uploading the ten
   configuration values to each as Worker secrets.

Deploys run one at a time and a running one is never cancelled. If several merges land while
one is running, GitHub keeps only the newest waiting; that one deploys everything.

**Seeing the result.** On GitHub, open the Actions tab and the newest "CI" run on `main`. A
green tick on `deploy` means the live site is running that commit. A red cross means it is
not; open the job to see the step that failed and its message.

## When a deploy fails

A red `deploy` never blocks pull requests, but the live site is behind `main` until a deploy
succeeds. Tell whoever looks after the infrastructure. Where it stopped tells you what state
things are in:

- **"Check that every secret is set"** or **"Find the live database and bucket".** Nothing was
  changed. Fix the setup step it names, then re-run the job (the "Re-run jobs" button on the
  run's page).
- **Building.** Nothing was changed.
- **"Migrating the database".** The Workers were not replaced, so the live site still runs the
  old code. Migrations that ran before the failing one stay applied; D1 does not undo them.
  Fix the migration with a new pull request (Track C). Never edit a committed migration.
- **"Deploying web"** or **"Deploying app".** The database is migrated and one or both Workers
  are still the old version. If `web` succeeded and `app` failed, the two are briefly on
  different versions. Re-run the job once the cause is fixed; re-running is safe.
- **A bad release that deployed fine.** Revert the pull request (the "Revert" button on its
  page) and merge the revert: that deploys the previous code. It does not undo a migration.

## Deploying by hand

Only when GitHub Actions is down, or for the fixtures. Run it from your own terminal on an
up-to-date, clean checkout of `main` (it deploys what is on disk, not a commit). Agents are
told never to deploy, and `.claude/settings.json` makes Claude Code refuse `infra/deploy.sh`,
`terraform apply` and `destroy`, and the Wrangler commands that touch the live account. The
match is on the text of the command, so Claude Code also refuses any shell command that merely
mentions one of them.

On the machine that ran Terraform, with `CLOUDFLARE_API_TOKEN` set:

```bash
infra/deploy.sh
```

On any other machine, also set `CLOUDFLARE_ACCOUNT_ID`, `TEJIDO_D1_DATABASE_ID` (the id that
`npx wrangler d1 list` shows for `tejido`), `TEJIDO_WEB_HOSTNAME` and `TEJIDO_APP_HOSTNAME`.
With `TEJIDO_D1_DATABASE_ID` set the script does not use Terraform.

- **A secret changed.** Change it in GitHub's secrets, then re-run the newest `deploy` job;
  every deploy uploads all ten values. Secrets are additive: a value already on a Worker stays
  until overwritten. By hand: `infra/deploy.sh --secrets path/to/production.json`, a JSON
  object of the ten values kept outside the repository. An env file also works, but Wrangler
  expands `$NAME` inside it, so a literal dollar sign must be written `\$`.
- **The demo needs the fixtures.** By hand, once: `infra/deploy.sh --seed`. A second run fails
  on the fixtures' ids instead of duplicating them. The automatic deploy never seeds.
- **Logs.** `npx wrangler tail tejido-web` or `tejido-app`, or the Worker's Logs tab in the
  dashboard.

## The hostnames

The Campaign Site is served at `tejido.net` and the App at `app.tejido.net`. For the automatic
deploy the two names are written in the `deploy` job of `.github/workflows/ci.yml`; by hand
from the Terraform machine they are `web_hostname` and `app_hostname` in `terraform.tfvars`.
Their zone must be in the same Cloudflare account. Wrangler creates the DNS record for each.

**`tejido.net` is currently the existing Tejido site, and the first automatic deploy replaces
it without asking.** In a terminal, Wrangler stops and asks before it repoints a hostname that
already has a DNS record or belongs to another Worker. On GitHub there is nobody to ask, so
Wrangler (4.162, read from its source) answers yes for itself: it overwrites the DNS record
and takes the hostname from the other Worker. So, once, before the first merge that deploys:

- Decide that the existing site at `tejido.net` is ready to be replaced, and keep a note of
  its current DNS record so it can be put back.
- If the existing site is a Cloudflare Pages project, remove `tejido.net` from that project's
  custom domains first. We have not been able to test what Wrangler does to a hostname that a
  Pages project holds; it may fail the deploy rather than take it over.
- To try the deploy somewhere harmless first, change the two hostnames in the workflow to a
  spare pair, such as `pod.tejido.net` and `app-pod.tejido.net`, in a pull request.
  `OIDC_REDIRECT_URI` and the Qatom registrations must then name the spare App hostname.

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
- **The deploy job is new.** It was written without being run, because agents never deploy.
  Expect to fix something the first time it runs.
- **No trial run and no staging.** Every merge goes straight to the live site.
- **A migration is not undone** when a deploy fails or a pull request is reverted.
- **State is local.** `terraform.tfstate` stays on the machine that ran `apply` and is ignored
  by git, so one person owns the database and the bucket. The deploy does not need it: it
  finds the database by name. Add a remote backend to share it.
- **Terraform refuses to destroy** the database and the bucket. To remove them, delete the
  `prevent_destroy` blocks in `main.tf` first.
