import { error, fail, redirect } from '@sveltejs/kit';
import { formatAmount } from '@tejido/contracts';
import { getCampaign, getFundingSummary } from '@tejido/db';
import { QatomError } from '@tejido/qatom';
import { listDonationOptions, startDonation } from '#lib/server/backend/donation-items.ts';
import type { Actions, PageServerLoad } from './$types';

// Giving to one campaign: the donor picks one of the amounts Tejido's donation items sell, and
// Qatom's checkout page for it opens in a new window (the page's form asks for one, because
// Qatom's page does not bring the donor back). Nothing is paid, and nothing is recorded, on this
// page: Qatom tells us afterwards, at POST /api/donations/<amount>.
//
// The amounts come from Qatom each time the page is opened, through the merchant account. If
// Qatom cannot be asked, the page says giving is not available now; it never shows amounts it
// could not confirm are on sale.
//
// No donor is identified: this page asks for no name and no email, and reads no session.

export const load = (async ({ params, locals }) => {
	const { db, config, qatom } = locals.ctx;

	const campaign = await getCampaign(db, params.campaignId);
	if (!campaign) error(404, 'There is no campaign at this address.');

	const funding = await getFundingSummary(db, campaign);
	// Only a campaign that is raising money takes donations here.
	const open = campaign.status === 'funding';

	let amounts: { value: number; shown: string }[] | null = [];
	if (open) {
		try {
			const options = await listDonationOptions(qatom.account, config);
			amounts = options.map(({ amount }) => ({ value: amount, shown: formatAmount(amount) }));
		} catch (thrown) {
			// A QatomError carries no token, secret or response body. Nothing is logged.
			if (!(thrown instanceof QatomError)) throw thrown;
			amounts = null;
		}
	}

	return {
		// Built field by field: the creator's email never leaves the server.
		campaign: {
			id: campaign.id,
			title: campaign.title,
			beneficiary: campaign.beneficiary,
			creatorName: campaign.creatorName,
			path: `/campaigns/${campaign.id}`
		},
		open,
		/** The goal and what has been given, as written amounts. Totals only. */
		funding: {
			goal: funding.goal === null ? null : formatAmount(funding.goal),
			raised: funding.state === 'known' ? formatAmount(funding.raised) : null,
			donations: funding.state === 'known' ? funding.donations : null
		},
		/** The amounts on sale now, smallest first. Null when Qatom could not be asked. */
		amounts
	};
}) satisfies PageServerLoad;

export const actions = {
	/**
	 * Asks Qatom for a checkout link for the chosen amount and redirects to it. The page's form
	 * opens this answer in a new window, so a refusal is drawn there too.
	 */
	default: async ({ request, params, locals }) => {
		const { db, config, qatom } = locals.ctx;

		const campaign = await getCampaign(db, params.campaignId);
		if (!campaign) error(404, 'There is no campaign at this address.');
		if (campaign.status !== 'funding') return fail(409, { problem: 'closed' as const });

		const chosen = (await request.formData()).get('amount');
		const amount =
			typeof chosen === 'string' && /^[1-9][0-9]{0,12}$/.test(chosen) ? Number(chosen) : null;
		if (amount === null) return fail(400, { problem: 'gone' as const });

		let checkout: { url: string } | null;
		try {
			checkout = await startDonation(qatom.account, config, { campaignId: campaign.id, amount });
		} catch (thrown) {
			// A QatomError carries no token, secret or response body. Nothing is logged.
			if (!(thrown instanceof QatomError)) throw thrown;
			return fail(503, { problem: 'unavailable' as const });
		}
		// No donation item sells that amount now. Nothing was asked of Qatom for it.
		if (checkout === null) return fail(409, { problem: 'gone' as const });

		// The link is for this one purchase. It is not stored anywhere. It leaves this site, so only
		// the origin of the link Qatom itself gave (https, checked by the client) is allowed.
		redirect(303, checkout.url, { external: [new URL(checkout.url).origin] });
	}
} satisfies Actions;
