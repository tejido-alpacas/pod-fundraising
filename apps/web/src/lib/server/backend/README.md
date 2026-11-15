Track C (Backend): the reconciler, deposit refunds and the cadence scheduler go here.

Everything in this folder is server-only. Reach Qatom through `event.locals.ctx.qatom.account`
and the database through `event.locals.ctx.db`.

## The timer (`worker.ts`, `reconcile-timer.ts`)

On the live site the reconciler runs by itself, once a minute. Cloudflare's own timer (the
Cron Trigger in `apps/web/wrangler.jsonc`, `triggers.crons`) calls the `scheduled` handler in
`worker.ts`, which hands the Worker's own request handler a `POST /api/reconcile` with the
shared-secret header. No network hop, and the same route a person's call goes through.

- Reconcile only. `/api/funding` and `/api/schedule` are not on the timer; adding one is one
  more call in `worker.ts`. `/api/refunds` moves money and must never be put there.
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
