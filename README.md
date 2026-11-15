# Tejido: proof-of-delivery fundraising

Tejido is a fundraising platform with proof of delivery. A campaign names, before it raises
anything, who will do the work and who will confirm it. Donors give through Qatom's hosted
checkout. Then the third parties doing the work (contractors, suppliers) log their work on a
schedule and claim milestones, and an independent confirmer signs each milestone off. Every
report is public, under the name of the person who filed it.

Every log, claim and confirmation is filed by buying a catalog item on Qatom, a payments platform
we use as it is. Qatom calls an endpoint of ours each time an item is bought, and afterwards we
ask Qatom for its own record of that purchase before the report's receipt is shown as verified.
Each purchase is a small deposit from the filer's own Qatom wallet: 0.10 for a work log, 1.00 for
a milestone claim or confirmation. When a milestone is confirmed, the deposits paid on it are
returned to the people who filed them.

This is the hackathon build, and it is live: the Campaign Site at https://tejido.net and the App
at https://app.tejido.net. Three people work in it in parallel, one track each, and every merge
to `main` is released to both sites.

The design is in [`docs/architecture.md`](docs/architecture.md) and the schedule in
[`docs/build-plan.md`](docs/build-plan.md). The code is under the MIT licence
([`LICENSE`](LICENSE)).

## What works today

Each of these was done on the live site on 15 November 2026 by the end-to-end run, with real
money where money is involved:

- **Sign in with Qatom**: third parties and confirmers in the App, creators and donors on the
  Campaign Site.
- **Start a campaign** in the builder at `/campaigns/new`: the project, the goal, the
  milestones, who does the work and who confirms each one, and the reporting schedule. Creating
  it gives one invitation link per person, and its creator then publishes it.
- **Give to a campaign** at `/give/<campaign>`: pressing an amount opens Qatom's checkout in a
  new window, and the campaign's total goes up when Qatom tells us the payment settled.
- **File a report in the App**, by talking to its assistant or filling in its form: a work log,
  a milestone claim (construction, a delivery, a service) or a confirmation. The person reads a
  review card and says yes before anything is filed or paid. A report that is missing something
  is saved as incomplete and can be completed without paying again.
- **Public proof**: a report is on the campaign's timeline at once, with a proof page of its
  own. Within about a minute Tejido checks its deposit with Qatom, and the receipt reads
  verified, pending or flagged.

Not finished:

- **Returning deposits is not automatic.** A person sends the refunds for a confirmed milestone
  (`POST /api/refunds`), and that has not yet been done on the live site.
- **The reporting schedule is not run on a timer.** What is due and overdue is worked out by
  `POST /api/schedule`, which nothing calls by itself yet.
- **Languages.** Home, Explore, Give and About are in Spanish, English, French and Portuguese.
  The campaign pages, the builder and the App are in English.

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

