/**
 * Giving to a campaign, as a donor who is not signed in, as far as it goes WITHOUT PAYING.
 *
 * A campaign that is raising money ("funding") shows "Give to this campaign", which opens its
 * Give page: one button per amount Tejido's donation items sell, read from Qatom each time.
 * Pressing an amount sends the browser to Qatom's checkout page. Nothing is charged until the
 * donor pays there, and this spec never pays: it stops on arriving.
 *
 * What can be checked depends on the live site: whether any campaign is raising money, and
 * whether the donation items exist in Qatom yet. Each check says plainly what it found, and
 * is skipped, saying why, when there is nothing to check. It never calls `/api/donations`.
 */
import type { Page } from '@playwright/test';
import { describeCheckoutPage } from '../lib/checkout-page.ts';
import { amountShown } from '../lib/give-page.ts';
import { expect, test, until } from '../lib/harness.ts';
import { assertQatomCheckoutPage, onOrigin } from '../lib/safety.ts';

// No picture is taken when a check here fails: one of them ends on Qatom's checkout page, which
// anyone holding it could pay. The failure's words in the log still say what the page showed.
test.use({ storageState: { cookies: [], origins: [] }, screenshot: 'off' });

const NOT_RAISING = 'This campaign is not raising money right now.';
const NOT_AVAILABLE =
	'Giving is not available right now. Nothing was charged. Please try again later.';
const amountButtons = (page: Page) =>
	page.getByRole('main').getByRole('button', { name: /^Give [\d.,]+ USD-TDN$/ });

