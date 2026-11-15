/**
 * A milestone's own public page on the Campaign Site, as a donor reads it: opening it from the
 * campaign's list of milestones, and reading the milestone's status.
 *
 * The status is the first badge under the page's heading. Its words are the labels of the
 * milestone states in `packages/ui/src/states.ts`. The badge carries the words "Milestone: " in
 * front of the label for screen readers, so the badge's whole text is, for example, "Milestone:
 * Claimed complete": never look for the label as an element's exact text.
 */
import { expect, type Page } from '@playwright/test';

/** The four states a milestone's own page can show, in the page's words. */
export const MILESTONE_STATUSES = [
	'Not started',
	'In progress',
	'Claimed complete',
	'Confirmed'
] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];

/** A donor opens a milestone's own page from the campaign's list of milestones, by its title. */
export async function openMilestone(
	page: Page,
	siteUrl: string,
	campaignId: string,
	title: string
): Promise<void> {
	await page.goto(`${siteUrl}/campaigns/${campaignId}/milestones`);
	await page
		.getByRole('main')
		.locator(`a[href^="/campaigns/${campaignId}/milestones/"]`)
		.filter({ hasText: title })
		.first()
		.click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(title);
}

/**
 * The status the open milestone page shows: one of MILESTONE_STATUSES, or the badge's own words
 * when it shows something else (so a failure can quote them).
 */
export async function milestoneStatus(page: Page): Promise<string> {
	const badge = page.locator('.tj-msstatus .tj-badge').first();
	await expect(badge, 'The milestone page shows no status badge under its heading.').toBeVisible();
	const words = (await badge.innerText()).replace(/\s+/g, ' ').trim();
	const label = words.replace(/^Milestone:\s*/, '');
	return MILESTONE_STATUSES.find((status) => status === label) ?? words;
}

/** Waits for the open milestone page to show `wanted`, reloading it: the page is not live. */
export async function expectMilestoneStatus(page: Page, wanted: MilestoneStatus): Promise<void> {
	await expect
		.poll(
			async () => {
				const seen = await milestoneStatus(page);
				if (seen !== wanted) await page.reload();
				return seen;
			},
			{
				message: `The milestone's public page should show the status "${wanted}".`,
				timeout: 30_000,
				intervals: [2_000]
			}
		)
		.toBe(wanted);
}
