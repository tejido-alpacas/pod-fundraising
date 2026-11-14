import { listCampaigns, listEntries, listMilestones } from '@tejido/db';
import {
	confirmedCount,
	milestoneStandings,
	todayUtc
} from '#lib/campaign-site/server/delivery.ts';
import type { PageServerLoad } from './$types';

// The home page: the campaigns a donor can follow, newest first.
//
// Donors are the readers, so nothing leaves this function as it is stored. A campaign carries
// its creator's email, and a draft is its creator's unfinished work: drafts are left out
// altogether, and each campaign that is listed is rebuilt from the fields a donor may see.
export const load = (async ({ locals }) => {
	const { db } = locals.ctx;
	const today = todayUtc();

	const listed = (await listCampaigns(db)).filter((campaign) => campaign.status !== 'draft');

	const campaigns = await Promise.all(
		listed.map(async (campaign) => {
			const [milestones, entries] = await Promise.all([
				listMilestones(db, campaign.id),
				listEntries(db, campaign.id)
			]);
			return {
				id: campaign.id,
				title: campaign.title,
				summary: campaign.summary,
				beneficiary: campaign.beneficiary,
				creatorName: campaign.creatorName,
				status: campaign.status,
				milestones: {
					total: milestones.length,
					confirmed: confirmedCount(milestones)
				},
				/** One segment of the delivery track per milestone, in order. */
				delivery: milestoneStandings(milestones, entries, today),
				path: `/campaigns/${campaign.id}`
			};
		})
	);

	// `listCampaigns` answers oldest first.
	return { campaigns: campaigns.reverse() };
}) satisfies PageServerLoad;