- the Campaign Site at http://localhost:5173. Its home page is the donors' home, and
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
`main` and keeps the screenshots with the run for a week. A run that follows a release never
moves money. The paid story (work logs, milestone claims and their confirmations for real
deposits, and one real donation, from the test people's wallets, on a campaign the run creates)
is told only by a run a person starts by hand with "paid" ticked. Test money is returned by the
owner, by hand.

It is not one of the four checks and `npm test` never runs it. What a person sets up once, how
to run it, what it costs and how to read a failure are in [`e2e/README.md`](e2e/README.md).

## Configuration

Configuration is parsed once at startup against one zod schema in `packages/config`. All eleven
values are required. Locally they come from `.env`; deployed, they are Worker secrets. Nothing
else in the repository reads the environment.

| Name                          | What it is                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `SESSION_SECRET`              | Encrypts session cookies. At least 32 characters                                                                                                 |
| `CHECKIN_SHARED_SECRET`       | Qatom sends it in the `X-Tejido-Checkin-Secret` header. 32+ printable characters, no spaces                                                      |
| `PAYMENT_API_URL`             | Origin of the Qatom payment API, no path. Staging is `https://pay.stage.m.todaq.net`                                                             |
| `QATOM_MCP_URL`               | Tejido's managed MCP server on Qatom                                                                                                             |
| `OIDC_CLIENT_ID`              | **Identity 1.** The sign-in client registration                                                                                                  |
| `OIDC_CLIENT_SECRET`          | **Identity 1.** The sign-in client's own secret, issued with its ID. Server-side only                                                            |
| `OIDC_REDIRECT_URI`           | **Identity 1.** The callback is in the App: locally `http://localhost:5174/auth/callback`. Must match the registration exactly                   |
| `WEB_OIDC_REDIRECT_URI`       | **Identity 1.** The Campaign Site's own callback, for donors: locally `http://localhost:5173/auth/callback`. Must match the registration exactly |
| `QATOM_ACCOUNT_CLIENT_ID`     | **Identity 2.** Tejido's merchant account                                                                                                        |
| `QATOM_ACCOUNT_CLIENT_SECRET` | **Identity 2.** Server-side only                                                                                                                 |
| `ANTHROPIC_API_KEY`           | Runs the model behind the agent chat                                                                                                             |

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
e2e                   the Playwright suite that walks the live site (see e2e/README.md)
docs                  the design, the build plan, the campaign API, setting up donations
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
- Track C: `apps/web/src/routes/(backend)/api/checkins/+server.ts`, the endpoint Qatom calls. Its
  rules are in `packages/db/src/checkin-rules.ts`.

## Two apps, one system

Both apps are SvelteKit 3 with Svelte 5 and the Cloudflare adapter. Each is deployed as its own
Worker, and they share everything underneath: the same packages, the same D1 database and the
same eleven configuration values.

|       | Campaign Site (`apps/web`)                                              | App (`apps/app`)                                     |
| ----- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| For   | Creators and donors, and Qatom's calls                                  | Third parties and confirmers                         |
| Local | http://localhost:5173                                                   | http://localhost:5174                                |
| Holds | Campaign pages, the builder, the Give page, what Qatom calls, the timer | Invite, chat, report form, upload, fix page, sign-in |

- **Sign-in lives in the App.** `OIDC_REDIRECT_URI` points at it, and so does the session cookie.
  Donors sign in on the Campaign Site separately, through `WEB_OIDC_REDIRECT_URI` and its own
  cookie, because a cookie set on one host is not sent to the other.
- **Evidence lives in the App.** Photo URLs are on the App's origin, and only the App is bound to
  the R2 bucket behind them.
- **Code runs in a Worker, not in Node.** `node:crypto` and `Buffer` work (the `nodejs_compat`
  flag); the file system does not. Store files in R2. D1 has no interactive transactions:
  writes that must land together go in one `db.batch([...])`.
- **The campaign builder's endpoints** (`POST /api/campaigns/check`, `POST /api/campaigns`) are
  described in [`docs/campaign-api.md`](docs/campaign-api.md).
- **Donations** go through Qatom's hosted checkout, one catalog item per amount. Setting the
  items up is in [`docs/donations-setup.md`](docs/donations-setup.md).
- **The backend's timer.** Once a minute Cloudflare runs the Campaign Site Worker's scheduled
  handler (`apps/web/src/lib/server/backend/worker.ts`). It checks the waiting receipts with
  Qatom and deletes the campaigns the end-to-end tests are finished with. It moves no money.
- In production each app is a Worker at its own hostname. `infra/deploy.sh` deploys both.

## The two Qatom identities

The app deals with Qatom as two different actors. They use two separate sets of credentials that
are both called client IDs. Mixing them is the easiest mistake to make here, so they are kept
apart in configuration, in code and in naming.

**1. A person, signed in with Qatom.** `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`,
`OIDC_REDIRECT_URI` (the App's callback), `WEB_OIDC_REDIRECT_URI` (the Campaign Site's). Code:
`@tejido/qatom/person`.
Creators, third parties and confirmers sign in through Qatom's OpenID Connect provider. A sign-in
returns two wallet hostnames:

- `agent_twin_hostname`, the **agent wallet**. Deposits are paid _from_ it: it is the only wallet
  the App's assistant may spend from.
- `twin_hostname`, the **primary wallet**. Refunds are sent _to_ it. Never to the agent wallet.

Both are stored on the party. In code they are two different types (`AgentWalletHostname`,
`PrimaryWalletHostname`), and a transfer only accepts the second.

**2. Tejido's merchant account.** `QATOM_ACCOUNT_CLIENT_ID`, `QATOM_ACCOUNT_CLIENT_SECRET`. Code:
`@tejido/qatom/account`.
It owns the catalog items, so only it can read their purchases and ledgers and make a checkout
for a donation, and refunds are paid from its wallet. Its functions take no token from the caller: the account fetches its own. No
person's token is ever used for a ledger read or a transfer, and its credentials never reach the
browser.

**What a verified receipt means.** Qatom confirms a settled sale of the item the report was
filed with, for exactly its deposit, tied to the report by the transaction id Qatom sent with
it. It does not show which wallet paid: Qatom's records name the payer only in a form that
cannot be compared with a wallet registered at sign-in.

## Setting up the two catalog items in Qatom

Every campaign shares the same two items on Tejido's merchant account: one Log work at 0.10 and
one Milestone hit at 1.00. There is no pair per campaign. Both items need:

- **External endpoint**: `https://<this app>/api/checkins`, method POST. Both items use the same
  endpoint; it tells them apart by whether `claim` is present.
- **Dispatch parameter**: a sensitive `header` named `X-Tejido-Checkin-Secret` whose value is
  `CHECKIN_SHARED_SECRET`.
- **Schema**: generate it from the contracts so it cannot drift:
  `itemInputJsonSchema('log_work')` and `itemInputJsonSchema('milestone_hit')` in
  `@tejido/contracts`. Nothing in it names one campaign: `milestone_id` is plain text, not a
  list of one campaign's milestones. Qatom refuses a purchase whose inputs do not fit the
  schema before it charges, so a list of one campaign's milestones would lock every other
  campaign out.

The two items' commodity ids are in `SHARED_ITEM_COMMODITY_ID`
(`apps/web/src/lib/server/backend/reconciler.ts`). A campaign with no ids of its own uses them,
so a new campaign needs nothing set up in Qatom. The ids are real and exist in one Qatom
environment only: the one the items were created in.

Qatom sends the sale's transaction id with each call (`X-Qatom-Transaction-Id`). The check-in
endpoint keeps it beside the report, and the reconciler looks the purchase up by it
(`GET /v4/catalog/purchases/{transaction_id}`) to verify the receipt.

## What has and has not met live Qatom

Met, on the live site on 15 November 2026: sign-in with the `twin` scope; buying both items
through the App's assistant; Qatom's calls to `/api/checkins` and `/api/donations`; the purchase
lookup that verifies a receipt; and the hosted checkout for a donation.

- **Amount units.** Qatom's API speaks decimal USD-TDN (`"0.100"`). We store whole thousandths
  (0.10 is `100`, `AMOUNT_UNITS_PER_USD_TDN` in `packages/contracts/src/money.ts`) and convert in
  one place, `packages/qatom/src/account/amounts.ts`.
- **Ledger addresses.** Qatom's ledger names a payer as a 66-character address, not a wallet
  hostname, and the two cannot be compared. That is why a receipt is verified by Qatom's purchase
  record and not from the ledger.
- **Not yet met: a refund.** `POST /api/refunds` sends a confirmed milestone's deposits to the
  filers' primary wallets through Qatom's `POST /v4/transfer`. It has not been called on the live
  site.
