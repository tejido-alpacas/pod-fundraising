import { listDonorCampaigns } from '#lib/campaign-site/server/campaigns.ts';
import type { PageServerLoad } from './$types';

// The home page: the campaigns a donor can follow, newest first. What a donor may see of each
// is decided in `listDonorCampaigns`.
export const load = (async ({ locals }) => {
	return { campaigns: await listDonorCampaigns(locals.ctx.db) };
}) satisfies PageServerLoad;
