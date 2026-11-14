import { error } from '@sveltejs/kit';
import { getCampaign, getParty } from '@tejido/db';
import type { PageServerLoad } from './$types';

/** `site@example.org` becomes `s•••@example.org`: enough to recognise, not enough to copy. */
function emailHint(email: string): string {
	const at = email.lastIndexOf('@');
	return `${email.slice(0, 1)}•••${email.slice(at)}`;
}

// The invite page (B1): who is invited, to which campaign, in which role.
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

	return {
		// Anyone holding the link can open this page, so it gets no reporter code, no wallet
		// and no full email address.
		party: {
			id: party.id,
			name: party.name,
			title: party.title,
			role: party.role,
			emailHint: emailHint(party.email),
			walletsLinked: party.agentWalletHostname !== null && party.primaryWalletHostname !== null
		},
		campaign: {
			title: campaign.title,
			summary: campaign.summary,
			beneficiary: campaign.beneficiary,
			creatorName: campaign.creatorName
		},
		signedInAsThisParty: locals.session?.partyId === party.id
	};
};
