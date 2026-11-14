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

**1. Create a Cloudflare API token.** Terraform and the deploy both use this one token. In the
Cloudflare dashboard: My Profile → API Tokens → Create Token. A token built from scratch
("Create Custom Token") worked on the first deploy with these permissions:

| Scope   | Permissions                                                                                               |
| ------- | --------------------------------------------------------------------------------------------------------- |
| Account | D1: Edit · Workers Scripts: Edit · Workers R2 Storage: Edit · Workers Tail: Read · Account Settings: Read |
| Zone    | Zone: Read · Workers Routes: Edit                                                                         |
| User    | User Details: Read · Memberships: Read                                                                    |

Its zone resources must include `tejido.net`. Zone **DNS: Edit** was recommended to us and may
be needed for attaching the hostnames; we have not confirmed whether the deploy works without
it.

- It must be an API **token**. The account's Global API Key does not work as
  `CLOUDFLARE_API_TOKEN`.
- If you give the token a TTL (a start and an end date), check both dates. A token whose start
  date is still in the future, or that has expired, is refused: see "When a deploy fails".

**2. Create the database and the bucket, once, with Terraform.** First enable R2 on the
Cloudflare account (R2 in the dashboard). Cloudflare asks for a payment method even for the
free allowance, and until that is done Terraform cannot create the bucket.

You need Terraform 1.9 or later and the token in `CLOUDFLARE_API_TOKEN`. From this folder, copy
`terraform.tfvars.example` to `terraform.tfvars`, set `account_id`, then:

```bash
terraform init
```

```bash
terraform apply
```

Commit the `.terraform.lock.hcl` that `init` writes. The deploy never creates these two; it
finds the database by its name, `tejido`, and stops if it or the bucket is missing.

If a `tejido` database already exists on the account but this machine's Terraform did not
create it, `terraform apply` fails with "Database with name: 'tejido' already exists" (code
7502). Do not delete the database. Tell Terraform about it instead, then apply again. The
account id is the one in `terraform.tfvars`; the database id is the one `npx wrangler d1 list`
shows for `tejido`:

```bash
terraform import cloudflare_d1_database.tejido '<account-id>/<database-id>'
```

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

The other five configuration values are not secret and are written in the `deploy` job of
`.github/workflows/ci.yml`: `PAYMENT_API_URL` (`https://pay.m.todaq.net`, production Qatom),
`QATOM_MCP_URL`, `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI` and `WEB_OIDC_REDIRECT_URI`. Changing
one is a pull request.

**4. Tell Qatom.** Register `https://app.tejido.net/auth/callback` (the App) and
`https://tejido.net/auth/callback` (the Campaign Site, for donors) as redirect URIs of the
sign-in client, exactly. Set `https://tejido.net/api/checkins` as the external endpoint of both
catalog items, with `CHECKIN_SHARED_SECRET` as the sensitive `X-Tejido-Checkin-Secret` header.

**Before the first deploy to a hostname, read "The hostnames" below.** A hostname that already
has DNS records is not taken over: the deploy fails until a person deletes those records.

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
succeeds. Tell whoever looks after the infrastructure.

**Re-run the newest run, not the one that failed.** "Re-run jobs" on a run's page deploys the
commit that run was made for. Re-running an old run puts that old code on the live site, not
the newest `main`. So once the cause is fixed, open the Actions tab, open the newest "CI" run
on `main`, and re-run that one.

Where it stopped tells you what state things are in:

- **"Check that every secret is set"** or **"Find the live database and bucket".** Nothing was
  changed. Fix the setup step it names, then re-run.
- **"Invalid access token [code: 9109]"** or **"Authentication error [code: 10000]"** at "Find
  the live database and bucket". Nothing was changed. Cloudflare refused the token. Check the
  token's TTL dates in the Cloudflare dashboard: we saw this with a start date still in the
  future, and an expired token fails the same way. Also check that the secret holds an API
  token and not the Global API Key. Fix or replace the token, update `CLOUDFLARE_API_TOKEN` in
  GitHub's secrets, then re-run.
- **Building.** Nothing was changed.
- **"Migrating the database".** The Workers were not replaced, so the live site still runs the
  old code. Migrations that ran before the failing one stay applied; D1 does not undo them.
  Fix the migration with a new pull request (Track C). Never edit a committed migration.
- **"Deploying web"** or **"Deploying app".** The database is migrated and one or both Workers
  are still the old version. If `web` succeeded and `app` failed, the two are briefly on
  different versions. Re-run once the cause is fixed; re-running is safe.
- **"Hostname 'tejido.net' already has externally managed DNS records (A, CNAME, etc). Delete
  them first or try a different hostname. [code: 100117]"** (or the same for another
  hostname). This happened on the first deploy. The database was migrated and the new
  `tejido-web` code was uploaded, but no hostname was attached to it and `tejido-app` was not
  deployed, so nothing new was reachable. Wrangler will not take over a hostname that already
  has DNS records. A person must delete them first: see "The hostnames". Then re-run; that
  succeeded for us.
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

- **A secret changed.** Change it in GitHub's secrets, then re-run the newest run on `main`;
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
Their zone must be in the same Cloudflare account. Wrangler creates the DNS record for a
hostname that has none.

**A hostname that already has DNS records is not taken over. A person must delete those
records first.** The first deploy to `tejido.net`, which was serving the existing Tejido site,
failed with "Hostname 'tejido.net' already has externally managed DNS records (A, CNAME, etc).
Delete them first or try a different hostname. [code: 100117]". The deploy does not overwrite
or remove existing records by itself. So, once, before the first deploy to a hostname that is
already in use:

- Decide that the existing site at that hostname is ready to be replaced. **It goes offline
  the moment its DNS records are deleted**, and the hostname serves nothing until the next
  deploy succeeds a few minutes later.
- In the Cloudflare dashboard, open the zone's DNS records and write down every record for
  that hostname (type, name, content and whether it is proxied), so they can be put back.
- Delete those records, then re-run the newest "CI" run on `main` (or merge the pull request
  that deploys). After the records for `tejido.net` were deleted, the re-run succeeded.
- If the existing site is a Cloudflare Pages project, remove the hostname from that project's
  custom domains as well. We have not tested what Wrangler does to a hostname that a Pages
  project holds.
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
- **The deploy job has succeeded once.** The first real deploy went through after the fixes
  now written on this page. The other failure paths described in "When a deploy fails" (a
  failing migration, `web` deployed but `app` not) have not happened yet, so those
  descriptions are untested.
- **No trial run and no staging.** Every merge goes straight to the live site.
- **A migration is not undone** when a deploy fails or a pull request is reverted.
- **State is local.** `terraform.tfstate` stays on the machine that ran `apply` and is ignored
  by git, so one person owns the database and the bucket. The deploy does not need it: it
  finds the database by name. Add a remote backend to share it.
- **Terraform refuses to destroy** the database and the bucket. To remove them, delete the
  `prevent_destroy` blocks in `main.tf` first.
