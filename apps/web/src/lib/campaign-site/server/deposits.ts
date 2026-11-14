/**
 * What the Campaign Site shows of a deposit: how much, and which of the three states it is in
 * (Deposit held, Deposit refunded, Refund outstanding). The state is worked out once, in
 * `listDepositStatuses` (@tejido/db) by the rule in @tejido/contracts; pages show it and never
 * work it out again.
 */
import {
	REFUND_OUTSTANDING_MEANING,
	type DepositStatus,
	type DepositTotals
} from '@tejido/contracts';

/** One deposit as a donor may see it. Built field by field: no party or wallet is copied. */
export function depositView(status: DepositStatus) {
	return {
		entryId: status.deposit.entryId,
		/** In the unit of every amount in our records. Show it with `formatAmount`. */
		amount: status.deposit.amount,
		/** `held`, `refunded` or `refund_outstanding`. */
		state: status.state,
		/** "Deposit held", "Deposit refunded" or "Refund outstanding". */
		label: status.label,
		/** When the deposit was sent back. Set only when the state is `refunded`. */
		refundedAt: status.deposit.refundedAt,
		/** Why the refund is outstanding. Null unless the state is `refund_outstanding`. */
		outstandingReason: status.outstandingReason,
		/** That reason as a sentence a donor can read. Null with it. */
		outstandingMeaning:
			status.outstandingReason === null
				? null
				: REFUND_OUTSTANDING_MEANING[status.outstandingReason]
	};
}
export type DepositView = ReturnType<typeof depositView>;

/**
 * A milestone's or a campaign's deposits added up. `held`, `refunded` and `outstanding` add up
 * to `paid`. `returned` is the older name for `refunded` and always equals it.
 */
export function depositTotalsView(totals: DepositTotals) {
	return { ...totals, returned: totals.refunded };
}
