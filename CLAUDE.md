# Rules for agents working in this repository

Tejido's hackathon monorepo. Three people work here in parallel, one track each. Read
`README.md` for what the system does. These are the rules.

## Read first

- `docs/architecture.md`: what we are building and why, the flow through Qatom, and the rules
  the check-in endpoint enforces. Its last section lists corrections; where it and the code
  differ, the code is right.
- `docs/build-plan.md`: every surface by track, its priority, the checkpoints, the order to cut
  in, and what the foundation already built.

## Package manager

- npm only, with npm workspaces. Never pnpm, yarn or bun. Never add Turborepo or Nx.
- `package-lock.json` is committed and is the only lockfile.
- Node 24. TypeScript everywhere, strict, ES modules.

## Where code lives

Work only in the home of the track you were asked to work on. Do not edit another track's files.

| Track             | Home                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------ |
| A · Campaign Site | `apps/web/src/routes/(campaign-site)/`, `apps/web/src/lib/campaign-site/`            |
| B · App           | `apps/app/`, the whole app                                                           |
| C · Backend       | `apps/web/src/routes/(backend)/`, `apps/web/src/lib/server/backend/`, `packages/db/` |

There are two apps. `apps/web` is the Campaign Site and the backend. `apps/app` is the App for
third parties and confirmers, deployed separately at app.tejido.net; sign-in, sessions and
evidence live there. They share the packages, the database and the configuration, and never
import from each other.

Shared files (`packages/contracts`, `packages/config`, `packages/qatom`, and in `apps/web`:
`hooks.server.ts`, `src/lib/server/context.ts`, the root layout and index; root config) change
only when the task says so.

## Contracts

- `packages/contracts` is the agreement between the three tracks. Change it only by agreement
  of all three. If a task seems to need a contract change, stop and say so; do not make it quietly.
- Changing a table in `packages/db/src/schema.ts` means running `npm run db:generate` and
  committing the migration. Typecheck fails if a table and its contract disagree.

## Qatom

- All Qatom calls go through `packages/qatom`. Nothing else calls Qatom, builds a Qatom URL or
  holds a Qatom credential.
- We use real Qatom. Never write a fake, mock or in-memory Qatom, and never add a mode switch for
  one. Stubbing `fetch` inside a test file is fine; a fake implementation in source is not.
- Follow Qatom's API document at `{PAYMENT_API_URL}/v4/openapi.json`. Do not guess shapes.
- **The two Qatom identities are never mixed.**
  - A person signed in with Qatom: `OIDC_*`, `@tejido/qatom/person`.
  - Tejido's merchant account: `QATOM_ACCOUNT_*`, `@tejido/qatom/account`. Server-side only.
  - Never use one's credentials or token for the other. A person's token is never used for a
    ledger read or a transfer.
- **Refunds go to the primary wallet only** (`primaryWalletHostname`, the `twin_hostname` claim).
  Never to the agent wallet (`agentWalletHostname`, `agent_twin_hostname`), which is where
  deposits are paid from. Do not cast one type to the other.
- A transfer is never retried automatically. After a timeout its outcome is unknown.

## Secrets and configuration

- No secrets in the repository. `.env` is ignored; `.env.example` holds names and placeholders.
- Configuration is parsed once, in `packages/config`. Do not read `process.env` anywhere else,
  and do not add a fallback or default for a missing value. In either app use
  `event.locals.ctx.config`.
- Both apps run as Cloudflare Workers. The database (D1) and the evidence store (R2) are
  bindings, read from `cloudflare:workers` only in each app's `src/lib/server/context.ts`. Do
  not use the file system, and do not use `db.transaction`: D1 needs `db.batch([...])`.
- Never log a token, a secret, or a response body that could contain one.
- Server-only packages (`@tejido/config`, `@tejido/db`, `@tejido/qatom`) are imported only from
  `+page.server.ts`, `+server.ts`, `hooks.server.ts` or a module under a `server/` folder.

## Conventions

- Relative imports carry the `.ts` extension. In the apps, `#lib/...` replaces `$lib/...`.
- Packages are imported as TypeScript source. There is no build step for them. Use only syntax
  Node can strip: no enums, no parameter properties, no namespaces.
- This is SvelteKit 3: configuration is in `vite.config.ts`, hook types come from
  `@sveltejs/kit/hooks`, and `building`/`dev` come from `$app/env`.
- Tests never reach the network.

## Before you finish

Run all four from the repository root. All must pass.

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm test
```

```bash
npm run build
```

`npm run format` fixes formatting.
