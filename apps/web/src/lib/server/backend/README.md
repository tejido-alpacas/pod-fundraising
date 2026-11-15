Track C (Backend): the reconciler, deposit refunds and the cadence scheduler go here.

Everything in this folder is server-only. Reach Qatom through `event.locals.ctx.qatom.account`
and the database through `event.locals.ctx.db`.

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
- Not yet run against real Qatom. The ledger's amount unit is assumed, as in the reconciler.

## Cadence scheduler (`schedule.ts`, `POST /api/schedule`)

One pass works out what is due and overdue on every campaign that is not a draft, records a
reminder for each thing that newly fell due or became overdue, and answers with counts and the
reminders it just recorded. The rules are `whatIsDue` in `@tejido/db` (`schedule.ts`), the one
definition; every date is a calendar day in UTC.

- Nothing is sent. A reminder is a row in `reminders` and a line in the answer, with the link
  the party should open in the App (`/reminder`, or `/reminder?milestone=<id>`). A person or a
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
