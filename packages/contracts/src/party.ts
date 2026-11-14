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
	 * Both wallets come from the party's Qatom sign-in and are null until they have signed in.
	 * Deposits are paid FROM the agent wallet. Refunds are sent TO the primary wallet. Never the reverse.
	 */
	agentWalletHostname: agentWalletHostnameSchema.nullable(),
	primaryWalletHostname: primaryWalletHostnameSchema.nullable(),
	createdAt: timestampSchema
});
export type Party = z.infer<typeof partySchema>;
