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

`npm run dev` first creates the local database and seeds it with the fixtures, then starts the
app at http://localhost:5173. The index page lists every surface by track. The donor timeline at
http://localhost:5173/campaigns/library-wing shows the fixture campaign from the database.

The app refuses to start, naming each problem, if a configuration value is missing. That is
deliberate: there are no fallbacks.

## Scripts

Run these from the repository root. Each one runs across the workspaces.

| Script                | What it does                                                        |
| --------------------- | ------------------------------------------------------------------- |
| `npm run dev`         | Prepares the database, then starts the dev server                   |
| `npm run build`       | Builds the web app for production                                   |
| `npm test`            | Runs every test. Tests never reach the network                      |
| `npm run lint`        | Prettier check, then ESLint                                         |
| `npm run typecheck`   | TypeScript and Svelte type checks                                   |
| `npm run format`      | Formats everything with Prettier                                    |
| `npm run start`       | Runs the production build (`npm run build` first)                   |
| `npm run db:prepare`  | Applies migrations and seeds the fixtures if there are no campaigns |
| `npm run db:reset`    | Deletes the database file, then migrates and seeds                  |
| `npm run db:generate` | Writes a new migration after you change `packages/db/src/schema.ts` |

`typecheck`, `lint`, `test` and `build` need no `.env` and no Qatom credentials. CI runs exactly
those four.

## Configuration

Configuration is parsed once at startup against one zod schema in `packages/config`. All ten
values are required. Nothing else in the repository reads `process.env`.

| Name                          | What it is                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                | Our SQLite file. A relative path is resolved against the repository root                           |
| `SESSION_SECRET`              | Encrypts session cookies. At least 32 characters                                                   |
| `CHECKIN_SHARED_SECRET`       | Qatom sends it in the `X-Tejido-Checkin-Secret` header. 32+ printable characters, no spaces        |
| `PAYMENT_API_URL`             | Origin of the Qatom payment API, no path. Staging is `https://pay.stage.m.todaq.net`               |
| `QATOM_MCP_URL`               | Tejido's managed MCP server on Qatom                                                               |
| `OIDC_CLIENT_ID`              | **Identity 1.** The sign-in client registration                                                    |
| `OIDC_REDIRECT_URI`           | **Identity 1.** Locally `http://localhost:5173/auth/callback`. Must match the registration exactly |
| `QATOM_ACCOUNT_CLIENT_ID`     | **Identity 2.** Tejido's merchant account                                                          |
| `QATOM_ACCOUNT_CLIENT_SECRET` | **Identity 2.** Server-side only                                                                   |
| `ANTHROPIC_API_KEY`           | Runs the model behind the agent chat                                                               |

Uploaded evidence is stored in an `evidence` folder beside the database file. In production the
Node adapter limits request bodies to 512 KB; set `BODY_SIZE_LIMIT=10M` to accept photos.

## Layout

```
apps/web              the one web app: pages and server routes (SvelteKit 3, Svelte 5, Node adapter)
packages/contracts    what the three tracks agree on: zod schemas, types, fixtures
packages/config       the one configuration schema
packages/db           our database: Drizzle schema, client, migrations, seed (SQLite)
packages/qatom        the one place that talks to Qatom
```

Packages are plain TypeScript, imported as source. There is no build step for them, and a change
in a package shows up in the dev server at once. Relative imports carry the `.ts` extension.

## Who owns what

Each track has a home. Work in your own; do not edit another track's files.

| Track                 | Faces                        | Home                                                                                 |
| --------------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| **A** · Campaign Site | Creators and donors          | `apps/web/src/routes/(campaign-site)/`, `apps/web/src/lib/campaign-site/`            |
| **B** · App           | Third parties and confirmers | `apps/web/src/routes/(app)/`, `apps/web/src/lib/app/`                                |
| **C** · Backend       | Our server side              | `apps/web/src/routes/(backend)/`, `apps/web/src/lib/server/backend/`, `packages/db/` |

The folders in brackets are SvelteKit route groups: they organise files and do not appear in URLs.
So Track B's `(app)/api/evidence/+server.ts` serves `/api/evidence`, and Track C's
`(backend)/api/checkins/+server.ts` serves `/api/checkins`.

Shared, change by agreement: `packages/contracts`, `packages/config`, `packages/qatom`,
`apps/web/src/hooks.server.ts`, `apps/web/src/lib/server/context.ts` and `session.ts`, the root
layout and index page, and the root configuration files.

**The first file to open**

- Track A: `apps/web/src/routes/(campaign-site)/campaigns/[campaignId]/+page.server.ts`, the
  working timeline. Copy its pattern for the other pages.
- Track B: `apps/web/src/routes/(app)/auth/callback/+server.ts`, where a sign-in lands and the
  wallets are stored. The invite page is next to it under `(app)/app/invite/`.
- Track C: `apps/web/src/routes/(backend)/api/checkins/+server.ts`, the endpoint Qatom calls. The
  `TODO(Track C)` marks where the milestone rules go.

## The two Qatom identities

The app deals with Qatom as two different actors. They use two separate sets of credentials that
are both called client IDs. Mixing them is the easiest mistake to make here, so they are kept
apart in configuration, in code and in naming.

**1. A person, signed in with Qatom.** `OIDC_CLIENT_ID`, `OIDC_REDIRECT_URI`. Code:
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

Then store each item's commodity hash on the campaign (`logWorkCommodityHash`,
`milestoneHitCommodityHash`) so the reconciler knows which ledgers to read.

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
