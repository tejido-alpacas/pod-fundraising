import { z } from 'zod';
import type { Campaign, CampaignStatus } from './campaign.ts';
import { amountSchema, type Amount } from './money.ts';
import { timestampSchema } from './primitives.ts';

/**
 * Funding: how much donors have given to a campaign, against its goal.
 *
 * Donations are not handled by our code. Donors pay through Qatom for the campaign's donation
 * catalog item, and we read that item's ledger afterwards with Tejido's merchant account. What
 * we keep, and what a page is given, is totals only: an amount, a count and when we last read.
 *
 * NO DONOR IS IDENTIFIED HERE. A donor's wallet address is not a receipt of ours to publish, so
 * nothing in this file has a field for one, and none must be added.
 *
 * Funding is a different fact from delivery. It is never shown with a status tone, and a
 * funded campaign has delivered nothing yet.
 *
 * Amounts are whole numbers of Qatom's smallest unit, exactly as deposits are (money.ts). The
 * scale of that unit against a live ledger is NOT YET CONFIRMED; when it is, the one constant in
 * money.ts changes and nothing here does.
 */

/**
 * The totals of one read of a campaign's donation ledger. Each read replaces the last: the
 * ledger is read whole, so these are what Qatom reported at `readAt`, not a running sum of ours.
 */
export const fundingTotalsSchema = z.object({
	/** The sum of every donation on the ledger. */
	raised: amountSchema,
	/** How many donations that sum is made of. */
	donations: z.number().int().nonnegative(),
	/** When we last read the ledger. The totals may be older than the page showing them. */
	readAt: timestampSchema
});
export type FundingTotals = z.infer<typeof fundingTotalsSchema>;

/**
 * Why a campaign's funding is not known.
 *
 * - `no_donation_item`: the campaign has no donation catalog item in Qatom yet, so there is no
 *   ledger to read.
 * - `never_read`: the item exists, but its ledger has not been read successfully yet.
 */
export const fundingUnknownReasonSchema = z.enum(['no_donation_item', 'never_read']);
export type FundingUnknownReason = z.infer<typeof fundingUnknownReasonSchema>;

/**
 * What a page is given about a campaign's funding.
 *
 * `not_known` is not zero. Show it as "not known yet", never as "0 raised": nothing has been
 * read, so we cannot say that nothing was given.
 */
export const fundingSummarySchema = z.discriminatedUnion('state', [
	z.object({
		state: z.literal('not_known'),
		reason: fundingUnknownReasonSchema,
		/** The goal, when one is set. Null when the campaign has none: no goal is ever invented. */
		goal: amountSchema.positive().nullable()
	}),
	z.object({
		state: z.literal('known'),
		/** The goal, when one is set. Null when the campaign has none: no goal is ever invented. */
		goal: amountSchema.positive().nullable(),
		raised: amountSchema,
		donations: z.number().int().nonnegative(),
		/** When these totals were last read from Qatom's ledger. */
		readAt: timestampSchema,
		/** True when a goal is set and `raised` has reached it. False when there is no goal. */
		goalMet: z.boolean()
	})
]);
export type FundingSummary = z.infer<typeof fundingSummarySchema>;

/** Whether an amount raised reaches a goal. With no goal there is nothing to meet. */
export function isGoalMet(goal: Amount | null, raised: Amount): boolean {
	return goal !== null && raised >= goal;
}

/**
 * How far along a campaign is, as a whole percentage of its goal, rounded down so that 99.9%
 * never reads as 100. It passes 100 when more than the goal was given; a bar caps it, the
 * number need not.
 */
export function fundingPercent(goal: Amount, raised: Amount): number {
	if (goal <= 0) throw new RangeError('a funding goal is more than nothing');
	return Math.floor((raised * 100) / goal);
}

/**
 * Builds the summary a page is given from what is stored: the campaign's goal and donation
 * item, and the totals of the last ledger read (null when there has been none).
 */
export function fundingSummary(
	campaign: Pick<Campaign, 'fundingGoal' | 'donationCommodityId'>,
	totals: FundingTotals | null
): FundingSummary {
	const goal = campaign.fundingGoal;
	// Totals read for an item the campaign no longer names say nothing about it now.
	if (campaign.donationCommodityId === null) {
		return { state: 'not_known', reason: 'no_donation_item', goal };
	}
	if (totals === null) return { state: 'not_known', reason: 'never_read', goal };
	return {
		state: 'known',
		goal,
		raised: totals.raised,
		donations: totals.donations,
		readAt: totals.readAt,
		goalMet: isGoalMet(goal, totals.raised)
	};
}

/**
 * The status a campaign has once its donations have been totalled. The only move is `funding`
 * to `funded`, when the goal is met. Every other status is left as it is: funding never moves
 * a campaign backwards, and never on to `reporting`, which waits for its catalog items.
 */
export function statusAfterFunding(
	status: CampaignStatus,
	goal: Amount | null,
	raised: Amount
): CampaignStatus {
	return status === 'funding' && isGoalMet(goal, raised) ? 'funded' : status;
}
