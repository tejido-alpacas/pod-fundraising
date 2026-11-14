# Tejido: proof-of-delivery fundraising

Tejido is a fundraising platform. This repository adds proof of delivery: once a campaign is
funded, the third parties doing the work (contractors, suppliers) log their work on a schedule
and claim milestones, and an independent confirmer signs each milestone off.

Every log and claim is filed by buying a catalog item on Qatom, a payments platform we use as it
is. Qatom calls an endpoint of ours each time an item is bought, and we read its ledger afterwards
to verify who paid. Each purchase is a small deposit from the filer's own Qatom wallet: 0.10 for a
work log, 1.00 for a milestone claim or confirmation. When a milestone is confirmed we send the
deposits paid on it back.

This is the hackathon build. Three people work in it in parallel, one track each. The existing
site at tejido.net is a separate app and is not used here.

The design is in [`docs/architecture.md`](docs/architecture.md) and the schedule in
[`docs/build-plan.md`](docs/build-plan.md).

## Prerequisites

- Node 24 (`nvm use` reads `.nvmrc`)
- npm 11, which ships with Node 24

npm is the only package manager. `npm install` refuses to run under pnpm, yarn or bun, and
`package-lock.json` is the only lockfile.

## Setup

```bash
npm install
```

```bash
cp .env.example .env
```