/** The address of the first campaign listed as raising money, or null when none is. */
async function campaignRaisingMoney(page: Page, siteUrl: string): Promise<string | null> {
	await page.goto(`${siteUrl}/needs`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Give');
	const cards = page.getByRole('main').locator('a[href^="/campaigns/"]');
	// The page has drawn either its cards or its "none" heading before the count is trusted.
	await expect(
		cards.first().or(page.getByRole('heading', { name: 'No campaign is raising money right now.' }))
	).toBeVisible();
	return (await cards.count()) > 0 ? await cards.first().getAttribute('href') : null;
}

test('a campaign that is not raising money offers no way to give', async ({
	page,
	cfg,
	waypoint
}) => {
	// The test campaign is a draft: it is not raising money.
	await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Give to this campaign' })).toHaveCount(0);

	// Its Give page, opened by its address, says so and shows no amount.
	await page.goto(`${cfg.siteUrl}/give/${cfg.campaignId}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Give to .+/);
	await expect(page.getByText(NOT_RAISING)).toBeVisible();
	await expect(amountButtons(page)).toHaveCount(0);
	await expect(page.getByRole('main').getByRole('button')).toHaveCount(0);
	await waypoint(page, 'give-not-raising');

	await page.getByRole('link', { name: /Back to the campaign/ }).click();
	await expect(page).toHaveURL(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
});

test('the Give page of a campaign that does not exist says so', async ({ page, cfg }) => {
	const response = await page.goto(`${cfg.siteUrl}/give/no-such-campaign-e2e`);
	expect(response?.status()).toBe(404);
});

test('a campaign that is raising money leads to its Give page, which lists amounts or says giving is not available', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	const address = await campaignRaisingMoney(page, cfg.siteUrl);
	test.skip(
		address === null,
		'No campaign is raising money on the site now, so there is no Give button to follow.'
	);
	const id = (address ?? '').replace('/campaigns/', '');

	await page.goto(`${cfg.siteUrl}${address ?? ''}`);
	const give = page.getByRole('link', { name: 'Give to this campaign' });
	await expect(give).toHaveAttribute('href', `/give/${id}`);
	await waypoint(page, 'campaign-with-give');
	await give.click();
	await expect(page).toHaveURL(`${cfg.siteUrl}/give/${id}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Give to .+/);
	await expect(page.getByText(NOT_RAISING)).toHaveCount(0);

	// Either the amounts on sale, or the plain statement that giving is not available.
	await expect(amountButtons(page).first().or(page.getByText(NOT_AVAILABLE))).toBeVisible();
	const amounts = await amountButtons(page).count();
	if (amounts === 0) {
		await expect(page.getByText(NOT_AVAILABLE)).toBeVisible();
		await waypoint(page, 'give-not-available');
		testInfo.annotations.push({
			type: 'found',
			description: 'Giving is not available: Qatom lists no donation item (or could not be asked).'
		});
		return;
	}
	await expect(page.getByRole('heading', { name: 'Choose an amount' })).toBeVisible();
	await expect(
		page.getByText('You pay on Qatom’s checkout page. Nothing is charged here.')
	).toBeVisible();
	await expect(
		page.getByText('Tejido keeps no name, email or wallet of yours with the gift.')
	).toBeVisible();
	// Each amount once, smallest first.
	const shown = (await amountButtons(page).allInnerTexts()).map((text) =>
		Number(text.replace(/[^\d.]/g, ''))
	);
	expect(new Set(shown).size, 'Each amount should be offered once.').toBe(shown.length);
	expect(shown, 'The amounts should be listed smallest first.').toEqual(
		[...shown].sort((a, b) => a - b)
	);
	await waypoint(page, 'give-amounts');
	testInfo.annotations.push({
		type: 'found',
		description: `Amounts on sale: ${shown.join(', ')}.`
	});
});

test('pressing an amount arrives at Qatom’s checkout page, and nothing is paid', async ({
	page,
	cfg
}, testInfo) => {
	// Each press makes one checkout at Qatom that is never paid. One per run is enough.
	test.skip(testInfo.project.name !== 'desktop', 'One unpaid checkout per run: desktop makes it.');
	const address = await campaignRaisingMoney(page, cfg.siteUrl);
	test.skip(address === null, 'No campaign is raising money on the site now.');
	await page.goto(`${cfg.siteUrl}/give/${(address ?? '').replace('/campaigns/', '')}`);
	await expect(amountButtons(page).first().or(page.getByText(NOT_AVAILABLE))).toBeVisible();
	test.skip(
		(await amountButtons(page).count()) === 0,
		'No amount is on sale: the donation items are not in Qatom yet, so there is nothing to press.'
	);

	// What the page offers, as written ("1.00"), smallest first. The smallest is pressed.
	const offered = (await amountButtons(page).allInnerTexts()).map(amountShown);
	const pressed = offered[0] ?? '';

	// The smallest amount. The checkout's address can be paid by whoever holds it, so it is
	// never waited on by address or written anywhere: only where the browser is, is read.
	await amountButtons(page).first().click();
	try {
		await until('the browser to leave Tejido for Qatom’s checkout page', 45_000, async () => {
			if (!onOrigin(page.url(), cfg.siteUrl)) return true;
			const problem = page.getByRole('alert');
			if (await problem.isVisible()) {
				throw new Error(
					`The Give page did not start a checkout: ${(await problem.innerText()).trim()}`
				);
			}
			return null;
		});
		assertQatomCheckoutPage(page.url());
		// Arriving is the check that fails. Nothing on Qatom's page is pressed, so nothing is paid.
		// What the page shows is then READ, to say whether it is for the amount that was pressed.
		// Qatom's wording is not known from this repository, so this is reported, not required:
		// read "found" in the report after the first run that reaches here.
		testInfo.annotations.push({
			type: 'found',
			description: await describeCheckoutPage(page, pressed, offered)
		});
	} finally {
		// Whatever happened, the browser does not stay on a page of another site: nothing that
		// runs after a test (the failure's description of the page) may read a checkout that
		// anyone holding its address could pay. No picture is kept of it either.
		if (!onOrigin(page.url(), cfg.siteUrl)) await page.goto('about:blank');
	}
});
