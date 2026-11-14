import { listDonorCampaigns } from '#lib/campaign-site/server/campaigns.ts';
import type { PageServerLoad } from './$types';

// Explore: every campaign a donor can follow, newest first. Searching and filtering happen in
// the browser, over this list.
export const load = (async ({ locals }) => {
	return { campaigns: await listDonorCampaigns(locals.ctx.db) };
}) satisfies PageServerLoad;
