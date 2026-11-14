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
