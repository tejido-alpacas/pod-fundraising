/**
 * MORE OF THE PAID STORY. LIKE specs/paid-filing.spec.ts, THIS FILE MOVES MONEY. It runs only
 * when E2E_PAID is exactly `true`, which only the workflow sets, under its cap (CLAUDE.md,
 * "Never move money to test something"). Nobody starts it by hand.
 *
 * It runs on the same campaign the run created, on the two milestones the first paid story
 * leaves alone, and after that story has ended: that story is told by the phone project and
 * this one by the DESKTOP project, which comes after it. So that story's result never depends
 * on anything here.
 *
 * Why the desktop project: this file ends with all three milestones confirmed, and a campaign
 * with nothing left to report changes what the App shows a signed-in person (the report form
 * offers no milestone, there is nothing to confirm). The desktop project's checks of the App
 * run before this file ("app-" and "chat-" sort before "paid-more"); told on the phone, this
 * file would run before them and they would fail. Only the donor's pages are walked after it.
 *
 * Three scenarios, each through the App's chat and its review card as a real filer, each found
 * afterwards on the campaign's public pages as a donor would find it:
 *
 *   A work log sent from the chat's report form, on "Test milestone 2: a delivery":
 *     0. the contractor fills in the form, sends it, reviews it on the card and files it
 *        (0.10 from the contractor's agent wallet). The first paid story drafts by talking
 *
 *   A delivery, on "Test milestone 2: a delivery" (a goods delivery: claimed with "delivered",
 *   a quantity, a unit and a photo):
 *     1. the contractor reports the delivery  (1.00 from the contractor's agent wallet)
 *     2. the confirmer confirms it            (1.00 from the confirmer's)
 *
 *   A report that arrives incomplete and is then fixed, on "Test milestone 1: work" (a service:
 *   claimed with "completed", documents only, and the claim needs one document):
 *     3. the contractor reports it done with no document (1.00, the contractor's). Tejido
 *        saves it, marks it incomplete, and the milestone is claimed all the same
 *     4. the contractor adds the document on the App's fix page. Nothing is paid
 *     5. the confirmer confirms the milestone  (1.00, the confirmer's)
 *
 * That adds 4.10 to a paid run: 2.10 from the test contractor's agent wallet and 2.00 from
 * the test confirmer's. No filing is more than 1.00, the most the test people's Qatom accounts
 * approve by themselves.
 *
 * The rules, the same as the first paid story's:
 * - One filing per step, never retried. Each scenario stops at its first step that does not
 *   pass; the other scenarios still run.
 * - Before every filing the step looks at the public pages, and files nothing unless donors
 *   see what the step needs: nothing here files unless the first paid story ended with its
 *   milestone confirmed, nothing is claimed twice, and nothing is confirmed that donors do not
 *   see as claimed. A step that was skipped (a wallet to top up) therefore stops the ones
 *   after it too.
 * - Every filing goes through lib/filing.ts, so every way out says which of these happened:
 *   nothing was filed, it is waiting for an approval, the deposit may have been paid, it is
 *   not known, or it was filed.
 * - Nothing here names a tool to the assistant, calls `transfer`, `/api/refunds` or any
 *   address that needs a secret, or holds one. No receipt and no refund is waited for.
 */
import type { Locator, Page, TestInfo } from '@playwright/test';
import { BUILD_MILESTONE, draftReport } from '../lib/chat.ts';
import type { E2eConfig } from '../lib/config.ts';
import { testDocumentFile } from '../lib/files.ts';
import { fileFromReview } from '../lib/filing.ts';
import { expect, needsSignIn, test } from '../lib/harness.ts';
import {
	expectMilestoneStatus,
	milestoneStatus,
	openMilestone,
	type MilestoneStatus
} from '../lib/milestone-page.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';
import { chooseFormMilestone, openReportForm, sendFormForReview } from '../lib/report-form.ts';
import { readRunCampaign } from '../lib/run-campaign.ts';

needsSignIn();

// Never retried: a retry would pay again. Each scenario below is serial in itself.
test.describe.configure({ retries: 0 });
// As in the first paid story: longer than everything in one step can take added together, so
// the test's own clock never cuts in while money may be moving.
test.setTimeout(1_800_000);

