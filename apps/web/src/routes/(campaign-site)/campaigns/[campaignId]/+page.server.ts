import { error } from '@sveltejs/kit';
import { getCampaign, listDeposits, listEntries, listMilestones, listParties } from '@tejido/db';
import type { PageServerLoad } from './$types';

// The donor timeline (A2). This is the working slice that proves the wiring:
// seeded database -> @tejido/db -> this load -> the page.
export const load: PageServerLoad = async ({ params, locals }) => {
	const { db } = locals.ctx;

	const campaign = await getCampaign(db, params.campaignId);
	if (!campaign) error(404, 'No such campaign');

	const [parties, milestones, entries, deposits] = await Promise.all([
		listParties(db, campaign.id),
		listMilestones(db, campaign.id),
		listEntries(db, campaign.id),
		listDeposits(db, campaign.id)
	]);

	return {
		campaign,
		milestones,
		entries,
		deposits,
		// Donors see who filed. They never see a reporter code, an email or a primary wallet.
		parties: parties.map(({ id, name, title, role }) => ({ id, name, title, role }))
	};
};
