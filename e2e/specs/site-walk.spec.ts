/**
 * Walks the Campaign Site as a donor would, signed out: the test campaign's overview, its
 * milestones, its delivery report, and the proof page of its newest entry if it has one.
 * Reads only.
 */
import { expect, test } from '../lib/harness.ts';

// A donor has no session, and the App's cookie is for another host anyway.
test.use({ storageState: { cookies: [], origins: [] } });

test('the campaign overview', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What has happened' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Milestones', exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Who’s involved' })).toBeVisible();
	// The campaign's own three tabs.
	const base = `/campaigns/${cfg.campaignId}`;
	for (const [name, path] of [
		[/^Timeline/, base],
		[/^Milestones/, `${base}/milestones`],
		[/^Report/, `${base}/report`]
	] as const) {
		await expect(page.locator(`a[href="${path}"]`).filter({ hasText: name }).first()).toBeVisible();
	}
	// Either entries, each with a way to its proof, or the page saying there are none yet.
	const timeline = page.locator('section[aria-labelledby="timeline"]');
	await expect(
		timeline
			.getByRole('link', { name: /View proof/ })
			.first()
			.or(timeline.getByText('No updates yet'))
	).toBeVisible();
	await waypoint(page, 'overview');
});

test('a proof page', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
	const proof = page.getByRole('link', { name: /View proof/ }).first();
	test.skip(
		(await proof.count()) === 0,
		'The test campaign has no entry yet, so there is no proof page to open. The first paid run files one.'
	);
	await proof.click();
	await expect(page.getByRole('heading', { name: 'What was reported' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Evidence' })).toBeVisible();
	await waypoint(page, 'proof');
});

test('the milestones', async ({ page, cfg, waypoint }) => {
	const base = `/campaigns/${cfg.campaignId}/milestones`;
	await page.goto(`${cfg.siteUrl}${base}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Milestones' })).toBeVisible();
	await waypoint(page, 'milestones');

	// The test campaign has three milestones, each with a page of its own.
	const links = page.getByRole('main').locator(`a[href^="${base}/"]`);
	await expect(links.first()).toBeVisible();
	const pages = new Set(
		await links.evaluateAll((all) => all.map((link) => link.getAttribute('href')))
	);
	expect(pages.size, 'Each milestone should link to its own page.').toBeGreaterThanOrEqual(3);

	await links.first().click();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Planned and reported' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'History' })).toBeVisible();
	await waypoint(page, 'milestone');
});

test('the delivery report', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}/report`);
	await expect(page).toHaveTitle(/^Delivery report · /);
	await expect(page.getByRole('heading', { name: 'The original goal' })).toBeVisible();
	await waypoint(page, 'report');
});
