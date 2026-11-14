Track C (Backend): the reconciler, deposit refunds and the cadence scheduler go here.

Everything in this folder is server-only. Reach Qatom through `event.locals.ctx.qatom.account`
and the database through `event.locals.ctx.db`.