/** The run's campaign's other two milestones, as lib/run-campaign.ts titles them. */
const WORK_MILESTONE = 'Test milestone 1: work';
const DELIVERY_MILESTONE = 'Test milestone 2: a delivery';

/** What the delivery says was delivered. A delivery needs both, or it is saved incomplete. */
const QUANTITY = '12';
const UNIT = 'boxes';

/** What Tejido says a service claim with no document is missing (packages/db checkin-rules). */
const DOCUMENT_OWED = 'needs at least one document';

const NOTHING = 'Not run, so nothing was filed and no deposit was spent: ';

const reference = (step: string) => `ref-${step}-${Date.now().toString(36)}`;

/** Told once per run, by the desktop project, on a paid run that created its own campaign. */
function paidRunOnly(testInfo: TestInfo, cfg: E2eConfig): void {
	test.skip(!cfg.paid, `${NOTHING}E2E_PAID is not "true".`);
	test.skip(
		testInfo.project.name !== 'desktop',
		'Told once per run, by the desktop project, after its checks of the App.'
	);
	test.skip(
		readRunCampaign() === null,
		`${NOTHING}this run has no campaign of its own to file on.`
	);
	// Belt and braces: a retry of a paid step would pay a second deposit.
	expect(testInfo.retry, 'A paid step must never be retried.').toBe(0);
}

/** A donor opens one milestone's own page and reads its status, with the shared reader. */
async function milestoneAsDonorsSeeIt(page: Page, cfg: E2eConfig, title: string): Promise<string> {
	await openMilestone(page, cfg.siteUrl, cfg.campaignId, title);
	return milestoneStatus(page);
}

/** After a filing: donors see `title` as `wanted`. */
async function donorsNowSee(
	page: Page,
	cfg: E2eConfig,
	title: string,
	wanted: MilestoneStatus
): Promise<void> {
	await openMilestone(page, cfg.siteUrl, cfg.campaignId, title);
	await expectMilestoneStatus(page, wanted);
}

/**
 * Before a step files: donors must see `title` in one of `needed`. Otherwise the step is
 * skipped, saying so, and nothing is filed or paid.
 */
async function onlyWhenDonorsSee(
	page: Page,
	cfg: E2eConfig,
	title: string,
	needed: readonly MilestoneStatus[],
	why: string
): Promise<void> {
	const seen = await milestoneAsDonorsSeeIt(page, cfg, title);
	test.skip(
		!needed.some((status) => status === seen),
		`${NOTHING}donors see "${title}" as "${seen}", not "${needed.join('" or "')}". ${why}`
	);
}

/** A scenario's first filing: the first paid story ended well, and nobody claimed this yet. */
async function onlyOnAnUnclaimedMilestone(page: Page, cfg: E2eConfig, title: string) {
	await onlyWhenDonorsSee(
		page,
		cfg,
		BUILD_MILESTONE,
		['Confirmed'],
		'The first paid story (paid-filing) did not end with its milestone confirmed, so this run spends no more.'
	);
	await onlyWhenDonorsSee(
		page,
		cfg,
		title,
		['Not started', 'In progress'],
		'A milestone is claimed once.'
	);
}

/** The line of the review card whose label matches, e.g. the quantity. */
const cardRow = (card: Locator, label: RegExp) =>
	card.locator('.tj-kv__row').filter({ hasText: label });

/** The notice a proof page shows on an entry that is saved but incomplete. */
const incompleteNotice = (page: Page) =>
	page.getByRole('note').filter({ hasText: 'can add what is missing without paying again' });

/** The confirmer's conversation for one milestone, and its filing. */
async function confirmMilestone(
	page: Page,
	cfg: E2eConfig,
	waypoint: Parameters<typeof draftReport>[3],
	title: string,
	ref: string
): Promise<void> {
	const card = await draftReport(
		page,
		cfg,
		{
			opening:
				`I want to confirm the milestone called "${title}". It was reported as done and I ` +
				'have seen it myself. This is an automated test of the app, not a confirmation of ' +
				`real work. Use this note word for word: "Automated end-to-end check ${ref}. A test ` +
				'confirmation, not real work." Do not file anything yet.',
			photo: false
		},
		waypoint
	);
	await expect(
		card,
		'The review card is not about the milestone asked for. Nothing was filed.'
	).toContainText(title);
	await waypoint(page, 'review-before-filing');
	await fileFromReview(page, cfg, waypoint, card, ref, {
		what: 'confirmation',
		who: 'confirmer',
		deposit: '1.00'
	});
}

