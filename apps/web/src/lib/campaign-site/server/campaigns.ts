import type { Campaign } from '@tejido/contracts';
import type { Executor } from '@tejido/db';
import { getFundingSummary, listCampaigns, listMilestones } from '@tejido/db';
import { isEndToEndTestEmail } from '@tejido/qatom/account';

/**
 * THE ONE RULE for whether a campaign may appear in a public list of campaigns (the home page,
 * Explore, the Give list, and any list, count, sitemap or feed added later). Two kinds never do:
 *
 * - a draft, which is its creator's unfinished work;
 * - a campaign the end-to-end tests own, whatever its status. The automatic tests publish a
 *   campaign on every paid run, and a visitor must never be shown one or invited to give to it.
 *   "The tests own it" means its creator's email is at the test inbox domain, and
 *   `isEndToEndTestEmail` in @tejido/qatom is the one place that decides that.
 *
 * This is about lists only. A campaign's own pages (`/campaigns/<id>` and below, `/give/<id>`)
 * read it by its id and still open for anyone who has the address.
 *
 * Every public list goes through `listDonorCampaigns` below, which asks this. A new list should
 * call that function; one that cannot must ask this rule and no other.
 */
export function isPubliclyListed(campaign: Pick<Campaign, 'status' | 'creatorEmail'>): boolean {
	return campaign.status !== 'draft' && !isEndToEndTestEmail(campaign.creatorEmail);
}

// The campaigns a donor can follow, newest first. Used by the home, Explore and Give pages.
//
// Donors are the readers, so nothing leaves this function as it is stored. A campaign carries
// its creator's email: what may be listed at all is decided by `isPubliclyListed` above (no
// drafts, no campaign the end-to-end tests own), and each campaign that is listed is rebuilt
// from the fields a donor may see.
export async function listDonorCampaigns(db: Executor) {
	const listed = (await listCampaigns(db)).filter(isPubliclyListed);

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
