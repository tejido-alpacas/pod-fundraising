/**
 * A donor's walk to the Give page, signed out, WITHOUT PAYING and without pressing an amount:
 * from "Give now" (/needs) to a campaign, from the campaign to its Give page, and back.
 *
 * Then the money: the totals the Give page states (raised, goal, number of gifts) must be the
 * ones the Funding block on the campaign's own page states. No particular number is expected:
 * the two pages must agree, whatever has been given.
 *
 * Reads only. Skipped, saying why, while no campaign is raising money.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import {
	GIVE,
	amountButtons,
	amountsOffered,
	campaignIdOf,
	campaignPageFunding,
	campaignsRaisingMoney,
	fundingInWords,
	givePageFunding,
	giveWords,
	type StatedFunding,
	say
} from '../lib/give-page.ts';
import { whole } from '../lib/site-words.ts';

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

/** How many of the listed campaigns are walked: enough to show the rule, few enough to be quick. */
const MOST_CAMPAIGNS = 5;

/** The Funding block on a campaign's own page, or null when the page draws none. */
async function fundingOnCampaignPage(
	page: Page,
	siteUrl: string,
	id: string
): Promise<StatedFunding | null> {
	await page.goto(`${siteUrl}/campaigns/${id}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	const block = page.locator('.tj-funding');
	if ((await block.count()) === 0) return null;
	const text = await block.innerText();
	const stated = campaignPageFunding(text);
	expect(
		stated,
		`The campaign page’s Funding block could not be read. It says: "${text.replace(/\s+/g, ' ').trim()}".`
	).not.toBeNull();
	return stated;
}

/** The totals line on a campaign's Give page, or null when the page draws none. */
async function fundingOnGivePage(
	page: Page,
	siteUrl: string,
	id: string
): Promise<StatedFunding | null> {
	await page.goto(`${siteUrl}/give/${id}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Give to .+/);
	const line = page.getByRole('main').locator('.give-total');
	if ((await line.count()) === 0) return null;
	const text = await line.innerText();
	const stated = givePageFunding(text);
	expect(
		stated,
		`The Give page’s totals line could not be read. It says: "${text.replace(/\s+/g, ' ').trim()}".`
	).not.toBeNull();
	return stated;
}

test('from "Give now", each campaign listed leads to its own Give page and back', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	const listed = await campaignsRaisingMoney(page, cfg.siteUrl);
	test.skip(
		listed.length === 0,
		'No campaign is raising money on the site now, so "Give now" lists nothing to follow.'
	);
	await waypoint(page, 'give-now-list');
	const walked = listed.slice(0, MOST_CAMPAIGNS);
	const main = page.getByRole('main');

	for (const [index, address] of walked.entries()) {
		const id = campaignIdOf(address);

		// As the donor does: press the campaign's card on "Give now".
		await page.goto(`${cfg.siteUrl}/needs`);
		const card = main.getByRole('article').filter({ has: page.locator(`a[href="${address}"]`) });
		await expect(card).toHaveCount(1);
		// A card begins with its status: every campaign on this page is raising money.
		await expect(card).toHaveText(/^\s*Fundraising/);
		const title = (await card.getByRole('heading').innerText()).trim();
		await card.getByRole('heading').getByRole('link').click();
		await expect(page).toHaveURL(`${cfg.siteUrl}${address}`);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

		// The campaign's page offers one way to give, to its own Give page.
		const give = page.getByRole('link', { name: 'Give to this campaign', exact: true });
		await expect(give).toHaveCount(1);
		await expect(give).toHaveAttribute('href', `/give/${id}`);
		await give.click();
		await expect(page).toHaveURL(`${cfg.siteUrl}/give/${id}`);

		// The Give page is for the campaign the donor chose, and is open.
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Give to ${title}`);
		await expect(page).toHaveTitle(`Give to ${title} · tejido`);
		await expect(main.getByText(whole(giveWords('en', GIVE.notRaising)))).toHaveCount(0);
		await expect(
			amountButtons(page)
				.first()
				.or(main.getByText(whole(giveWords('en', GIVE.notAvailable))))
		).toBeVisible();
		// Each amount once, smallest first. None is pressed.
		const offered = await amountsOffered(page);
		// Nothing was asked yet, so no problem is reported.
		await expect(main.getByRole('alert')).toHaveCount(0);
		if (index === 0) await waypoint(page, 'give-page-from-give-now');

		// And back to the campaign.
		await main.getByRole('link', { name: /Back to the campaign/ }).click();
		await expect(page).toHaveURL(`${cfg.siteUrl}${address}`);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);

		say(
			testInfo,
			`"${title}": Give button, Give page, and back. ` +
				(offered.length > 0
					? `Amounts on sale: ${offered.join(', ')}.`
					: 'Giving is not available there now.')
		);
	}
	if (listed.length > walked.length) {
		say(
			testInfo,
			`"Give now" lists ${listed.length} campaigns; the first ${walked.length} were walked.`,
			'not checked'
		);
	}
});

test('the Give page’s totals are the ones in the Funding block on the campaign’s own page', async ({
	page,
	cfg
}, testInfo) => {
	const listed = await campaignsRaisingMoney(page, cfg.siteUrl);
	test.skip(
		listed.length === 0,
		'No campaign is raising money on the site now, so there are no totals to compare.'
	);

	for (const address of listed.slice(0, MOST_CAMPAIGNS)) {
		const id = campaignIdOf(address);
		// A donation can land between two reads. The campaign page is read before and after the
		// Give page; only when it says the same both times is the Give page held to it.
		let before = await fundingOnCampaignPage(page, cfg.siteUrl, id);
		let onGivePage: StatedFunding | null = null;
		let settled = false;
		for (let attempt = 0; attempt < 3 && !settled; attempt += 1) {
			onGivePage = await fundingOnGivePage(page, cfg.siteUrl, id);
			const after = await fundingOnCampaignPage(page, cfg.siteUrl, id);
			settled = JSON.stringify(after) === JSON.stringify(before);
			before = after;
		}
		const onCampaignPage = before;
		if (!settled) {
			say(
				testInfo,
				`${id}: its totals changed three times while being read (donations are arriving), so the two pages were not compared.`,
				'not checked'
			);
			continue;
		}

		if (onCampaignPage === null) {
			// What has been given is not known: the campaign page draws no Funding block, and the
			// Give page states no amount raised (at most the goal).
			expect(
				onGivePage?.raised ?? null,
				`${id}: the campaign page shows no Funding block, but the Give page says ${fundingInWords(onGivePage)}.`
			).toBeNull();
			expect(onGivePage?.gifts ?? null).toBeNull();
		} else {
			expect(
				onGivePage,
				`${id}: the campaign page says ${fundingInWords(onCampaignPage)}; the Give page says ${fundingInWords(onGivePage)}.`
			).toEqual(onCampaignPage);
		}
		say(
			testInfo,
			`${id}: the campaign page says ${fundingInWords(onCampaignPage)}; the Give page says ${fundingInWords(onGivePage)}.`
		);
	}
});
