/**
 * A REAL DONATION, PAID ON QATOM'S CHECKOUT PAGE, THEN UNDONE BY TEJIDO. Part of the paid story
 * (CLAUDE.md, "Never move money to test something": the owner, 15 November 2026, "Yes pay real
 * donation is totally fine, make one, then remove it then refund the donation like the other
 * e2e tests").
 *
 * IT DOES NOT RUN YET. Every test here is skipped, saying no donation was paid, unless ALL of
 * these hold, and today the first does not:
 *
 *   - `E2E_PAID_DONATION` is exactly `true`. Only the workflow may set it, and it does not yet.
 *     `E2E_PAID` alone does not switch it on. Never set it by hand, and never run this suite
 *     from a session;
 *   - it runs in a Playwright project named `donation`, which comes after both sign-ins (the
 *     App's, which registers the payer's wallets with Tejido, and the Campaign Site's, which
 *     publishes the campaign);
 *   - the run is a paid run with a campaign of its own (specs/create-campaign.spec.ts).
 *
 * NO RUN HAS EVER TRIED THIS. Qatom's checkout page is written from Qatom's source, read by the
 * coordinator; this suite has never driven it (lib/donation.ts).
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
 *   3. For up to 6 minutes more, the Funding block must go back to what it was: Tejido takes a
 *      test donation out of the total and sends it back to the wallet that paid, by itself.
 *      This step is reported apart, so "paid and recorded" is never hidden by a slow undo.
 *
 * Every way out says what is known about the money (lib/donation-outcome.ts): nothing was
 * paid; top up needed (nothing was paid); paid and recorded; paid but not recorded in 3
 * minutes; it may have been paid; it is not known; and then undone, or not undone in 6 minutes.
 * No picture is ever taken of Qatom's checkout page and its address is never written: whoever
 * holds it could pay it.
 */
import { existsSync } from 'node:fs';
import { donationRunRefusal } from '../lib/donation-outcome.ts';
import {
	openTestCampaign,
	payDonation,
	publishIfDraft,
	smallestGiftOnSale,
	startCheckout,
	waitForUndo,
	type Given
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
// minutes; or the 6 minutes), so the test's own clock never cuts in while money may be moving.
test.setTimeout(900_000);

/** What the second step gave, for the third. Null until a donation was paid and recorded. */
let given: Given | null = null;

type Cfg = Parameters<typeof donationRunRefusal>[0];

/** Skipped on every run today. Throws on a run that was switched on wrongly. */
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
			given = await payDonation(checkout, cfg, gift, sqsInboxQueue(cfg.inbox), waypoint, testInfo);
		} finally {
			// Qatom's checkout does not send the donor back: a window it opened is closed.
			if (checkout !== page) await checkout.close().catch(() => undefined);
		}
	});

	test('Tejido takes the test donation back out of the campaign’s total', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidDonationOnly(cfg, testInfo.project.name, testInfo.retry);
		test.skip(given === null, 'No donation was paid and recorded in this run, so none is undone.');
		if (given === null) return;

		await waitForUndo(page, cfg, given, waypoint, testInfo);
	});
});
