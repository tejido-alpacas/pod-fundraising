Track C (Backend): the reconciler, deposit refunds and the cadence scheduler go here.

Everything in this folder is server-only. Reach Qatom through `event.locals.ctx.qatom.account`
and the database through `event.locals.ctx.db`.

## The timer (`worker.ts`, `reconcile-timer.ts`)

On the live site the reconciler runs by itself, once a minute. Cloudflare's own timer (the
Cron Trigger in `apps/web/wrangler.jsonc`, `triggers.crons`) calls the `scheduled` handler in
`worker.ts`, which hands the Worker's own request handler a `POST /api/reconcile` with the
shared-secret header. No network hop, and the same route a person's call goes through.

- Reconcile, and then two more things. `/api/funding` and `/api/schedule` are not on the timer;
  adding one is one more call in `worker.ts`. `/api/refunds` moves money and must never be put
  there: the product's refunds go to primary wallets and only when a person asks.
- The one more thing is for the end-to-end test accounts only (`CLAUDE.md`, "Qatom": the one
  exception, the owner's decision of 15 November 2026). After a reconcile pass that worked, the
  timer asks for `POST /api/test-account-refunds`. A party whose email is at the test inbox
  domain gets their deposits on a confirmed milestone back in the agent wallet they were paid
  from, out of the twin the item is sold from, so the automatic paid tests keep themselves
  funded. Nobody else is refunded that way. The rules are in `test-account-refunds.ts`; the
  Qatom calls are in `packages/qatom/src/account/item-twin-refund.ts`. To turn it off, remove
  the `refundTestAccountsOnTimer` call in `worker.ts`. A pass that had something to consider
  writes one line to the Worker's logs, such as `Test-account refunds: 0 sent, 3 skipped
(item_twin_balance_too_low 3), a person needs to look: no.` Counts and reason names only.
- Last, the timer cleans up after the automatic tests: `POST /api/test-campaign-cleanup`
  **deletes** the campaigns the paid end-to-end tests created and are finished with (the
  owner, 15 November 2026). See "Test-campaign cleanup" below. To turn it off, remove the
  `cleanUpTestCampaignsOnTimer` call in `worker.ts`.
- `worker.ts` is the Worker's entry (`main` in `wrangler.jsonc`). SvelteKit's adapter has no
  option for a timer, so the entry is the Worker the build generates plus the handler. The
  build writes the generated Worker to the path in `apps/web/wrangler.build.jsonc`.
- Seeing it work: in the Cloudflare dashboard, the `tejido-web` Worker's Logs show, each
  minute, `Reconcile on the timer: POST /api/reconcile answered 200.` A failed run shows
  `Reconcile on the timer failed: ...` with the status only, and the timer event is marked
  failed. Page requests are separate events and keep working.
- Turning it off: change `"crons": ["* * * * *"]` to `"crons": []` in `wrangler.jsonc` and
  merge. Deleting the line leaves the timer running.
- Trying it locally: `npm run build`, then in `apps/web` run `npm start -- --test-scheduled`
  and open `http://localhost:5173/__scheduled`. `npm run dev` has no timer.
- Two passes can overlap if one takes longer than a minute. A stamped entry is never looked
  at again, but overlapping passes have not been tried against real Qatom.

## Test-campaign cleanup (`test-campaign-cleanup.ts`, `POST /api/test-campaign-cleanup`)

**This deletes data, on the timer, with nobody watching.** Every paid run of the end-to-end
tests creates a campaign of its own; this removes them. The rule is the function `decide` in
`test-campaign-cleanup.ts`, the one place. A campaign is deleted only when all of these hold:

- **The tests own it.** Its creator's email, and the email of every person on it, is at the
  test inbox domain (`isEndToEndTestEmail` in `@tejido/qatom/account`). One real person on a
  campaign and it is never touched.
- **It is not the fixed test campaign** (`E2E_CAMPAIGN_ID`, `e2e-smoke`). That one is never
  listed, is refused by the rule, and the delete itself throws on its id.
- **It is at least 2 hours old** (`MIN_AGE_MS`).
- **Its money is finished**: no deposit waits for a refund, no refund is `started` or
  `unknown`, and it has no donation. Otherwise it is left alone and counted with a reason
  name. At 24 hours (`FORCE_AGE_MS`) it is deleted anyway and what was left is counted.

At most 5 are deleted in a pass (`PASS_LIMIT`), oldest first.

- What goes: every row of the campaign in every table (`CAMPAIGN_OWNED_TABLES` in
  `packages/db/src/test-campaigns.ts`), in one `db.batch`, all or nothing. If anything
  unexpected still points at the campaign the database refuses the batch and the campaign is
  left whole (`could_not_delete`).
- **A new table that points at a campaign** must be added to `CAMPAIGN_OWNED_TABLES`.
  `packages/db/src/test-campaigns.test.ts` walks the schema's foreign keys and fails until it is.
- **No stored evidence file is deleted.** This Worker has no binding to the evidence store;
  only the App has. A file's row in `evidence_files` goes with the campaign when no other
  entry names the file, and its bytes stay in the store (counted in the log line). When
  another campaign's entry still names the file (the tests upload the same small picture every
  run), the row is kept and handed to the same test person on that campaign.
