# Tejido build plan

The team's build plan, converted from the original artifact so every agent works from the same
schedule. Three people, 24 hours. Companion to `docs/architecture.md`, which has the architecture,
schemas and rules.

Every surface we have to build, who builds it, and when. Twelve are needed for the demo, two make
it smoother, four are only if there is time.

> The foundation in this repository already covers part of this plan. See
> [What the foundation already did](#what-the-foundation-already-did) before starting a surface.

## Three tracks, one per person

The split follows who the surface faces, so each person owns a whole user's experience and the
hand-offs between people are few.

| Track                  | Faces                                                           | Home in this repository                                                              |
| ---------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **A** · Campaign Site  | Creators and donors                                             | `apps/web/src/routes/(campaign-site)/`, `apps/web/src/lib/campaign-site/`            |
| **B** · App            | Third parties and confirmers                                    | `apps/web/src/routes/(app)/`, `apps/web/src/lib/app/`                                |
| **C** · Tejido backend | Our server side. Talks to Qatom as it is; no Qatom code changes | `apps/web/src/routes/(backend)/`, `apps/web/src/lib/server/backend/`, `packages/db/` |

## The surfaces

- **Must**: the demo fails without it.
- **Should**: can be done by hand in the demo.
- **Stretch**: only if ahead.

### Track A · Campaign Site

| Id  | Surface           | Priority | Hours    | What                                                                                                       |
| --- | ----------------- | -------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| A1  | Campaign builder  | Must     | 2 to 6   | Third parties, a confirmer per milestone, milestones, cadence, evidence rules. Blocks launch until filled. |
| A2  | Donor timeline    | Must     | 6 to 10  | Per-campaign feed of work logs and milestones with photos, newest first.                                   |
| A3  | Proof page        | Must     | 10 to 12 | The receipt behind one entry: twistId, time, paying wallet, photo hashes, verified or flagged.             |
| A4  | Milestone status  | Must     | 12 to 14 | Progress per milestone, the confirmation strength label, and an overdue banner.                            |
| —   | Wire to real data | —        | 14 to 16 |                                                                                                            |
| A5  | Final report      | Stretch  | 16 to 18 | Closing page for a delivered campaign: every milestone and who confirmed it.                               |
| —   | Polish            | —        | 18 to 20 |                                                                                                            |

### Track B · App

| Id  | Surface                      | Priority | Hours    | What                                                                                                                                                                        |
| --- | ---------------------------- | -------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Invite and Qatom sign-in     | Must     | 2 to 6   | Onboarding: invite link, then Qatom sign-in. Saves both wallet hostnames against the party and gives the App's agent its connection to Qatom as them.                       |
| B3  | Evidence upload              | Must     | 6 to 8   | Store a photo or document, return its URL and SHA-256. A page for people and an API for agents.                                                                             |
| B2  | Agent chat shell             | Must     | 8 to 12  | The App is mostly this: a chat with an agent, signed in as the third party, that knows what is due, collects the note and photos, and calls the work-log or milestone tool. |
| B4  | Reminder message             | Should   | 12 to 14 | Email that says what is due and links straight into the chat with that milestone loaded.                                                                                    |
| —   | Seed demo: accounts, wallets | —        | 14 to 16 |                                                                                                                                                                             |
| B5  | Fix an incomplete entry      | Stretch  | 16 to 18 | Add missing evidence to an entry already stamped, without paying again.                                                                                                     |
| B6  | Guided collection            | Stretch  | 18 to 20 | Small forms inside the chat for the fields each claim needs (quantity and unit, amount spent), so the agent asks less.                                                      |

### Track C · Tejido backend

| Id  | Surface               | Priority | Hours    | What                                                                                                                                                     |
| --- | --------------------- | -------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Data model            | Must     | 2 to 4   | Tables for parties and wallets, milestones, entries and deposits. Everyone depends on this first.                                                        |
| C2  | Qatom dashboard setup | Must     | 4 to 6   | Configuration, not code: in the Qatom dashboard, create the two catalog items with their schemas, external endpoint and secret header, and feature them. |
| C3  | Check-in endpoint     | Must     | 6 to 10  | Verify the secret, resolve the reporter code, apply the rules, save the entry, answer with what is owed.                                                 |
| C4  | Reconciler            | Must     | 10 to 13 | Poll the ledgers, attach the twistId, check the paying wallet is the registered one.                                                                     |
| C5  | Deposit refund        | Must     | 13 to 16 | On confirmation, total the stamps paid on the milestone and send them back. Once only.                                                                   |
| C6  | Cadence scheduler     | Should   | 16 to 18 | Work out what is due, trigger reminders, mark overdue.                                                                                                   |
| C7  | Item provisioning     | Stretch  | 18 to 20 | Our code calls Qatom's existing API to create both items when a campaign reaches its goal, replacing the dashboard step.                                 |

## The 24 hours

| Hours    | Everyone                                               |
| -------- | ------------------------------------------------------ |
| 0 to 2   | Agree contracts. Run staging checks.                   |
| 2 to 20  | Build, one lane per track (hours in the tables above). |
| 20 to 22 | Rehearse end to end, fix what breaks.                  |
| 22 to 24 | Freeze. Record a backup run.                           |

**Checkpoints, where the three tracks have to meet**

| Hour | Checkpoint             | What must be true                                                                                                                                            |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2    | Contracts frozen       | Everyone codes against the same fixtures from here. No shape changes without telling the other two.                                                          |
| 10   | First stamped work log | A real 0.10 work log lands in our database and shows on the donor timeline. Filed from Claude as a stand-in agent; our own chat shell takes over at hour 12. |
| 16   | Confirm and refund     | A milestone hit is confirmed from a second wallet and the deposits go back.                                                                                  |
| 20   | Feature freeze         | Nothing new. Rehearse the demo twice, fix only what breaks it, record a backup run.                                                                          |

## Hours 0 to 2: what to agree before anyone builds

**Contracts.** All of these now exist in `packages/contracts`. Agreeing them means reading them
and raising anything that is wrong, not writing them.

- **The two item schemas**: Log work and Milestone hit.
- **The entry record**: id, campaign, milestone, party, which item, the inputs, status (`filed`,
  `incomplete`, `verified`, `flagged`), paying wallet, twistId.
- **Milestone states**: `open`, `claimed`, `confirmed_independent`, `confirmed_creator`.
- **Evidence upload answer**: `{ url, sha256 }`.
- **Reporter code**: its format (`rc_` and 20 characters), and that it maps to one party on one
  campaign.
- **A fixtures file** with one campaign, three parties, three milestones and five entries. Tracks
  A and B build against it until hour 10.

**Staging checks, while the others set up.** If any of these fail, the plan changes. Find out in
hour one, not hour twelve.

- A new user signing in with Qatom gets both wallet hostnames in the claims.
- One Qatom sign-in at onboarding can give both those claims and a token our agent can use on the
  MCP server. If not, onboarding needs two consent steps.
- A 0.10 and a 1.00 purchase settle and show in the ledger with a twistId.
- A list input (`photos`) reaches our endpoint intact.
- Whether our endpoint receives the transaction id.
- Which wallet refunds are paid from, and that it has a float.
- Our account has a managed MCP server, and an agent can connect to it.
- The unit of the ledger's `amount` and of a transfer's `amount` (see `README.md`).

## The App is a shell around an agent signed in as the third party

The App needs little UI of its own: onboarding, a chat, and an upload. The agent does the
collecting and the filing, acting as the third party.

**Onboarding, once (B1)**

- The third party follows their invite link and signs in with Qatom.
- That sign-in ties their wallets to the campaign and gives the App's agent its connection to our
  Qatom MCP server, as them.
- They fund their agent wallet and set their auto-approve limit to 1.00 or more, so filing does
  not prompt each time.

**Every time after (B2)**

- Our server runs the model and connects to our Qatom MCP server with the third party's sign-in,
  the way Qatom's dashboard assistant does.
- The agent sees the two campaign tools, collects the note and photos, and calls the right one.
- The stamp is paid from the third party's agent wallet. That is the wallet the reconciler matches.

Confirmers onboard and file the same way. What to build for B2: a model loop and an MCP client
that carries the user's sign-in. Qatom's dashboard has a working example of both.

## If we fall behind, cut in this order

1. **All stretch surfaces** (A5, B5, B6, C7). Create the catalog items by hand in the dashboard.
2. **C6 Cadence scheduler.** Mark one work log overdue by hand for the demo.
3. **B4 Reminder.** Paste the instructions to the contractor's agent ourselves.
4. **C5 Deposit refund**, down to a button that shows the total owed and fires one transfer.
5. **A3 Proof page**, folded into an expandable row on the timeline.

Never cut: B1 (the wallet link), C3 (the check-in endpoint), A2 (the donor timeline). Those three
are the product.

## What the foundation already did

So nobody rebuilds it. Hours are estimates made before the code existed; adjust them.

| Surface | State in the repository                                                                                                                                 | What is left                                                                            |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| C1      | Done. Tables, migration, seed and query helpers in `packages/db`, checked against the contracts at typecheck.                                           | Extend as the features need.                                                            |
| A2      | A working slice. The timeline reads the seeded database.                                                                                                | Photos, design, real-time behaviour.                                                    |
| C3      | The endpoint runs: secret header, contract validation, reporter code and milestone lookup, saves the entry and its deposit.                             | The milestone rules, `incomplete`, advancing milestone state. Marked `TODO(Track C)`.   |
| B1      | The sign-in route and callback run the real OIDC flow and store both wallets on the party when the email matches the invite.                            | The invite page, and keeping the person's tokens for the agent. Marked `TODO(Track B)`. |
| B3      | `POST /api/evidence` stores a file and returns `{ url, sha256 }`; `GET /evidence/{file}` serves it.                                                     | The upload page, and requiring a signed-in party.                                       |
| C4, C5  | Not built. `packages/qatom` has the account token, `listCommodityTransactions()` and `transfer()` ready, reachable as `event.locals.ctx.qatom.account`. | The reconciler and the refund job.                                                      |
| C2      | Not done. `itemInputJsonSchema()` in `@tejido/contracts` generates the schema to paste; `README.md` lists the endpoint and header to configure.         | Creating the items in the dashboard and storing their commodity hashes on the campaign. |
| Others  | Placeholder pages, listed on the index page at `/`.                                                                                                     | Everything.                                                                             |
