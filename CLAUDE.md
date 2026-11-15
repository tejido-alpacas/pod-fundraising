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
- Every task gets its own branch and its own pull request. See the next section.

## Branches, worktrees and pull requests

`main` is what gets deployed and what everyone else builds on. **Merging a pull request into
`main` releases it to the live site**: GitHub deploys every change to `main` by itself, a few
minutes after the merge (see `infra/README.md`). So the merge rules in step 5 are what protect
production. Nothing reaches `main` except through a pull request whose checks are green. GitHub does not enforce this for us (the plan
has no branch protection), so you enforce it. Your person may not know what a branch or a pull
request is; do these steps for them and explain as you go.

**1. Start from the latest `main`, in your own worktree.**

- If you are working in your person's own checkout on their computer, do not switch branches
  in it. Make a worktree: a second folder with its own branch, so other sessions and their
  running dev server are not disturbed. Use your tool's built-in worktree feature if it has
  one. Otherwise:

  ```bash
  git fetch origin main
  ```

  ```bash
  git worktree add .worktrees/track-b-invite-page -b track-b/invite-page origin/main
  ```

- If your session is already its own fresh copy of the repository (a cloud session), a new
  branch from `origin/main` is enough.
- Name the branch `track-a/...`, `track-b/...` or `track-c/...` plus two or three words, unless
  your environment assigns the name.
- A new worktree has no dependencies and no `.env`. Run `npm install` in it, and copy `.env`
  from the main checkout without printing it. Its local database starts empty and
  `npm run dev` seeds it.
- Only one `npm run dev` can run at a time: the ports are fixed. If the ports are taken, ask
  your person to stop the other one. Do not change the ports.

**2. Commit as you go, in small steps, on that branch.** Write commit messages that say what
changed in plain words.

**3. Open a pull request when the four checks pass locally.**

- Push the branch and open a pull request into `main`. Fill in every section of
  `.github/pull_request_template.md`, in words your person can read.
- One task, one pull request. Keep it small enough to describe in a few sentences.
- Give your person the link.

**4. Wait for the checks on GitHub, then report.**

- Every job in the CI run for the pull request's latest commit must be green. Passing on your
  machine does not count, and neither does an earlier commit's run.
- If a job fails, read its log, fix the cause on the same branch and push again. Never fix it
  by weakening the check (see "Never").
- If `main` has moved and the pull request conflicts, merge `origin/main` into your branch. Do
  not rebase or force-push. If the conflict is in a file outside your track, stop and ask.

**5. Merge only when all of these are true.**

- Your person asked you to merge this pull request, in their own message.
- Every CI job is green on its latest commit. If any is red, still running or missing, do not
  merge, whoever asks. Say which one and why.
- Every changed file is in your track's home, or the team agreed to the ones that are not.

Use "Squash and merge". Never merge someone else's pull request, and never push to someone
else's branch.

**6. Clean up.** After the merge, delete the branch and remove the worktree
(`git worktree remove <folder>`). Start the next task from the new `main`.

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
  `destroy`, `wrangler deploy`, `wrangler secret`, or any Wrangler command with `--remote`.
  GitHub deploys when a pull request is merged into `main`; you never do, and you never re-run
  or trigger the deploy job. Local commands (`npm run dev`, `npm run db:prepare`) are fine.
  `.claude/settings.json` denies these commands in Claude Code. A denied command is not an
  obstacle to work around: do not rephrase it, wrap it in a script, or edit that file.
- **Never move money to test something.** Do not call `transfer` from a script, a test, a
  one-off command or a "quick check". Tests stub `fetch`. The one exception is the paid story
  of the end-to-end suite (`e2e/`, see `e2e/README.md`). By the owner's decision of 15
  November 2026 it runs by itself, after a release or started by the run before it, never
  started by hand, under the cap set in `.github/workflows/e2e.yml`. It files real deposits as the two test people (a work log,
  0.10; a milestone claim, 1.00; its confirmation, 1.00), each run on a campaign it creates
  through the campaign API. It may also pay one donation, of the smallest amount on sale, on
  Qatom's checkout page as a test person, to a campaign the tests own (the owner, the same
  day: "Yes pay real donation is totally fine, make one, then remove it then refund the
  donation like the other e2e tests"). It moves money only by filing through the App and paying on that
  checkout page, as a real person does: it never calls `transfer`, never calls
  `/api/refunds`, never uses a card, and holds no secret. Only that
  workflow sets `E2E_PAID`. Never set it yourself, never run that suite from your session,
  and never add a way for a test to move money outside that paid story.
- **Never push to `main`, force-push or rewrite history.** `main` changes only by merging a
  pull request, as described above. Delete only your own branch, after it has merged.
- **Never merge a pull request whose checks are not all green**, and never merge without being
  asked.
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
- **One exception, for the end-to-end test people only** (the owner's decision, 15 November
  2026), so the automatic paid tests keep their own wallets funded. A party whose email is at
  the test inbox domain, `e2e.m.todaq.net`, gets its deposits back in the **agent** wallet
  they were paid from: a confirmed milestone's deposits at once, and any other deposit of
  theirs once it is 20 minutes old, because a test run that fails leaves its milestone
  unconfirmed (the owner, the same day: "a failed paid test run should still see if refunds
  are necessary even if it fails red"). A donation the paid tests make is undone the same way:
  a donation to a campaign the tests own (its creator's email is at the test inbox domain),
  paid from a wallet registered to a test person, is taken out of the campaign's total and
  sent back to the wallet it was paid from, out of the donation item's own twin. Each of these
  refunds is paid out of the item's own twin by
  calling the twin's own API directly, because Qatom's `POST /v4/transfer` cannot pay from an
  item's twin. The twin's hostname and key are read from Qatom with the merchant account at
  that moment, used once, and never stored or logged. It lives in `packages/qatom`, like every
  other Qatom call. Nobody else is ever refunded this way: for every other party the rule
  above stands, and nothing may widen the exception.
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
- Tests never reach the network: everything `npm test` runs stubs `fetch` and needs no
  credentials. The one exception is the end-to-end suite in `e2e/`, which signs in to the live
  site through real Qatom. It is not part of `npm test` or the four checks; GitHub runs it
  after a deploy (`.github/workflows/e2e.yml`).

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