- The route takes no body: a caller cannot name what is deleted. It needs the
  `X-Tejido-Checkin-Secret` header. It calls nothing in Qatom and moves no money.
- A pass that had something to consider writes one line, such as `Test-campaign cleanup: 2
deleted, 0 of them with money not finished (0 deposits not refunded, 0 donations not undone),
1 left (deposit_not_refunded 1), evidence files left in the store: 2, a person needs to look:
no.` Counts and reason names only.

## Reconciler (`reconciler.ts`, `POST /api/reconcile`)

One pass finds, for each saved entry that has no receipt yet, the Qatom transaction that paid
its deposit, and records it on the entry. Paid from the agent wallet registered for the
entry's party: `verified`. Paid from any other wallet: `flagged`. The rules are in the comment
at the top of `reconciler.ts`.

- **Every campaign shares the same two catalog items**, so one ledger holds the payments of
  every campaign. Each ledger is read once in a pass, and the waiting entries of every campaign
  that names it are matched together. An entry is given a transaction only when exactly one
  transaction could be its, and that transaction could be no other entry's, on any campaign.
- A receipt on the wrong entry is worse than a missing one. When it is not exactly one each
  way (two filings a few minutes apart by one person, on one campaign or on two), nothing is
  recorded and the entries are counted as `ambiguous`. They stay at "Receipt pending".
- Every campaign is read. One that stores a commodity id of its own for an item
  (`logWorkCommodityId`, `milestoneHitCommodityId`) is read under that id. One that stores none,
  which is every campaign made with the builder, is read under the two shared items
  (`SHARED_ITEM_COMMODITY_ID` in `reconciler.ts`: the owner's decision, 15 November). It is
  still counted in `campaignsWithoutItems`, as information; it is not skipped.
- The answer counts: `campaigns` (every campaign), `ledgersRead` (a shared ledger counts
  once), `matched` (`verified` + `flagged` + `stampedIncomplete`), and `unmatched` (still
  waiting, including `ambiguous` and `waitingForWallet`). `ledgerErrors` has one line for each
  ledger Qatom did not give, with the commodity id and the campaigns whose entries wait on it.
- It only reads from Qatom, with the merchant account. It never transfers. A stamped entry is
  never looked at again, so running the pass twice changes nothing.
- `POST /api/reconcile` runs one pass and needs the `X-Tejido-Checkin-Secret` header. On the
  live site the timer calls it once a minute (see "The timer" above); a person who holds the
  secret can still call it.

## Item provisioning (`provisioning.ts`, `POST /api/provisioning`)

Not to be used while campaigns share the two items: it creates a new pair of items for one
campaign, which the owner's decision of 15 November makes unwanted.

## Donations (`POST /api/donations/<amount>`)

Campaigns share Tejido's donation items: one catalog item per amount on the merchant account,
not one per campaign. After a donor pays, Qatom calls `POST /api/donations/<amount>` and we
write one row in `donations`. Pages read the sum with `getFundingSummary` from `@tejido/db`.

- Which campaign comes from the body: the item's one declared input, `campaign_id`
  (`donationInputJsonSchema()` in `@tejido/contracts` is the schema to enter on the item).
- How much comes from the address, never from the body: the 5 item's external endpoint is
  `/api/donations/5`. A whole number of USD-TDN, at least 1.
- It needs the `X-Tejido-Checkin-Secret` header, like the check-in endpoint.
- One payment is counted once. Qatom sends `X-Qatom-Transaction-Id` with a dispatch; only its
  SHA-256 is kept, to recognise a repeat. A call without that header is still saved, and
  cannot be recognised if repeated.
- No donor's name, email, wallet or transaction id is stored.
- A campaign in `funding` with a `fundingGoal` moves to `funded` in the write that brings its
  donations to the goal. Nothing else is triggered, and no status moves backwards.
- It calls nothing in Qatom and moves no money. Not yet called by real Qatom.
- A campaign with recorded donations is summed from them. One with none still reads the
  totals of the ledger pass below, which no campaign uses now that the items are shared.

### Starting a donation (`donation-items.ts`)

The Give page (`/give/<campaign>`, Track A) offers amounts and sends the donor to Qatom's
checkout page. Nothing names the donation items in our configuration or database:
`listDonationOptions` asks Qatom for the merchant account's own items and keeps those that are
on sale, whose external endpoint is this site's `/api/donations/<amount>` over https, and whose
price equals that amount. This site's origin is the origin of `WEB_OIDC_REDIRECT_URI`.

- `startDonation` looks the items up again, then asks Qatom for a checkout link for the chosen
  amount with `campaign_id` as the item's input. A link is for one purchase: one is made per
  click and none is stored.
- Making a link moves no money and records nothing. The donation is recorded when Qatom calls
  the endpoint above.
- Both calls use the merchant account. Not yet run against real Qatom.

## Funding (`funding.ts`, `POST /api/funding`)

Donors give through Qatom, by paying for a campaign's donation catalog item. `refreshFunding`
reads that item's ledger with the merchant account and stores totals only (amount raised, number
of donations, when read) in `campaign_funding`. Pages read those totals with `getFundingSummary`
from `@tejido/db`; they never call Qatom. No donor's wallet or transaction id is stored.

