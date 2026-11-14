import { z } from 'zod';
import {
	agentWalletHostnameSchema,
	emailSchema,
	idSchema,
	primaryWalletHostnameSchema,
	reporterCodeSchema,
	timestampSchema
} from './primitives.ts';

/**
 * - `third_party`: a contractor, supplier or service provider. Logs work and claims milestones.
 * - `confirmer`: someone independent of the work, named per milestone, who signs it off.
 */
export const partyRoleSchema = z.enum(['third_party', 'confirmer']);
export type PartyRole = z.infer<typeof partyRoleSchema>;

/**
 * How a party relates to the project. It describes a relationship and is never a score.
 *
 * - `participant`: does the work, is paid by the project, or runs it.
 * - `stakeholder`: benefits from the project, or represents those who do.
 * - `independent`: has no stake in the project.
 *
 * Someone who benefits is never `independent`.
 */
export const partyRelationshipSchema = z.enum(['participant', 'stakeholder', 'independent']);
export type PartyRelationship = z.infer<typeof partyRelationshipSchema>;

/**
 * A person or organisation invited to one campaign. Someone invited to two campaigns is two
 * parties, each with its own reporter code.
 */
export const partySchema = z.object({
	id: idSchema,
	campaignId: idSchema,
	role: partyRoleSchema,
	name: z.string().min(1).max(200),
	/** What they are on this campaign, for display: "Contractor", "Head teacher". */
	title: z.string().max(200),
	/** The address the invite was sent to. Only a Qatom sign-in with this email may claim the party. */
	email: emailSchema,
	reporterCode: reporterCodeSchema,
	/**
	 * How this party relates to the project, as the organiser recorded it. Null when nobody has
	 * recorded it. Never read null as `independent`: show it with `shownRelationship`.
	 */
	relationship: partyRelationshipSchema.nullable(),
	/**
	 * The organiser's reason for `relationship`, in a sentence or two: "Employed by the parish
	 * council. Not paid by the project." Null when none was given.
	 */
	relationshipReason: z.string().min(1).max(300).nullable(),
	/**
	 * Both wallets come from the party's Qatom sign-in and are null until they have signed in.
	 * Deposits are paid FROM the agent wallet. Refunds are sent TO the primary wallet. Never the reverse.
	 */
	agentWalletHostname: agentWalletHostnameSchema.nullable(),
	primaryWalletHostname: primaryWalletHostnameSchema.nullable(),
	createdAt: timestampSchema
});
export type Party = z.infer<typeof partySchema>;

/**
 * The relationship to SHOW for a party: the recorded one, and `stakeholder` when none is
 * recorded (or the party is not on record). Never `independent` unless that was recorded.
 */
export function shownRelationship(
	party: Pick<Party, 'relationship'> | null | undefined
): PartyRelationship {
	return party?.relationship ?? 'stakeholder';
}
