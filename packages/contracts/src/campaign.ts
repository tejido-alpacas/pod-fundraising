import { z } from 'zod';
import { shownRelationship, type Party, type PartyRelationship } from './party.ts';
import { dateSchema, emailSchema, idSchema, timestampSchema } from './primitives.ts';

/**
 * A campaign moves draft, funding, funded, reporting, delivered. `overdue` is a side state of
 * `reporting`: a missed check-in moves the campaign there until the late one arrives.
 */
export const campaignStatusSchema = z.enum([
	'draft',
	'funding',
	'funded',
	'reporting',
	'overdue',
	'delivered'
]);
export type CampaignStatus = z.infer<typeof campaignStatusSchema>;

/** How often each third party owes a work log. */
export const cadenceSchema = z.enum(['weekly', 'fortnightly']);
export type Cadence = z.infer<typeof cadenceSchema>;

/**
 * Identifies a commodity in Qatom: the `commodity_id` of a catalog item, a positive whole
 * number. A ledger is read by the commodity's hash, which the Qatom client looks up from this id.
 */
export const commodityIdSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export type CommodityId = z.infer<typeof commodityIdSchema>;

export const campaignSchema = z.object({
	id: idSchema,
	title: z.string().min(1).max(200),
	summary: z.string().max(2000),
	/** Who the campaign is for. Beneficiaries need no account and no wallet. */
	beneficiary: z.string().max(300),
	creatorName: z.string().min(1).max(200),
	creatorEmail: emailSchema,
	status: campaignStatusSchema,
	cadence: cadenceSchema,
	/**
	 * The commodity behind this campaign's "Log work" catalog item in Qatom, owned by Tejido's
	 * merchant account. Null until the item has been created. The reconciler reads this
	 * commodity's ledger.
	 */
	logWorkCommodityId: commodityIdSchema.nullable(),
	/** The same, for this campaign's "Milestone hit" catalog item. */
	milestoneHitCommodityId: commodityIdSchema.nullable(),
	createdAt: timestampSchema
});
export type Campaign = z.infer<typeof campaignSchema>;

// ---------------------------------------------------------------------------
// Milestones
// ---------------------------------------------------------------------------

/**
 * - `open`: nobody has claimed it yet.
 * - `claimed`: the party doing the work says it is done; no confirmation yet.
 * - `confirmed_independent`: the named confirmer signed it off from their own wallet. The name
 *   says who signed, not how strong the confirmation is: that comes from the confirmer's
 *   recorded relationship. See `confirmationStrength`.
 * - `confirmed_creator`: no confirmer answered in the waiting period, so the creator signed it
 *   off. Always a participant confirmation.
 */
export const milestoneStateSchema = z.enum([
	'open',
	'claimed',
	'confirmed_independent',
	'confirmed_creator'
]);
export type MilestoneState = z.infer<typeof milestoneStateSchema>;

/** Decides which claims a milestone accepts and what evidence each needs. */
export const milestoneKindSchema = z.enum([
	'construction',
	'goods_delivery',
	'funds_handover',
	'service'
]);
export type MilestoneKind = z.infer<typeof milestoneKindSchema>;

/**
 * A milestone's id is the value a reporter types as `milestone_id`, e.g. `m2-walls`.
 * It is unique within its campaign, not across campaigns: a milestone is identified by
 * `campaignId` and `id` together.
 */
export const milestoneIdSchema = z
	.string()
	.regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
		error: 'must be lower-case letters, digits and single hyphens, e.g. m2-walls'
	})
	.max(60);

export const milestoneSchema = z.object({
	campaignId: idSchema,
	id: milestoneIdSchema,
	/** Order within the campaign, starting at 1. */
	position: z.number().int().positive(),
	title: z.string().min(1).max(200),
	description: z.string().max(2000),
	kind: milestoneKindSchema,
	/** The third party who owes this milestone. */
	ownerPartyId: idSchema,
	/** The party named to sign it off. Someone who did not do the work. */
	confirmerPartyId: idSchema,
	dueDate: dateSchema,
	state: milestoneStateSchema,
	confirmedAt: timestampSchema.nullable()
});
export type Milestone = z.infer<typeof milestoneSchema>;

export function isConfirmed(milestone: Pick<Milestone, 'state'>): boolean {
	return milestone.state === 'confirmed_independent' || milestone.state === 'confirmed_creator';
}

/**
 * The strength to SHOW for a milestone's confirmation, or null when it is not confirmed.
 *
 * - `confirmed_creator`: always `participant`. The creator runs the project.
 * - `confirmed_independent`: the relationship recorded for the confirming party, and
 *   `stakeholder` when none is recorded. Never `independent` unless that was recorded.
 */
export function confirmationStrength(
	milestone: Pick<Milestone, 'state'>,
	confirmer: Pick<Party, 'relationship'> | null | undefined
): PartyRelationship | null {
	if (milestone.state === 'confirmed_creator') return 'participant';
	if (milestone.state === 'confirmed_independent') return shownRelationship(confirmer);
	return null;
}