- It only reads. It never transfers, and creates nothing in Qatom.
- A campaign is read once its `donationCommodityId` is set. Until then its funding is "not known".
- A campaign in `funding` with a `fundingGoal` moves to `funded` in the write that stores a
  total at or above the goal. Nothing else is triggered, and no status moves backwards.
- If a ledger cannot be read or totalled, nothing is stored for that campaign and the answer
  says why. What was stored before stays.
- `POST /api/funding` runs one pass. It needs the `X-Tejido-Checkin-Secret` header, like
  `POST /api/reconcile`. Nothing calls it on a schedule yet.
- Not yet run against real Qatom. Qatom reports amounts in decimal USD-TDN; `@tejido/qatom`
  converts them to our thousandths, so nothing here scales an amount.

## Cadence scheduler (`schedule.ts`, `POST /api/schedule`)

One pass works out what is due and overdue on every campaign that is not a draft, records a
reminder for each thing that newly fell due or became overdue, and answers with counts and the
reminders it just recorded. The rules are `whatIsDue` in `@tejido/db` (`schedule.ts`), the one
definition; every date is a calendar day in UTC.

- Nothing is sent. A reminder is a row in `reminders` and a line in the answer, with the link
  the party should open in the App: `/reminder?party=<party id>` for a work log, and
  `/reminder?milestone=<milestone id>&party=<party id>` for a milestone. A person or a
  later mailer acts on it.
- A reminder is recorded once: one `due` and one `overdue` per party for each milestone and
  each work-log period. Running the pass again records nothing new.
- Milestones: an open one is its owner's to claim, raised one reporting period before its due
  date; a claimed one is its confirmer's to confirm, raised at once. Either is overdue from
  the day after the due date, counted as the pages count it.
- Work logs: one per period from each party with an open construction or service milestone,
  while the campaign is `reporting` or `overdue`. Periods are counted from the UTC day the
  first pass saw the campaign with work under way (`work_log_schedules`), because nothing else
  records when reporting began.
- It moves no campaign status, calls nothing in Qatom and moves no money. The answer carries
  no email address, filing code or wallet, and nothing is logged.
- `POST /api/schedule` needs the `X-Tejido-Checkin-Secret` header, like `POST /api/reconcile`.
  Nothing calls it on a schedule yet: a cron trigger needs a change to `apps/web/wrangler.jsonc`.

## Reminder email (`reminder-email.ts`)

`reminderEmail` writes one of the scheduler's reminders as a subject, an HTML body and a
plain-text body, in the first site's look. It is a template only: nothing sends it, and it
does not look up who it is for. A mailer added later gives it a reminder from
`POST /api/schedule`, the campaign's title and (for a milestone) the milestone's title, and
hands the three strings to whatever sends mail.

- Built for email programs: tables for layout, every style on its element, no scripts and no
  pictures. The colours and fonts are copied from `packages/ui/src/first-site.css`; a change
  there needs the same change in this file.
- It carries the link to follow, the due date and the filing deposit. No email address, filing
  code or wallet. Titles and names are escaped.
- Sending needs an email service, which this project does not have: a Cloudflare binding and
  a verified sending address, both the owner's to add.
