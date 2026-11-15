/**
 * A REAL DONATION, PAID ON QATOM'S CHECKOUT PAGE. Part of the paid story (CLAUDE.md, "Never move
 * money to test something").
 *
 * NOTHING SENDS THE DONATION BACK BY ITSELF. The owner returns test money by hand. Each run
 * that gives costs the test contractor's primary wallet the smallest amount on sale, and the
 * donation stays in the test campaign's total until the cleanup removes the campaign.
 *
 * Every test here is skipped, saying no donation was paid, unless ALL of these hold:
 *
 *   - `E2E_PAID_DONATION` is exactly `true`. Only the workflow may set it, on a run that tells
 *     the paid story. `E2E_PAID` alone does not switch it on. Never set it by hand, and never
 *     run this suite from a session;
 *   - it runs in the Playwright project named `donation`, which comes after both sign-ins (the
 *     App's, the test contractor's; and the Campaign Site's, which publishes the campaign);
 *   - the run is a paid run with a campaign of its own (specs/create-campaign.spec.ts).
 *
 * WHEN THIS WAS WRITTEN NO RUN HAD TRIED IT. Qatom's checkout page is written from Qatom's
 * source, read by the coordinator; this suite had never driven it (lib/donation.ts).
 *
 * The story, in order, stopping at the first step that does not pass:
 *
 *   1. As the campaign's organiser (the suite's visitor, signed in on the Campaign Site): the
 *      run's own campaign is published if it is still a draft, so it takes donations. A test
 *      campaign is on no public list. No money moves.
 *   2. With nobody signed in on Tejido: the smallest amount on the campaign's Give page is
 *      pressed, Qatom's checkout opens (in a new window or the same tab), the test contractor
 *      signs in there with an emailed code, chooses their wallet and pays with ONE press. Never
 *      a card, never a second press, never a retry. Then, for up to 3 minutes, the campaign's
 *      Funding block must come to show exactly one more contribution and the amount more.
 *      Qatom tells Tejido about the payment itself: the suite never calls `/api/donations`.
 *
 * Every way out says what is known about the money (lib/donation-outcome.ts): nothing was
 * paid; top up needed (nothing was paid, and the step is skipped, not failed); paid and
 * recorded; paid but not recorded in 3 minutes; it may have been paid; or it is not known. No
 * picture is ever taken of Qatom's checkout page and its address is never written: whoever
 * holds it could pay it.
 */
import { existsSync } from 'node:fs';
import { donationRunRefusal } from '../lib/donation-outcome.ts';
import {
	openTestCampaign,
	payDonation,
	publishIfDraft,
	smallestGiftOnSale,
	startCheckout
} from '../lib/donation.ts';
import { expect, test } from '../lib/harness.ts';
import { sqsInboxQueue } from '../lib/inbox.ts';
import { DONOR_STATE } from '../lib/paths.ts';
import { readRunCampaign } from '../lib/run-campaign.ts';
import { DESKTOP } from '../lib/viewports.ts';

/** The one Playwright project that may give: it runs after both sign-ins. */
const PROJECT = 'donation';

// In order, and the rest are left out once one fails. Never retried: a retry would pay again.
test.describe.configure({ mode: 'serial', retries: 0 });
// Nobody is signed in on Tejido unless a step signs them in itself. No picture on failure: a
// failure can happen on Qatom's checkout page.
test.use({ ...DESKTOP, storageState: { cookies: [], origins: [] }, screenshot: 'off' });
// Longer than every wait in one step added together (the emailed code, the wallets, the 3
// minutes), so the test's own clock never cuts in while money may be moving.
test.setTimeout(900_000);

type Cfg = Parameters<typeof donationRunRefusal>[0];

/** Skipped unless the workflow switched it on. Throws on a run that was switched on wrongly. */
function paidDonationOnly(cfg: Cfg, project: string, retry: number): void {
	const refusal = donationRunRefusal(cfg, readRunCampaign()?.campaignId ?? null);
	if (refusal !== null && 'skip' in refusal) {
		test.skip(true, refusal.skip);
		return;
	}
	test.skip(
		project !== PROJECT,
		`No donation was paid here: only the "${PROJECT}" project gives, after both sign-ins.`
	);
	if (refusal !== null) throw new Error(refusal.fail);
	// Belt and braces: a retry would pay a second donation.
	expect(retry, 'A paid donation must never be retried.').toBe(0);
}

test('as its organiser: the run’s own campaign is published, so that it takes donations', async ({
	browser,
	cfg,
	waypoint
}, testInfo) => {
	paidDonationOnly(cfg, testInfo.project.name, testInfo.retry);
	// The organiser's signed-in browser is opened here, after the checks above, so a run that
	// gives nothing never needs it.
	if (!existsSync(DONOR_STATE)) {
		throw new Error(
			'NOTHING WAS PAID: the suite’s visitor is not signed in on the Campaign Site in this run ' +
				'(specs/site-sign-in.spec.ts did not pass, or has not run yet), so the run’s campaign ' +
				'cannot be published.'
		);
	}
	const organiser = await browser.newContext({ ...DESKTOP, storageState: DONOR_STATE });
	try {
		const page = await organiser.newPage();
		const outcome = await publishIfDraft(page, cfg.siteUrl, cfg.campaignId);
		testInfo.annotations.push({
			type: 'found',
			description:
				outcome === 'published'
					? 'The campaign was a draft: "Publish campaign" was pressed once.'
					: 'The campaign was already raising money: nothing was pressed.'
		});
		await waypoint(page, 'campaign-raising-money');
	} finally {
		await organiser.close();
	}
});

test.describe('as a donor, signed out', () => {
	test('gives the smallest amount for real on Qatom’s checkout page, and the campaign’s total goes up by it', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidDonationOnly(cfg, testInfo.project.name, testInfo.retry);

		await openTestCampaign(page, cfg.siteUrl, cfg.campaignId);
		const gift = await smallestGiftOnSale(page, cfg.siteUrl, cfg.campaignId);
		await waypoint(page, 'give-page-before-the-donation');

		const checkout = await startCheckout(page, cfg.siteUrl, gift);
		try {
			// `payDonation` leaves Qatom's checkout page before it returns or throws.
			await payDonation(checkout, cfg, gift, sqsInboxQueue(cfg.inbox), waypoint, testInfo);
		} finally {
			// Qatom's checkout does not send the donor back: a window it opened is closed.
			if (checkout !== page) await checkout.close().catch(() => undefined);
		}
	});
});
