import { z } from 'zod';
import { milestoneIdSchema } from './campaign.ts';
import { logWorkInputSchema, milestoneHitInputSchema } from './items.ts';
import { idSchema, timestampSchema } from './primitives.ts';

/**
 * - `filed`: our endpoint saved it. Its deposit has been paid, but we have not yet matched it
 *   to Qatom's ledger.
 * - `incomplete`: saved, but something the milestone requires is missing. The reporter can add
 *   it without paying again.
 * - `verified`: matched to a ledger transaction paid from the party's registered agent wallet.
 * - `flagged`: matched to a ledger transaction paid from some other wallet. Donors are told.
 */
export const entryStatusSchema = z.enum(['filed', 'incomplete', 'verified', 'flagged']);
export type EntryStatus = z.infer<typeof entryStatusSchema>;

const entryBase = {
	id: idSchema,
	campaignId: idSchema,
	milestoneId: milestoneIdSchema,
	/** The party the reporter code resolved to. */
	partyId: idSchema,
	status: entryStatusSchema,
	/** Why the entry is incomplete or flagged, in words a donor can read. Null otherwise. */
	statusReason: z.string().max(500).nullable(),
	/**
	 * The paying address Qatom's ledger reports for this entry's deposit. Null until the
	 * reconciler has matched the entry. Verified means it equals the party's agent wallet.
	 */
	payingWallet: z.string().min(1).nullable(),
	/** Identifies the entry in the TODA twin's binder. Null until reconciled. */
	twistId: z.string().min(1).nullable(),
	/** When our check-in endpoint saved the entry. */
	filedAt: timestampSchema,
	/** The ledger's own timestamp for the deposit. Null until reconciled. */
	stampedAt: timestampSchema.nullable(),
	updatedAt: timestampSchema
};

/**
 * One filed work log or milestone hit. `item` says which catalog item was bought and so
 * which shape `inputs` has. `inputs` is kept exactly as validated at filing.
 */
export const entrySchema = z.discriminatedUnion('item', [
	z.object({ ...entryBase, item: z.literal('log_work'), inputs: logWorkInputSchema }),
	z.object({ ...entryBase, item: z.literal('milestone_hit'), inputs: milestoneHitInputSchema })
]);
export type Entry = z.infer<typeof entrySchema>;
export type LogWorkEntry = Extract<Entry, { item: 'log_work' }>;
export type MilestoneHitEntry = Extract<Entry, { item: 'milestone_hit' }>;
