import { z } from 'zod';
import { milestoneIdSchema, type MilestoneState } from './campaign.ts';
import type { EntryStatus } from './entry.ts';
import { amountSchema, type Amount } from './money.ts';
import { idSchema, timestampSchema, type Timestamp } from './primitives.ts';

/**
 * The deposit paid with one entry. Every entry has exactly one.
 *
 * The filer paid it from their agent wallet when they bought the catalog item. When the
 * entry's milestone is confirmed it goes back, to the filer's primary wallet.
 */
export const depositSchema = z.object({
	id: idSchema,
	/** The entry this deposit was paid on. */
	entryId: idSchema,
	amount: amountSchema,
	/** When the refund was sent. Null while the deposit is still held. */
	refundedAt: timestampSchema.nullable()
});
export type Deposit = z.infer<typeof depositSchema>;

export function isRefunded(deposit: Pick<Deposit, 'refundedAt'>): boolean {
	return deposit.refundedAt !== null;
}

// ---------------------------------------------------------------------------
// The state of a deposit
// ---------------------------------------------------------------------------

/**
 * Where a deposit stands, as donors and filers are told. Exactly three values.
 *
 * - `held`: the entry's milestone is not confirmed yet, so the deposit stays where it is.
 * - `refunded`: the deposit was sent back to the filer and Qatom accepted the transfer. This
 *   is the only state that says the money has gone back, and it is only ever read from
 *   `refundedAt`, which is written in the same step that records the transfer as sent.
 * - `refund_outstanding`: the deposit is not known to be back with its filer although the
 *   milestone is confirmed, or although a refund of it was begun. `RefundOutstandingReason`
 *   says which case it is.
 *
 * There is no fourth "not refundable" state, because no rule in the code gives a deposit up
 * for good: a deposit on a flagged entry is parked until a person decides, not forfeited. It
 * is `refund_outstanding` with the reason `entry_flagged`.
 */
export const depositStateSchema = z.enum(['held', 'refunded', 'refund_outstanding']);
export type DepositState = z.infer<typeof depositStateSchema>;

/**
 * The label for each state. Always says "deposit" or "refund": the money is the filer's own,
 * never a donation and never a payment for the work.
 */
export const DEPOSIT_STATE_LABEL: Record<DepositState, string> = {
	held: 'Deposit held',
	refunded: 'Deposit refunded',
	refund_outstanding: 'Refund outstanding'
};

/**
 * Where one refund transfer stands.
 *
 * - `started`: the deposits are claimed and the transfer is about to be, or is being, sent.
 *   A row left here means the server stopped part-way. Treat it like `unknown`.
 * - `sent`: Qatom accepted the transfer. The deposits carry `refundedAt`.
 * - `failed`: Qatom refused the transfer and nothing moved. The deposits were released and
 *   may be refunded by a later request.
 * - `unknown`: no usable answer came back (a timeout, a dropped connection, a server error).
 *   The money may or may not have moved. It is never sent again by code: a person checks the
 *   wallet and settles the row by hand.
 */
export const refundStatusSchema = z.enum(['started', 'sent', 'failed', 'unknown']);
export type RefundStatus = z.infer<typeof refundStatusSchema>;

/**
 * Why a refund is outstanding. The first that applies, in this order, is the one given.
 *
 * - `outcome_unknown`: a transfer of this deposit was sent and no usable answer came back. It
 *   may already be with the filer. Code never sends it again; a person checks the wallet.
 * - `in_progress`: a refund has claimed this deposit and its outcome is not recorded. It is
 *   being sent right now, or the server stopped part-way. Not sent again by code.
 * - `entry_flagged`: the entry was not paid from the filer's registered wallet. Code does not
 *   refund it; a person must decide. Do not promise this refund.
 * - `entry_not_verified`: the entry has not been matched to its payment in Qatom's ledger
 *   yet. The refund waits for that.
 * - `no_primary_wallet`: the filer has not signed in with Qatom, so there is no primary wallet
 *   to send to. (An agent wallet is never used instead.)
 * - `refused`: the last refund of this deposit was refused by Qatom and nothing moved. It can
 *   be asked again; nothing asks again by itself.
 * - `not_attempted`: the milestone is confirmed and no refund of this deposit has been begun.
 */
export const refundOutstandingReasonSchema = z.enum([
	'outcome_unknown',
	'in_progress',
	'entry_flagged',
	'entry_not_verified',
	'no_primary_wallet',
	'refused',
	'not_attempted'
]);
export type RefundOutstandingReason = z.infer<typeof refundOutstandingReasonSchema>;

/** One sentence a donor or filer can read for each reason a refund is outstanding. */
export const REFUND_OUTSTANDING_MEANING: Record<RefundOutstandingReason, string> = {
	outcome_unknown:
		'A refund of this deposit was sent, but no answer came back, so we do not know whether it arrived. A person has to check. It will not be sent a second time.',
	in_progress:
		'A refund of this deposit was started and we have no record yet that it went through.',
	entry_flagged:
		'This deposit was not paid from the wallet registered for its filer. It is not sent back until a person has looked at it.',
	entry_not_verified:
		'The milestone is confirmed, but a deposit is only sent back once its entry has been matched to the payment ledger.',
	no_primary_wallet:
		'The milestone is confirmed, but the filer has not signed in with Qatom, so there is no wallet to send the deposit back to.',
	refused:
		'A refund of this deposit was tried and refused, and nothing moved. It has not been tried again yet.',
	not_attempted: 'The milestone is confirmed and the refund of this deposit has not been sent yet.'
};

