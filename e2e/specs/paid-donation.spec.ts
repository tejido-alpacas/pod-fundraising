/**
 * A REAL DONATION, PAID ON QATOM'S CHECKOUT PAGE. THIS TEST CANNOT RUN, AND MUST NOT, UNTIL THE
 * OWNER ALLOWS IT.
 *
 * CLAUDE.md, "Never move money to test something", allows one paid thing today: the paid story
 * (specs/paid-filing.spec.ts). A paid donation is not part of it. So every test here is skipped,
 * saying no donation was paid, unless `E2E_PAID_DONATION` is exactly `true`, and NOTHING SETS
 * IT: not the workflow, not `E2E_PAID`, and never a person or an agent by hand. Even switched
 * on, it cannot pay yet: the pay button is not written into lib/donation.ts, on purpose.
 *
 * NO RUN HAS EVER TRIED THIS. It is written from Tejido's own pages; Qatom's checkout page has
 * never been met by the suite beyond arriving on it (specs/site-give.spec.ts).
 *
 * What it would do, once, as the suite's test donor, with nobody signed in on Tejido:
 *
 *   1. open the one test campaign it is given (`E2E_DONATION_CAMPAIGN_ID`), which must name
 *      "Tejido automated tests" as its organiser and be raising money. It never picks a campaign
 *      from the site's lists, so test money cannot land in a real fundraiser's total;
 *   2. press "Give 1.00 USD-TDN", the smallest amount, and arrive on Qatom's checkout page;
 *   3. sign in there with an emailed code and pay from the test donor's own Qatom wallet with
 *      ONE press. Never a card; never a second press;
 *   4. wait up to 3 minutes for the campaign's Funding block to show one more contribution and
 *      1.00 more. Qatom tells Tejido about the payment itself: the suite never calls
 *      `/api/donations`, and holds no secret.
 *
 * A DONATION IS NOT A DEPOSIT: nothing returns it. Each run would cost 1.00 for good.
 *
 * One try, never retried, in order, stopping at the first step that does not pass. Every way
 * out says what is known about the money (lib/donation-outcome.ts): nothing was paid; top up
 * needed (nothing was paid); it was paid and recorded; it was paid but Tejido did not record it
 * in 3 minutes; it may have been paid; or it is not known. No picture is ever taken of Qatom's
 * checkout page, and its address is never written: whoever holds it could pay it.
 */
import { DONATION, donationRunRefusal } from '../lib/donation-outcome.ts';
import { openTestCampaign, payDonation, readFunding, startCheckout } from '../lib/donation.ts';
import { expect, test } from '../lib/harness.ts';
import { sqsInboxQueue } from '../lib/inbox.ts';

// In order, and the second is left out when the first fails. Never retried: a retry would pay again.
test.describe.configure({ mode: 'serial', retries: 0 });
// Nobody is signed in on Tejido: a donor is not. No picture on failure: a failure can happen on
// Qatom's checkout page.
test.use({ storageState: { cookies: [], origins: [] }, screenshot: 'off' });
// Longer than every wait added together (six screens, the emailed code, the 3 minutes), so the
// test's own clock never cuts in while money may be moving.
test.setTimeout(900_000);

/** Skipped on every run today. One donation per run at most: the desktop project gives it. */
function paidDonationOnly(
	cfg: Parameters<typeof donationRunRefusal>[0],
	project: string,
	retry: number
): void {
	const refusal = donationRunRefusal(cfg);
	if (refusal !== null && 'skip' in refusal) {
		test.skip(true, refusal.skip);
		return;
	}
	test.skip(
		project !== 'desktop',
		'No donation was paid here: one paid donation per run, and the desktop project gives it.'
	);
	if (refusal !== null) throw new Error(refusal.fail);
	// Belt and braces: a retry would pay a second donation.
	expect(retry, 'A paid donation must never be retried.').toBe(0);
}

test('the test campaign is raising money and offers the smallest amount; nothing is pressed', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	paidDonationOnly(cfg, testInfo.project.name, testInfo.retry);
	const campaignId = cfg.donationCampaignId ?? '';

	await openTestCampaign(page, cfg.siteUrl, campaignId);
	const funding = await readFunding(page, cfg.siteUrl, campaignId);
	testInfo.annotations.push({
		type: 'found',
		description: `Before: ${funding.contributions} contribution(s) recorded on the test campaign.`
	});
	await waypoint(page, 'campaign-before-the-donation');

	await page.goto(`${cfg.siteUrl}/give/${campaignId}`);
	await expect(
		page.getByRole('main').getByRole('button', { name: `Give ${DONATION} USD-TDN`, exact: true }),
		`NOTHING WAS PAID: the Give page does not offer "Give ${DONATION} USD-TDN".`
	).toBeVisible();
	await waypoint(page, 'give-page-before-the-donation');
});

test('gives 1.00 for real on Qatom’s checkout page, and the campaign’s total goes up by it', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	paidDonationOnly(cfg, testInfo.project.name, testInfo.retry);
	const campaignId = cfg.donationCampaignId ?? '';

	await openTestCampaign(page, cfg.siteUrl, campaignId);
	await startCheckout(page, cfg.siteUrl, campaignId);
	// From here the browser is on Qatom's checkout page. `payDonation` leaves it before it
	// returns or throws.
	await payDonation(page, cfg, campaignId, sqsInboxQueue(cfg.inbox), waypoint, testInfo);
});