// ---------------------------------------------------------------------------
// A work log sent from the chat's report form
// ---------------------------------------------------------------------------

test.describe('a work log from the report form', () => {
	test.describe.configure({ mode: 'serial', retries: 0 });

	test('the contractor sends a work log from the report form, files it for a real deposit, and it is on the timeline', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidRunOnly(testInfo, cfg);
		await onlyOnAnUnclaimedMilestone(page, cfg, DELIVERY_MILESTONE);

		const ref = reference('form');
		const note = `Automated end-to-end check ${ref}. Sent from the report form. A test entry, not real work.`;

		// Filled in as a person would: which milestone, which report, how it is going, the note.
		const form = await openReportForm(page, cfg);
		await chooseFormMilestone(form, DELIVERY_MILESTONE);
		await form.getByRole('radio', { name: /^Work log/ }).check();
		await form.getByLabel(/^How the work is going/).selectOption({ label: 'On track' });
		await form.getByLabel(/^Percent complete/).fill('10');
		await form.getByLabel('What was done').fill(note);
		await waypoint(page, 'form-filled');

		const card = await sendFormForReview(page, form);
		// The conversation shows the form back, and the card carries its values.
		const sent = page.locator('.log .tj-msg--human .sent-form');
		await expect(sent).toContainText('Work log');
		await expect(sent).toContainText(DELIVERY_MILESTONE);
		await expect(sent).toContainText(ref);
		await expect(
			card,
			'The review card is not about the milestone the form named. Nothing was filed.'
		).toContainText(DELIVERY_MILESTONE);
		await expect(
			card,
			'The review card does not carry the note the form gave. Nothing was filed.'
		).toContainText(ref);
		await waypoint(page, 'review-before-filing');

		await fileFromReview(page, cfg, waypoint, card, ref, {
			what: 'work log',
			who: 'contractor',
			deposit: '0.10'
		});

		// Donors now see work reported on the milestone, and nobody has claimed it.
		await donorsNowSee(page, cfg, DELIVERY_MILESTONE, 'In progress');
		await waypoint(page, 'delivery-in-progress');
	});
});

// ---------------------------------------------------------------------------
// A delivery: claimed with a quantity, a unit and a photo, then confirmed
// ---------------------------------------------------------------------------

test.describe('a delivery', () => {
	test.describe.configure({ mode: 'serial', retries: 0 });

	test('the contractor reports a delivery for a real deposit, and donors see how many were delivered', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidRunOnly(testInfo, cfg);
		await onlyOnAnUnclaimedMilestone(page, cfg, DELIVERY_MILESTONE);

		const ref = reference('delivery');
		const card = await draftReport(
			page,
			cfg,
			{
				opening:
					`I want to report a delivery on the milestone called "${DELIVERY_MILESTONE}". It ` +
					`is delivered. Quantity: ${QUANTITY}. Unit: ${UNIT}. This is an automated test of ` +
					'the app, not a real delivery. Use this note word for word: "Automated end-to-end ' +
					`check ${ref}. A test delivery, not real goods." I will attach one photo next. Do ` +
					'not file anything yet.',
				photo: true
			},
			waypoint
		);
		// A delivery without its quantity and unit is paid for and then saved incomplete, and the
		// fix page cannot add either. So they must be on the card before anything is filed.
		await expect(
			card,
			'The review card is not about the milestone asked for. Nothing was filed.'
		).toContainText(DELIVERY_MILESTONE);
		await expect(
			cardRow(card, /quantity/i).first(),
			'The review card does not carry the quantity. Nothing was filed.'
		).toContainText(QUANTITY);
		await expect(card, 'The review card does not carry the unit. Nothing was filed.').toContainText(
			UNIT
		);
		await waypoint(page, 'review-before-filing');
		await fileFromReview(page, cfg, waypoint, card, ref, {
			what: 'delivery claim',
			who: 'contractor',
			deposit: '1.00'
		});

		// The proof page says how many were delivered, and of what.
		await expect(page.getByRole('main')).toContainText(`${QUANTITY} ${UNIT}`);

		// Donors now see the milestone as reported done, and not yet confirmed.
		await donorsNowSee(page, cfg, DELIVERY_MILESTONE, 'Claimed complete');
		await waypoint(page, 'delivery-claimed');
	});

	test.describe('as the confirmer', () => {
		test.use({ storageState: CONFIRMER_STATE });

		test('the confirmer confirms the delivery for a real deposit, and donors see it confirmed', async ({
			page,
			cfg,
			waypoint
		}, testInfo) => {
			paidRunOnly(testInfo, cfg);
			await onlyWhenDonorsSee(
				page,
				cfg,
				DELIVERY_MILESTONE,
				['Claimed complete'],
				'Only a claimed milestone is confirmed.'
			);

			await confirmMilestone(page, cfg, waypoint, DELIVERY_MILESTONE, reference('confirm2'));

			await donorsNowSee(page, cfg, DELIVERY_MILESTONE, 'Confirmed');
			await waypoint(page, 'delivery-confirmed');
		});
	});
});

