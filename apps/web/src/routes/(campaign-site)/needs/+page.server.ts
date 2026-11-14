import { listDonorCampaigns } from '#lib/campaign-site/server/campaigns.ts';
import type { PageServerLoad } from './$types';

// Give: the campaigns still raising money, newest first. Once a campaign is funded it leaves
// this page and is followed on Explore instead.
export const load = (async ({ locals }) => {
	const campaigns = await listDonorCampaigns(locals.ctx.db);
	return { campaigns: campaigns.filter((campaign) => campaign.status === 'funding') };
}) satisfies PageServerLoad;
