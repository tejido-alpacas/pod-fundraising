import type { Executor } from '@tejido/db';
import { getFundingSummary, listCampaigns, listMilestones } from '@tejido/db';

// The campaigns a donor can follow, newest first. Used by the home, Explore and Give pages.
//
// Donors are the readers, so nothing leaves this function as it is stored. A campaign carries
// its creator's email, and a draft is its creator's unfinished work: drafts are left out
// altogether, and each campaign that is listed is rebuilt from the fields a donor may see.
export async function listDonorCampaigns(db: Executor) {
	const listed = (await listCampaigns(db)).filter((campaign) => campaign.status !== 'draft');

	const campaigns = await Promise.all(
		listed.map(async (campaign) => {
			const [milestones, funding] = await Promise.all([
				listMilestones(db, campaign.id),
				getFundingSummary(db, campaign)
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
					confirmed: milestones.filter(
						(milestone) =>
							milestone.state === 'confirmed_independent' || milestone.state === 'confirmed_creator'
					).length
				},
				/**
				 * Money given, against the goal: totals from our own database, as last read from
				 * Qatom's ledger. `state: 'not_known'` is not zero. No donor is identified. A different
				 * fact from delivery (`milestones` above), and never drawn in a status colour.
				 */
				funding,
				path: `/campaigns/${campaign.id}`
			};
		})
	);

	// `listCampaigns` answers oldest first.
	return campaigns.reverse();
}

export type DonorCampaign = Awaited<ReturnType<typeof listDonorCampaigns>>[number];
