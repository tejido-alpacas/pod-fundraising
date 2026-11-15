/**
 * THE PAID STORY: THE ONE PLACE A TEST MOVES MONEY. It runs only when E2E_PAID is exactly
 * `true`, which only the workflow sets, under its cap (CLAUDE.md, "Never move money to test
 * something").
 *
 * On a campaign this run created for itself (specs/create-campaign.spec.ts), it tells the paid
 * part of the story, each step through the App's chat and its review card, as a real filer:
 *
 *   1. the contractor files a work log        (a 0.10 deposit from the contractor's agent wallet)
 *   2. the contractor reports a milestone done (1.00, the contractor's)
 *   3. the confirmer confirms that milestone   (1.00, the confirmer's)
 *
 * and after each, finds the entry on the campaign's public pages as a donor would. The steps run
 * in order and stop at the first that does not pass: a claim is not filed after a failed work
 * log, and nothing is confirmed that was not claimed.
 *
 * One filing per step, never retried. Every way out says which of these happened (see
 * lib/filing.ts): nothing was filed; the filing is waiting for an approval in Qatom; the deposit
 * may have been paid; it is not known whether it went through; it was filed but incomplete; or it
 * was filed. A wallet that is short ends as a "top up" notice, not a failure.
 *
 * The assistant files with the Qatom tools whose names end in log_work and milestone_hit, shared
 * by every campaign; Tejido finds the campaign from the person's reporter code. Nothing here
 * names a tool to the assistant: a real person would not. It never calls `transfer` or
 * `/api/refunds`. A receipt may read "pending" or verified and nothing is refunded yet: nothing
 * here expects or waits for either.
 */
import type { Page } from '@playwright/test';
import { BUILD_MILESTONE, draftReport, draftWorkLog } from '../lib/chat.ts';
import { fileFromReview } from '../lib/filing.ts';
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';

needsSignIn();

// In order, and the rest are left out once one fails. Never retried: a retry would pay again.
test.describe.configure({ mode: 'serial', retries: 0 });
// Longer than everything in one step can take added together (four replies of the draft, the
// upload, the filing, the reply after it and the public pages), so the test's own clock never
// cuts in while money may be moving.
test.setTimeout(1_800_000);

const reference = (step: string) => `ref-${step}-${Date.now().toString(36)}`;

/** The paid story is told once per run, by the phone project, and only on a paid run. */
function paidStoryOnly(project: string, paid: boolean, retry: number): void {
	test.skip(
		!paid,
		'Not run: E2E_PAID is not "true", so no deposit was spent and nothing was filed.'
	);
	test.skip(project !== 'phone', 'One paid story per run: the phone project tells it.');
	// Belt and braces: a retry of a paid step would pay a second deposit.
	expect(retry, 'A paid step must never be retried.').toBe(0);
}

/** A donor opens the milestone's own page from the campaign's list of milestones. */
async function openBuildMilestone(page: Page, siteUrl: string, campaignId: string): Promise<void> {
	await page.goto(`${siteUrl}/campaigns/${campaignId}/milestones`);
	await page
		.getByRole('main')
		.locator(`a[href^="/campaigns/${campaignId}/milestones/"]`)
		.filter({ hasText: BUILD_MILESTONE })
		.first()
		.click();
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(BUILD_MILESTONE);
}

test('files one work log for a real deposit and finds it on the timeline', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	paidStoryOnly(testInfo.project.name, cfg.paid, testInfo.retry);

	const ref = reference('log');
	const card = await draftWorkLog(page, cfg, ref, waypoint);
	await waypoint(page, 'review-before-filing');
	await fileFromReview(page, cfg, waypoint, card, ref, {
		what: 'work log',
		who: 'contractor',
		deposit: '0.10'
	});
});

test('reports a milestone as done for a real deposit, and donors see it reported', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	paidStoryOnly(testInfo.project.name, cfg.paid, testInfo.retry);

	const ref = reference('claim');
	const card = await draftReport(
		page,
		cfg,
		{
			opening:
				`I want to report a milestone as done: the one called "${BUILD_MILESTONE}". It is ` +
				'completed. This is an automated test of the app, not real work. Use this note word ' +
				`for word: "Automated end-to-end check ${ref}. A test claim, not real work." ` +
				'I will attach one photo next. Do not file anything yet.',
			photo: true
		},
		waypoint
	);
	await waypoint(page, 'review-before-filing');
	await fileFromReview(page, cfg, waypoint, card, ref, {
		what: 'milestone claim',
		who: 'contractor',
		deposit: '1.00'
	});

	// Donors now see the milestone as reported done, and not yet confirmed.
	await openBuildMilestone(page, cfg.siteUrl, cfg.campaignId);
	await expect(page.getByText('Claimed complete', { exact: true }).first()).toBeVisible();
	await waypoint(page, 'milestone-claimed');
});

test.describe('as the confirmer', () => {
	test.use({ storageState: CONFIRMER_STATE });

	test('confirms the milestone for a real deposit, and donors see it confirmed', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidStoryOnly(testInfo.project.name, cfg.paid, testInfo.retry);

		const ref = reference('confirm');
		const card = await draftReport(
			page,
			cfg,
			{
				opening:
					`I want to confirm the milestone called "${BUILD_MILESTONE}". It was reported as ` +
					'done and I have seen it myself. This is an automated test of the app, not a ' +
					'confirmation of real work. Use this note word for word: "Automated end-to-end ' +
					`check ${ref}. A test confirmation, not real work." Do not file anything yet.`,
				photo: false
			},
			waypoint
		);
		await waypoint(page, 'review-before-filing');
		await fileFromReview(page, cfg, waypoint, card, ref, {
			what: 'confirmation',
			who: 'confirmer',
			deposit: '1.00'
		});

		// Donors now see the milestone as confirmed.
		await openBuildMilestone(page, cfg.siteUrl, cfg.campaignId);
		await expect(page.getByText('Confirmed', { exact: true }).first()).toBeVisible();
		await expect(page.getByText('Claimed complete', { exact: true })).toHaveCount(0);
		await waypoint(page, 'milestone-confirmed');
	});
});
