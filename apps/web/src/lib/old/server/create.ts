/**
 * Creates a campaign from a checked builder draft: mints the ids and each person's private
 * filing code, checks every row against its contract, and writes them in one batch.
 *
 * Nobody signs in to use the builder, so this is written to be safe to leave open:
 *
 * - the campaign is created as `draft`, and drafts are on no public list;
 * - at most CREATED_PER_HOUR campaigns are created in any hour, by anyone;
 * - nothing here calls Qatom, moves money or sends email;
 * - what it answers holds no email address and no filing code.
 */
import { randomUUID } from 'node:crypto';
import type { Config } from '@tejido/config';
import {
	campaignSchema,
	generateReporterCode,
	milestoneIdSchema,
	milestoneSchema,
	partySchema,
	type Campaign,
	type Milestone,
	type Party
} from '@tejido/contracts';
import {
	countCampaignsCreatedSince,
	evidenceStoreOrigin,
	insertCampaignWithPartiesAndMilestones,
	type Database
} from '@tejido/db';
import type { CheckedDraft } from '../builder/check.ts';
import type { CreatedCampaign } from '../builder/draft.ts';

/** How many campaigns may be created in one hour, counting everyone. */
export const CREATED_PER_HOUR = 20;
const HOUR_MS = 60 * 60 * 1000;

/** "Rebuild the Library Wing!" becomes "rebuild-the-library-wing", at most `most` long. */
function slug(text: string, most: number): string {
	return text
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.slice(0, most)
		.replace(/^-+|-+$/g, '');
}

/**
 * A campaign's id is also its address. A draft is reached only by its link, so the id ends in
 * 80 random bits: nobody finds a draft by guessing from its title.
 */
function mintCampaignId(title: string): string {
	const random = randomUUID().replaceAll('-', '').slice(0, 20);
	const words = slug(title, 40);
	return words === '' ? `campaign-${random}` : `${words}-${random}`;
}

/** As entries and deposits are minted: a prefix and a random UUID. It is the invite link. */
const mintPartyId = (): string => `pty_${randomUUID()}`;

/** `m2-walls-up-to-roof-height`: what a reporter types. Unique in its campaign by its number. */
function mintMilestoneId(position: number, title: string): string {
	const words = slug(title, 48);
	return milestoneIdSchema.parse(
		words === '' ? `m${String(position)}` : `m${String(position)}-${words}`
	);
}

export type CreateOutcome =
	{ created: true; campaign: CreatedCampaign } | { created: false; reason: 'too_many' };

export async function createCampaign(
	db: Database,
	config: Pick<Config, 'OIDC_REDIRECT_URI'>,
	draft: CheckedDraft,
	now: Date = new Date()
): Promise<CreateOutcome> {
	const since = new Date(now.getTime() - HOUR_MS).toISOString();
	if ((await countCampaignsCreatedSince(db, since)) >= CREATED_PER_HOUR) {
		return { created: false, reason: 'too_many' };
	}

	const createdAt = now.toISOString();
	const campaign: Campaign = campaignSchema.parse({
		id: mintCampaignId(draft.project.title),
		...draft.project,
		status: 'draft',
		cadence: draft.cadence,
		// The Qatom catalog items do not exist yet. Nothing here creates them.
		logWorkCommodityId: null,
		milestoneHitCommodityId: null,
		fundingGoal: draft.fundingGoal,
		donationCommodityId: null,
		createdAt
	} satisfies Campaign);

	const partyIdByKey = new Map<string, string>();
	const parties: Party[] = draft.people.map((person) => {
		const id = mintPartyId();
		partyIdByKey.set(person.key, id);
		return partySchema.parse({
			id,
			campaignId: campaign.id,
			role: person.role,
			name: person.name,
			title: person.title,
			email: person.email,
			reporterCode: generateReporterCode(),
			relationship: person.relationship,
			relationshipReason: person.relationshipReason,
			// Both come from the person's own Qatom sign-in, when they accept the invitation.
			agentWalletHostname: null,
			primaryWalletHostname: null,
			createdAt
		} satisfies Party);
	});

	const partyId = (key: string): string => {
		const id = partyIdByKey.get(key);
		if (id === undefined) throw new Error('a milestone names a person who is not in the draft');
		return id;
	};
	const milestones: Milestone[] = draft.milestones.map((milestone, index) =>
		milestoneSchema.parse({
			campaignId: campaign.id,
			id: mintMilestoneId(index + 1, milestone.title),
			position: index + 1,
			title: milestone.title,
			description: milestone.description,
			kind: milestone.kind,
			ownerPartyId: partyId(milestone.ownerKey),
			confirmerPartyId: partyId(milestone.confirmerKey),
			dueDate: milestone.dueDate,
			state: 'open',
			confirmedAt: null
		} satisfies Milestone)
	);

	await insertCampaignWithPartiesAndMilestones(db, { campaign, parties, milestones });

	// Invitations are opened in the App. Its origin is the origin of the sign-in callback.
	const app = evidenceStoreOrigin(config);
	return {
		created: true,
		campaign: {
			id: campaign.id,
			title: campaign.title,
			path: `/campaigns/${campaign.id}`,
			invitations: parties.map((party) => ({
				name: party.name,
				title: party.title,
				role: party.role,
				url: `${app}/invite/${party.id}`
			}))
		}
	};
}
