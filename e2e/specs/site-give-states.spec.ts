/**
 * Giving is offered only while a campaign is raising money. This walks a campaign in every
 * OTHER state the live site has and checks that none offers a way to give: no "Give to this
 * campaign" on its page, and a Give page that says it is not raising money and has no button.
 *
 * Which states the site has is read from Explore, where every card begins with its status. A
 * draft is never listed there; the suite's own draft campaign is checked in
 * `site-give.spec.ts`. The example campaign the local database is seeded with (`library-wing`,
 * in the state "reporting") is checked too if the site under test has it.
 *
 * Reads only. Each part is skipped, saying why, when the site has nothing to look at.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import { GIVE, amountButtons, campaignIdOf, giveWords } from '../lib/give-page.ts';
import { whole } from '../lib/site-words.ts';

test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

/** Explore's status for a campaign that is raising money, in English. */
const RAISING = 'Fundraising';
/** The other four, as Explore words them in English. */
const NOT_RAISING = ['Funded', 'Work under way', 'A report is overdue', 'Delivered'];
/** The example campaign in packages/contracts/src/fixtures.ts. Its status there: reporting. */
const EXAMPLE_CAMPAIGN = 'library-wing';

/** The campaign at `id` offers no way to give: not on its page, not on its Give page. */
async function expectNoWayToGive(page: Page, siteUrl: string, id: string): Promise<string> {
	await page.goto(`${siteUrl}/campaigns/${id}`);
	const heading = page.getByRole('heading', { level: 1 });
	await expect(heading).toBeVisible();
	const title = (await heading.innerText()).trim();
	await expect(page.getByRole('link', { name: 'Give to this campaign' })).toHaveCount(0);
	await expect(page.locator(`a[href="/give/${id}"]`)).toHaveCount(0);

	// Its Give page, opened by its address, says so and has nothing to press.
	const response = await page.goto(`${siteUrl}/give/${id}`);
	expect(response?.status(), `The Give page of ${id} should open.`).toBe(200);
	const main = page.getByRole('main');
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(`Give to ${title}`);
	await expect(main.getByText(whole(giveWords('en', GIVE.notRaising)))).toBeVisible();
	await expect(amountButtons(page)).toHaveCount(0);
	await expect(main.getByRole('button')).toHaveCount(0);
	await expect(main.locator('form')).toHaveCount(0);
	await expect(main.getByText(whole(giveWords('en', GIVE.notAvailable)))).toHaveCount(0);
	await expect(main.getByRole('link', { name: /Back to the campaign/ })).toHaveAttribute(
		'href',
		`/campaigns/${id}`
	);
	return title;
}

test('a campaign in each state other than raising money offers no way to give', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	// The suite's browser asks for English. Every card on Explore begins with its status.
	await page.goto(`${cfg.siteUrl}/explore`);
	const main = page.getByRole('main');
	await expect(main.getByText(/^\s*(1 result|\d+ results)\s*$/)).toBeVisible();

	/** The first campaign listed in each state. */
	const first = new Map<string, string>();
	let raising = 0;
	for (const card of await main.getByRole('article').all()) {
		const text = (await card.innerText()).trim();
		const address = await card.locator('a[href^="/campaigns/"]').first().getAttribute('href');
		if (address === null) continue;
		if (text.startsWith(RAISING)) raising += 1;
		const status = NOT_RAISING.find((candidate) => text.startsWith(candidate));
		if (status !== undefined && !first.has(status)) first.set(status, address);
	}
	const missing = NOT_RAISING.filter((status) => !first.has(status));
	test.skip(
		first.size === 0,
		`Explore lists no campaign that is past raising money (${raising} raising money), so there is none to check.`
	);

	for (const [status, address] of first) {
		const id = campaignIdOf(address);
		const title = await expectNoWayToGive(page, cfg.siteUrl, id);
		await waypoint(page, `give-closed-${status.toLowerCase().replace(/[^a-z]+/g, '-')}`);
		testInfo.annotations.push({
			type: 'found',
			description: `"${status}": "${title}" has no Give button, and its Give page says it is not raising money.`
		});
	}
	if (missing.length > 0) {
		testInfo.annotations.push({
			type: 'not checked',
			description: `No campaign on the site is in these states now: ${missing.join(', ')}.`
		});
	}
});

test('the example campaign, which is reporting on its work, offers no way to give', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	const response = await page.goto(`${cfg.siteUrl}/campaigns/${EXAMPLE_CAMPAIGN}`);
	test.skip(
		response?.status() === 404,
		`The site has no campaign "${EXAMPLE_CAMPAIGN}": it is the example a local database is seeded with.`
	);
	expect(response?.status(), 'The example campaign’s page should open.').toBe(200);
	const title = await expectNoWayToGive(page, cfg.siteUrl, EXAMPLE_CAMPAIGN);
	await waypoint(page, 'give-closed-example');
	testInfo.annotations.push({
		type: 'found',
		description: `"${title}" has no Give button, and its Give page says it is not raising money.`
	});
});
