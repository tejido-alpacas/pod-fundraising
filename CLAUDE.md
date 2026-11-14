# Rules for agents working in this repository

Tejido's hackathon monorepo. Three people work here in parallel, one track each. Read
`README.md` for what the system does. These are the rules.

**The people you work for here are not programmers.** They cannot review your code, so they
rely on you to stay inside these rules and to tell them plainly what you did. When a rule
blocks the task, stop and say so. Do not look for a way around it.

## Read first

- `docs/architecture.md`: what we are building and why, the flow through Qatom, and the rules
  the check-in endpoint enforces. Its last section lists corrections; where it and the code
  differ, the code is right.
- `docs/build-plan.md`: every surface by track, its priority, the checkpoints, the order to cut
  in, and what the foundation already built.
- `docs/working-with-agents.md`: what your person has been told to expect from you.

## Before you start

- Know which track you are working on: A, B or C. If the request does not say and you cannot
  tell from the files it names, ask. Ask once, then wait.
- One task at a time. If the request holds several, do them in order and finish each (all four
  checks passing) before starting the next.
- Work on a branch, never directly on `main`.

## Stop and ask

Stop, say in plain words what you need and why, and wait for an answer when the task seems to
need any of these. Do not make the change first and mention it afterwards.

- A file outside your track's home, or any shared file (see "Where code lives").
- A change to `packages/contracts`, or to a table in `packages/db/src/schema.ts` when you are
  not on Track C.
- A new, removed or upgraded dependency. That includes anything that changes `package.json` or
  `package-lock.json`.
- A new configuration value, secret or Cloudflare binding.
- Anything in `infra/`, `.github/`, a `wrangler.jsonc`, a `vite.config.ts`, or the lint,
  format and TypeScript configuration.
- Deleting or renaming a file you did not create in this task.
- Anything that deletes data, including `npm run db:reset`. Say what will be lost first.
- The same fix has failed twice. Do not try a third variation. Describe what you tried, what
  happened, and what you think is wrong.

## Never

These have no exceptions inside a task. Only the person, asking for exactly this in their own
message, changes them.

- **Never deploy or touch anything live.** Do not run `infra/deploy.sh`, `terraform apply` or
  `destroy`, `wrangler deploy`, `wrangler secret`, or any Wrangler command with `--remote`. A
  person deploys. Local commands (`npm run dev`, `npm run db:prepare`) are fine.
- **Never move money to test something.** Do not call `transfer` from a script, a test, a
  one-off command or a "quick check". Tests stub `fetch`.
- **Never push to `main`, force-push, rewrite history or delete a branch.** Push your own
  branch. A person merges.
- **Never make a check pass by weakening it.** No skipped, deleted or loosened tests. No
  `@ts-ignore`, `@ts-expect-error`, `any`, `as unknown as` or `eslint-disable` to silence an
  error. No relaxing a zod schema, a lint rule or the CI workflow. No `--no-verify`. If a check
  fails and the honest fix is outside your task, stop and say so.
- **Never invent your way past a gap.** No fallback values, no default for a missing setting,
  no mock or fake service in source, no guessed API shape. If you do not know, say you do not
  know.
- **Never ask for a secret in chat, and never print one.** Do not show the contents of `.env`.
  Do not put a real value in any file that git tracks.
- **Never edit a committed migration** in `packages/db/drizzle`. Change the schema and run
  `npm run db:generate` to add a new one.

## Keep the change small

- Do what was asked and nothing else. No refactoring, renaming, reformatting or "while I was
  here" fixes in files the task does not need. If you notice a problem elsewhere, report it;
  do not fix it.
- Copy the pattern of the nearest working file rather than inventing a new one. Each track's
  first file to open is listed in `README.md`.
- No new frameworks, UI kits, state libraries, build tools or top-level folders.
- If the request is big, build the smallest slice that works end to end, then list what is
  left. A small thing that works beats a large thing that almost does.
- Do not rewrite these rules, `README.md` or the files in `docs/` unless that is the task.

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

## Telling your person what happened

They will read your last message, not your code. Write it for someone who does not program.

- Lead with what works now and how they can see it: the page to open, the button to press.
- List the files you changed. Every one should be inside your track's home; if one is not, say
  which and why.
- Say which of the four checks you ran and whether each passed. Never write "done", "works" or
  "passes" about something you did not run. If a check fails, say so and quote the failing
  line. A truthful "this part is not working yet" is always better than a confident wrong
  answer.
- Say what you did not do, and anything you guessed.
- Say what teammates on the other tracks need to know, if anything.