/** What `deriveDepositState` reads. All of it is recorded; none of it is asked of Qatom. */
export interface DepositStateInput {
	deposit: Pick<Deposit, 'refundedAt'>;
	/** The milestone of the deposit's entry. */
	milestone: { state: MilestoneState };
	/** The deposit's entry. */
	entry: { status: EntryStatus; twistId: string | null };
	/** Whether the party who filed the entry has a primary wallet on record. */
	filerHasPrimaryWallet: boolean;
	/** Every refund that has ever covered this deposit, in any order. */
	refunds: readonly { status: RefundStatus; startedAt: Timestamp }[];
}

export interface DerivedDepositState {
	state: DepositState;
	/** Set when, and only when, the state is `refund_outstanding`. */
	outstandingReason: RefundOutstandingReason | null;
}

/**
 * Works out a deposit's state from what is recorded. Pure: same records, same answer.
 *
 * Nothing here calls a deposit refunded unless `refundedAt` is set. A refund that is `sent`
 * on a deposit without `refundedAt` should not exist (they are written together); if it ever
 * does, the records disagree and the deposit is outstanding with `outcome_unknown`.
 *
 * The reasons follow the rules of the refund job (apps/web, lib/server/backend/refunds.ts).
 * If those rules change, this must change with them.
 */
export function deriveDepositState(input: DepositStateInput): DerivedDepositState {
	const { deposit, milestone, entry, filerHasPrimaryWallet, refunds } = input;
	const outstanding = (outstandingReason: RefundOutstandingReason): DerivedDepositState => ({
		state: 'refund_outstanding',
		outstandingReason
	});

	if (deposit.refundedAt !== null) return { state: 'refunded', outstandingReason: null };

	// A refund that still holds the deposit: money may have moved, whatever else is recorded.
	const holding = refunds.filter(({ status }) => status !== 'failed');
	if (holding.some(({ status }) => status === 'unknown' || status === 'sent')) {
		return outstanding('outcome_unknown');
	}
	if (holding.length > 0) return outstanding('in_progress');

	if (milestone.state !== 'confirmed_independent' && milestone.state !== 'confirmed_creator') {
		return { state: 'held', outstandingReason: null };
	}

	if (entry.status === 'flagged') return outstanding('entry_flagged');
	if (entry.twistId === null || entry.status === 'filed') return outstanding('entry_not_verified');
	if (!filerHasPrimaryWallet) return outstanding('no_primary_wallet');
	// Only refused refunds are left, if any.
	return outstanding(refunds.length > 0 ? 'refused' : 'not_attempted');
}

/** A deposit together with its state, as `@tejido/db` reads it for pages. */
export const depositStatusSchema = z.object({
	deposit: depositSchema,
	campaignId: idSchema,
	milestoneId: milestoneIdSchema,
	/** The party who filed the entry and paid the deposit. */
	partyId: idSchema,
	state: depositStateSchema,
	/** `DEPOSIT_STATE_LABEL[state]`, so a page need not look it up. */
	label: z.string(),
	outstandingReason: refundOutstandingReasonSchema.nullable(),
	/** How many refunds have ever covered this deposit, whatever became of them. */
	refundAttempts: z.number().int().nonnegative(),
	/** When the latest of them was started, and where it stands. Null when there were none. */
	lastRefundAttempt: z.object({ status: refundStatusSchema, startedAt: timestampSchema }).nullable()
});
export type DepositStatus = z.infer<typeof depositStatusSchema>;

/**
 * Deposit amounts added up by state, in the same unit as `Deposit.amount` (see money.ts: the
 * scale of that unit is not yet confirmed against a live ledger). The three always add up to
 * `paid`.
 */
export interface DepositTotals {
	paid: Amount;
	held: Amount;
	refunded: Amount;
	outstanding: Amount;
}

export function totalDeposits(
	statuses: readonly { deposit: Pick<Deposit, 'amount'>; state: DepositState }[]
): DepositTotals {
	const totals: DepositTotals = { paid: 0, held: 0, refunded: 0, outstanding: 0 };
	for (const { deposit, state } of statuses) {
		totals.paid += deposit.amount;
		if (state === 'held') totals.held += deposit.amount;
		else if (state === 'refunded') totals.refunded += deposit.amount;
		else totals.outstanding += deposit.amount;
	}
	return totals;
}

/** Puts a deposit and its derived state together, with the label. */
export function describeDeposit(
	deposit: Deposit,
	where: { campaignId: string; milestoneId: string; partyId: string },
	input: Omit<DepositStateInput, 'deposit'>
): DepositStatus {
	const derived = deriveDepositState({ ...input, deposit });
	const last = input.refunds.reduce<DepositStatus['lastRefundAttempt']>(
		(latest, { status, startedAt }) =>
			latest === null || startedAt >= latest.startedAt ? { status, startedAt } : latest,
		null
	);
	return {
		deposit,
		...where,
		...derived,
		label: DEPOSIT_STATE_LABEL[derived.state],
		refundAttempts: input.refunds.length,
		lastRefundAttempt: last
	};
}
