import { error } from '@sveltejs/kit';
import { shownRelationship } from '@tejido/contracts';
import { getCampaign, getParty, listMilestones } from '@tejido/db';
import type { PageServerLoad } from './$types';

/** `site@example.org` becomes `s•••@example.org`: enough to recognise, not enough to copy. */
function emailHint(email: string): string {
	const at = email.lastIndexOf('@');
	return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

// The invite page (B1): who is invited, to which campaign, in which role, for which milestones.
export const load: PageServerLoad = async ({ params, locals }) => {
	const { db } = locals.ctx;

	const party = await getParty(db, params.partyId);
	if (!party) {
		error(
			404,
			'We do not recognise this invite. Check that you opened the whole link from your invitation, or ask the campaign creator to send it again.'
		);
	}
	const campaign = await getCampaign(db, party.campaignId);
	if (!campaign) error(404, 'The campaign this invite belongs to no longer exists.');
	const milestones = await listMilestones(db, campaign.id);

	return {
		// Anyone holding the link can open this page, so it gets no reporter code, no wallet
		// and no full email address.
		party: {
			id: party.id,
			name: party.name,
			title: party.title,
			role: party.role,
			emailHint: emailHint(party.email),
			// How donors are shown a confirmer. An unrecorded relationship is shown as
			// stakeholder, never as independent. Someone who does the work is not shown this way.
			shownAs:
				party.role === 'confirmer'
					? { relationship: shownRelationship(party), reason: party.relationshipReason }
					: null,
			walletsLinked: party.agentWalletHostname !== null && party.primaryWalletHostname !== null
		},
		campaign: {
			title: campaign.title,
			summary: campaign.summary,
			beneficiary: campaign.beneficiary,
			creatorName: campaign.creatorName,
			cadence: campaign.cadence
		},
		// The milestones this person reports on, or confirms. All of this is on the public page.
		milestones: milestones
			.filter((milestone) =>
				party.role === 'confirmer'
					? milestone.confirmerPartyId === party.id
					: milestone.ownerPartyId === party.id
			)
			.map((milestone) => ({
				id: milestone.id,
				position: milestone.position,
				title: milestone.title,
				dueDate: milestone.dueDate
			})),
		signedInAsThisParty: locals.session?.partyId === party.id
	};
};
