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
	await waypoint(page, 'proof');
});

test('the milestones', async ({ page, cfg, waypoint }) => {
	const base = `/campaigns/${cfg.campaignId}/milestones`;
	await page.goto(`${cfg.siteUrl}${base}`);
	await expect(page.getByRole('heading', { level: 1, name: 'Milestones' })).toBeVisible();
	await waypoint(page, 'milestones');

	await page.locator(`a[href^="${base}/"]`).first().click();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await waypoint(page, 'milestone');
});

test('the delivery report', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}/report`);
	await expect(page).toHaveTitle(/^Delivery report · /);
	await expect(page.getByRole('heading', { name: 'The original goal' })).toBeVisible();
	await waypoint(page, 'report');
});