// ---------------------------------------------------------------------------
// A claim that arrives incomplete, is completed on the fix page, then confirmed
// ---------------------------------------------------------------------------

test.describe('a report that arrives incomplete and is fixed', () => {
	test.describe.configure({ mode: 'serial', retries: 0 });

	/** The incomplete claim's reference and its public proof page, once it has been filed. */
	let filed: { ref: string; proofUrl: string } | null = null;

	test('the contractor reports a service done with no document for a real deposit, and it is saved incomplete', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidRunOnly(testInfo, cfg);
		await onlyOnAnUnclaimedMilestone(page, cfg, WORK_MILESTONE);

		const ref = reference('service');
		const card = await draftReport(
			page,
			cfg,
			{
				opening:
					`I want to report a milestone as done: the one called "${WORK_MILESTONE}". It is ` +
					'completed. This is an automated test of the app, not real work. I do not have its ' +
					'document with me today, so file it with no file. I know it will be saved as ' +
					'incomplete, and I will add the document afterwards on the page for fixing a ' +
					`report. Use this note word for word: "Automated end-to-end check ${ref}. A test ` +
					'claim, not real work." Do not file anything yet.',
				photo: false
			},
			waypoint
		);
		await expect(
			card,
			'The review card is not about the milestone asked for. Nothing was filed.'
		).toContainText(WORK_MILESTONE);
		await waypoint(page, 'review-before-filing');

		// A report that lands incomplete is the ending expected here, so the shared filing is
		// told so: it comes back saying which it was, with the browser on the proof page.
		const { proofPath, incomplete } = await fileFromReview(page, cfg, waypoint, card, ref, {
			what: 'milestone claim',
			who: 'contractor',
			deposit: '1.00',
			incompleteExpected: true
		});
		expect(
			incomplete,
			`The milestone claim "${ref}" was filed and its deposit paid, and it is NOT marked ` +
				'incomplete, though a service claim needs a document and this one was to carry none. ' +
				'Either the assistant attached a file, or the rule has changed. Do not file again.'
		).toBe(true);

		// Either way the browser is on the entry's public proof page. Donors are told what is missing.
		await expect(page.getByRole('main')).toContainText(ref);
		await expect(
			incompleteNotice(page),
			'The claim is incomplete for another reason than its missing document, so the fix page ' +
				'may not be able to complete it. It was filed and its deposit paid. Do not file again.'
		).toContainText(DOCUMENT_OWED);
		filed = { ref, proofUrl: `${cfg.siteUrl}${proofPath}` };
		await waypoint(page, 'proof-says-incomplete');

		// A claim moves its milestone to claimed whether or not it is complete.
		await donorsNowSee(page, cfg, WORK_MILESTONE, 'Claimed complete');
		await waypoint(page, 'service-claimed');
	});

	test('the contractor adds the document on the fix page, pays nothing, and donors no longer see it incomplete', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidRunOnly(testInfo, cfg);
		const claim = filed;
		test.skip(claim === null, 'Not run: no incomplete claim was filed by the step before.');
		if (claim === null) return;

		// The fix page opens the one incomplete report at once, or lists several to choose from.
		await page.goto(`${cfg.appUrl}/fix`);
		const heading = page.getByRole('heading', { level: 1 });
		await expect(heading).toHaveText(
			/^(Choose the report to fix|Add what is missing to finish .+)$/
		);
		if ((await heading.innerText()).trim() === 'Choose the report to fix') {
			await waypoint(page, 'fix-choose');
			await page
				.locator('a[href^="?entry="]')
				.filter({ hasText: WORK_MILESTONE })
				.filter({ hasText: 'Milestone reported as done' })
				.first()
				.click();
		}
		await expect(heading).toHaveText('Add what is missing to finish your milestone report');

		// It is this run's claim, marked incomplete, with its deposit recorded and no file yet.
		const main = page.getByRole('main');
		await expect(main).toContainText(claim.ref);
		await expect(main.locator('.tj-badges')).toContainText('Incomplete');
		await expect(main.locator('.tj-badges')).toContainText('Deposit recorded');
		await expect(main.locator('.tj-checklist .is-missing')).toContainText(DOCUMENT_OWED);
		await expect(page.getByText('No files attached yet')).toBeVisible();
		await expect(page.getByText('You won’t pay the deposit again.')).toBeVisible();
		// A service takes documents only: the page offers no camera.
		await expect(page.getByText('Take a photo')).toHaveCount(0);
		await waypoint(page, 'fix-incomplete');

		// Add the test document and save. This buys nothing: the page never reaches Qatom.
		const document = testDocumentFile();
		await page.locator('#fix input[type="file"]').setInputFiles(document);
		await page.getByRole('button', { name: 'Save to this report' }).click();

		const saved = page.getByRole('status').filter({ hasText: 'Saved' });
		await expect(saved).toBeVisible({ timeout: 60_000 });
		await waypoint(page, 'fix-saved');
		await expect(
			saved,
			'The document was saved, and the report is still incomplete. The page says why.'
		).toContainText(`Your report on “${WORK_MILESTONE}” is no longer incomplete.`);
		await expect(saved).toContainText('1 file added to the same report.');
		await expect(saved).toContainText('No new deposit was paid.');
		// Nothing is left to fix on this campaign, as far as this claim goes.
		await expect(main).not.toContainText(claim.ref);

		// As a donor: the proof page no longer says anything is missing.
		await page.goto(claim.proofUrl);
		await expect(page.getByRole('heading', { name: 'What was reported' })).toBeVisible();
		await expect(page.getByRole('main')).toContainText(claim.ref);
		await expect(incompleteNotice(page)).toHaveCount(0);
		await waypoint(page, 'proof-no-longer-incomplete');

		// Nor does the campaign's timeline.
		await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
		const entry = page
			.locator('section[aria-labelledby="timeline"]')
			.getByRole('article')
			.filter({ hasText: claim.ref });
		await expect(entry).toBeVisible();
		await expect(entry).not.toContainText('Incomplete');
		await expect(entry).not.toContainText(DOCUMENT_OWED);
		await waypoint(page, 'timeline-no-longer-incomplete');
	});

	test.describe('as the confirmer', () => {
		test.use({ storageState: CONFIRMER_STATE });

		test('the confirmer confirms the service for a real deposit, and donors see it confirmed', async ({
			page,
			cfg,
			waypoint
		}, testInfo) => {
			paidRunOnly(testInfo, cfg);
			await onlyWhenDonorsSee(
				page,
				cfg,
				WORK_MILESTONE,
				['Claimed complete'],
				'Only a claimed milestone is confirmed.'
			);

			await confirmMilestone(page, cfg, waypoint, WORK_MILESTONE, reference('confirm1'));

			await donorsNowSee(page, cfg, WORK_MILESTONE, 'Confirmed');
			await waypoint(page, 'service-confirmed');
		});
	});
});