Replace every `replace-me` in `.env` with a real value (see [Configuration](#configuration)), then:

```bash
npm run dev
```

`npm run dev` first creates the local database and seeds it with the fixtures, then starts both
apps. Both are Cloudflare Workers; locally Wrangler emulates the database (D1) and the evidence
store (R2) and keeps them in `./data`, so nothing here needs a Cloudflare account:

- the Campaign Site at http://localhost:5173. Its index page lists every surface by track, and
  http://localhost:5173/campaigns/library-wing shows the fixture campaign from the database.
- the App at http://localhost:5174, for third parties and confirmers.

The app refuses to start, naming each problem, if a configuration value is missing. That is
deliberate: there are no fallbacks.

## Scripts

Run these from the repository root. Each one runs across the workspaces. `dev` and `start` run
the two apps side by side, since a server never exits to let the next one begin.

| Script                | What it does                                                         |
| --------------------- | -------------------------------------------------------------------- |
| `npm run dev`         | Prepares the database, then starts both apps                         |
| `npm run build`       | Builds both apps as Cloudflare Workers                               |
| `npm test`            | Runs every unit test. They never reach the network                   |
| `npm run lint`        | Prettier check, then ESLint                                          |
| `npm run typecheck`   | TypeScript and Svelte type checks                                    |
| `npm run format`      | Formats everything with Prettier                                     |
| `npm run start`       | Runs both builds in Wrangler's local runtime (`npm run build` first) |
| `npm run db:prepare`  | Applies migrations and seeds the fixtures if there are no campaigns  |
| `npm run db:reset`    | Deletes the local database, then migrates and seeds                  |
| `npm run db:generate` | Writes a new migration after you change `packages/db/src/schema.ts`  |
| `infra/deploy.sh`     | Deploys both apps. GitHub runs it on every merge to `main`           |

`typecheck`, `lint`, `test` and `build` need no `.env` and no Qatom credentials. CI runs exactly
those four.

## End-to-end checks against the live site

`e2e/` holds a Playwright suite that signs two fixed test people in to the live App through real
Qatom (it reads each emailed sign-in code from a queue), walks the App and the Campaign Site, and
keeps a screenshot of every step at phone and desktop size. GitHub runs it after each release of
`main` and keeps the screenshots with the run for a week. A run a person starts by hand can also
file one work log for a real 0.10 deposit.

It is not one of the four checks and `npm test` never runs it. What a person sets up once, how
to run it, what it costs and how to read a failure are in [`e2e/README.md`](e2e/README.md).

## Configuration

Configuration is parsed once at startup against one zod schema in `packages/config`. All ten
values are required. Locally they come from `.env`; deployed, they are Worker secrets. Nothing
else in the repository reads the environment.

| Name                          | What it is                                                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`              | Encrypts session cookies. At least 32 characters                                                                               |
| `CHECKIN_SHARED_SECRET`       | Qatom sends it in the `X-Tejido-Checkin-Secret` header. 32+ printable characters, no spaces                                    |
| `PAYMENT_API_URL`             | Origin of the Qatom payment API, no path. Staging is `https://pay.stage.m.todaq.net`                                           |
| `QATOM_MCP_URL`               | Tejido's managed MCP server on Qatom                                                                                           |
| `OIDC_CLIENT_ID`              | **Identity 1.** The sign-in client registration                                                                                |
| `OIDC_CLIENT_SECRET`          | **Identity 1.** The sign-in client's own secret, issued with its ID. Server-side only                                          |
| `OIDC_REDIRECT_URI`           | **Identity 1.** The callback is in the App: locally `http://localhost:5174/auth/callback`. Must match the registration exactly |
| `QATOM_ACCOUNT_CLIENT_ID`     | **Identity 2.** Tejido's merchant account                                                                                      |
| `QATOM_ACCOUNT_CLIENT_SECRET` | **Identity 2.** Server-side only                                                                                               |
| `ANTHROPIC_API_KEY`           | Runs the model behind the agent chat                                                                                           |

The database and the evidence store are not configuration values. They are Cloudflare
bindings, declared in each app's `wrangler.jsonc`: `DB` is our D1 database and `EVIDENCE` is the
R2 bucket uploaded evidence is stored in.

## Layout

```
apps/web              the Campaign Site and the backend: creators, donors, and what Qatom calls
apps/app              the App: third parties and confirmers. Deployed at app.tejido.net
packages/contracts    what the three tracks agree on: zod schemas, types, fixtures
packages/config       the one configuration schema
packages/db           our database: Drizzle schema, client, migrations, seed (Cloudflare D1)
packages/qatom        the one place that talks to Qatom
infra                 Terraform for the D1 database and R2 bucket, and the deploy script
```

Packages are plain TypeScript, imported as source. There is no build step for them, and a change
in a package shows up in the dev server at once. Relative imports carry the `.ts` extension.

## Who owns what

Each track has a home. Work in your own; do not edit another track's files.

| Track                 | Faces                        | Home                                                                                 |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| **A** · Campaign Site | Creators and donors          | `apps/web/src/routes/(campaign-site)/`, `apps/web/src/lib/campaign-site/`            |
| **B** · App           | Third parties and confirmers | `apps/app/`, the whole app                                                           |
| **C** · Backend       | Our server side              | `apps/web/src/routes/(backend)/`, `apps/web/src/lib/server/backend/`, `packages/db/` |

The folders in brackets are SvelteKit route groups: they organise files and do not appear in URLs.
So Track C's `(backend)/api/checkins/+server.ts` serves `/api/checkins`.

Shared, change by agreement: `packages/contracts`, `packages/config`, `packages/qatom`,
`apps/web/src/hooks.server.ts`, `apps/web/src/lib/server/context.ts`, the Campaign Site's root
layout and index page, and the root configuration files.

**The first file to open**

- Track A: `apps/web/src/routes/(campaign-site)/campaigns/[campaignId]/+page.server.ts`, the
  working timeline. Copy its pattern for the other pages.
- Track B: `apps/app/src/routes/auth/callback/+server.ts`, where a sign-in lands and the wallets
  are stored. The invite page is `apps/app/src/routes/invite/[partyId]/`.
- Track C: `apps/web/src/routes/(backend)/api/checkins/+server.ts`, the endpoint Qatom calls. The
  `TODO(Track C)` marks where the milestone rules go.

## Two apps, one system

Both apps are SvelteKit 3 with Svelte 5 and the Cloudflare adapter. Each is deployed as its own
Worker, and they share everything underneath: the same packages, the same D1 database and the
same ten configuration values.

|       | Campaign Site (`apps/web`)                             | App (`apps/app`)                                    |
| ----- | ------------------------------------------------------ | --------------------------------------------------- |
| For   | Creators and donors, and Qatom's calls                 | Third parties and confirmers                        |
| Local | http://localhost:5173                                  | http://localhost:5174                               |
| Holds | Campaign pages, `POST /api/checkins`, the backend jobs | Invite, chat, upload, sign-in, `POST /api/evidence` |

- **Sign-in lives in the App.** `OIDC_REDIRECT_URI` points at it, and so does the session cookie.
  The Campaign Site has no sign-in yet; creators will need one, and a cookie set on one host is
  not sent to the other.
- **Evidence lives in the App.** Photo URLs are on the App's origin, and only the App is bound to
  the R2 bucket behind them.
- **Code runs in a Worker, not in Node.** `node:crypto` and `Buffer` work (the `nodejs_compat`
  flag); the file system does not. Store files in R2. D1 has no interactive transactions:
  writes that must land together go in one `db.batch([...])`.
- In production each app is a Worker at its own hostname. `infra/deploy.sh` deploys both.

## The two Qatom identities

The app deals with Qatom as two different actors. They use two separate sets of credentials that
are both called client IDs. Mixing them is the easiest mistake to make here, so they are kept
apart in configuration, in code and in naming.

**1. A person, signed in with Qatom.** `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
`OIDC_REDIRECT_URI`. Code:
`@tejido/qatom/person`.
Creators, third parties and confirmers sign in through Qatom's OpenID Connect provider. A sign-in
returns two wallet hostnames:

- `agent_twin_hostname`, the **agent wallet**. Deposits are paid _from_ it, so it is the address we
  expect as the payer in the ledger.
- `twin_hostname`, the **primary wallet**. Refunds are sent _to_ it. Never to the agent wallet.

Both are stored on the party. In code they are two different types (`AgentWalletHostname`,
`PrimaryWalletHostname`), and a transfer only accepts the second.

**2. Tejido's merchant account.** `QATOM_ACCOUNT_CLIENT_ID`, `QATOM_ACCOUNT_CLIENT_SECRET`. Code:
`@tejido/qatom/account`.
It owns every campaign's catalog items, so only it can read their ledgers, and refunds are paid
from its wallet. Its functions take no token from the caller: the account fetches its own. No
person's token is ever used for a ledger read or a transfer, and its credentials never reach the
browser.

## Setting up the two catalog items in Qatom

For each campaign, both items (Log work at 0.10, Milestone hit at 1.00) need:

- **External endpoint**: `https://<this app>/api/checkins`, method POST. Both items use the same
  endpoint; it tells them apart by whether `claim` is present.
- **Dispatch parameter**: a sensitive `header` named `X-Tejido-Checkin-Secret` whose value is
  `CHECKIN_SHARED_SECRET`.
- **Schema**: generate it from the contracts so it cannot drift:
  `itemInputJsonSchema('log_work', milestoneIds)` in `@tejido/contracts`.

Then store each item's commodity id (a whole number) on the campaign (`logWorkCommodityId`,
`milestoneHitCommodityId`) so the reconciler knows which ledgers to read. Qatom reads a ledger by
the commodity's hash; the merchant account looks each hash up from its id
(`resolveCommodityHash`) and remembers it. The example campaign's two ids are real and exist in
one Qatom environment only: the one its items were created in.

## Still to confirm on staging

The Qatom client follows Qatom's published API document, and was written without credentials. It
has not run against the live service. Check these first:

- **Amount units.** We store amounts as whole numbers of Qatom's smallest unit and assume one unit
  is 0.001 (so 0.10 is `100`). The document says transfers are "in the smallest unit" but not the
  scale, and does not say what unit the ledger's `amount` is in. Buy one 0.10 item and look. The
  constant is `AMOUNT_UNITS_PER_USD_TDN` in `packages/contracts/src/money.ts`.
- **Ledger addresses.** Whether the ledger's paying address is a bare hostname or a twin URL. Use
  `sameTwin()` from `@tejido/qatom` to compare; it accepts both.
- **The `twin` scope.** That the sign-in client may request it. Without it, sign-in fails with
  `missing_claims`.
- **A transfer's digital quantity.** `POST /v4/transfer` requires the DQ hash. The ledger returns
  it as `dq`; pass that through.
