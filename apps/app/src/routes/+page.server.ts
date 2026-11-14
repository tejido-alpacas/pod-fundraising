import { getCampaign, getParty } from '@tejido/db';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const { session } = locals;
	if (!session) return { signedIn: null };

	const { db } = locals.ctx;
	const party = session.partyId ? await getParty(db, session.partyId) : undefined;
	const campaign = party ? await getCampaign(db, party.campaignId) : undefined;

	return {
		// Shown so the person can tell who they are signed in as, and on which campaign.
		// Never the wallet hostnames, the reporter code or the tokens.
		signedIn: {
			email: session.email,
			party: party
				? {
						id: party.id,
						name: party.name,
						title: party.title,
						role: party.role,
						walletsLinked:
							party.agentWalletHostname !== null && party.primaryWalletHostname !== null
					}
				: null,
			campaign: campaign ? { title: campaign.title } : null
		}
	};
};
