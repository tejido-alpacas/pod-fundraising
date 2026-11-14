import { getCampaign, getParty, listMilestones } from '@tejido/db';
import { usablePersonToken } from '#lib/server/person-tokens.ts';
import type { PageServerLoad } from './$types';

// The chat page (B2): who the agent would be working for, and whether it can reach Qatom as them.
export const load: PageServerLoad = async ({ locals }) => {
	const { session } = locals;
	if (!session) return { who: null };

	const { config, db } = locals.ctx;
	const party = session.partyId ? await getParty(db, session.partyId) : undefined;
	const campaign = party ? await getCampaign(db, party.campaignId) : undefined;
	if (!party || !campaign) return { who: { email: session.email, party: null } };

	const token = await usablePersonToken(db, config.SESSION_SECRET, party.id);
	const milestones = await listMilestones(db, campaign.id);

	return {
		who: {
			email: session.email,
			// Never the reporter code, the wallet hostnames or the tokens.
			party: {
				id: party.id,
				name: party.name,
				role: party.role,
				campaignTitle: campaign.title,
				/** False when the person must sign in again before the agent can act for them. */
				connected: token.ok,
				milestones: milestones
					.filter(
						(milestone) =>
							milestone.ownerPartyId === party.id || milestone.confirmerPartyId === party.id
					)
					.map((milestone) => ({
						id: milestone.id,
						title: milestone.title,
						dueDate: milestone.dueDate,
						state: milestone.state,
						part: milestone.ownerPartyId === party.id ? ('owes' as const) : ('confirms' as const)
					}))
			}
		}
	};
};
