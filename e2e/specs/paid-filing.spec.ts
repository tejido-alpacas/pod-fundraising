/**
 * THE PAID STORY: WHERE A TEST MOVES MONEY. It runs only when E2E_PAID is exactly `true`,
 * which only the workflow sets, on a run a person started by hand with "paid" ticked (CLAUDE.md,
 * "Never move money to test something"). A run that follows a release never moves money. Never
 * set E2E_PAID yourself, and never run this suite from a session.
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
 * `/api/refunds`.
 *
 * AFTER THE FILINGS, two further steps only read the public pages, as a donor who is not signed
 * in, and say what they find. Each is its own named step, and each runs whatever became of the
 * other, so the report says which of "verified" and "returned" was reached:
 *
 *   4. within 4 minutes, each entry's proof page answers "Yes · receipt verified"
 *   5. within 4 more minutes, each entry's proof page shows "Deposit refunded"
 *
 * Tejido matches receipts by itself on a timer; the owner returns test deposits by hand.
 * Nothing here asks for either: the suite never calls
 * /api/reconcile, /api/refunds or /api/test-account-refunds. A wait that runs out is a failure
 * of that step alone, with the filings already recorded as passed above it.
 */
import type { Page } from '@playwright/test';
import { BUILD_MILESTONE, draftReport, draftWorkLog } from '../lib/chat.ts';
import { fileFromReview } from '../lib/filing.ts';
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { expectMilestoneStatus, milestoneStatus, openMilestone } from '../lib/milestone-page.ts';
import {
	DEPOSIT_REFUNDED,
	readPaidEntries,
	readProof,
	recordPaidEntry,
	RECEIPT_VERIFIED,
	type PaidEntry,
	type SeenProof
} from '../lib/paid-entries.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';

needsSignIn();

// Never retried: a retry would pay again.
test.describe.configure({ retries: 0 });
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

/** A donor opens the build milestone's own page from the campaign's list of milestones. */
const openBuildMilestone = (page: Page, siteUrl: string, campaignId: string): Promise<void> =>
	openMilestone(page, siteUrl, campaignId, BUILD_MILESTONE);

/** How long each of the two waits after the filings may last. */
const WAIT_MS = 240_000;
/** How long between two looks at the public pages. Tejido's timer runs once a minute. */
const LOOK_EVERY_MS = 15_000;

/**
 * Looks at every entry's proof page, again and again, until each shows `wanted` or the wait
 * runs out. Gives one line per entry: when it was reached, or what the page showed last.
 */
async function waitOnProofPages(
	page: Page,
	siteUrl: string,
	entries: PaidEntry[],
	wanted: (seen: SeenProof) => boolean,
	shown: (seen: SeenProof) => string
): Promise<{ all: boolean; lines: string[] }> {
	const started = Date.now();
	const reached = new Map<PaidEntry, number>();
	const last = new Map<PaidEntry, SeenProof>();
	for (;;) {
		for (const entry of entries) {
			if (reached.has(entry)) continue;
			const seen = await readProof(page, siteUrl, entry);
			last.set(entry, seen);
			if (wanted(seen)) reached.set(entry, Math.round((Date.now() - started) / 1000));
		}
		if (reached.size === entries.length || Date.now() - started >= WAIT_MS) break;
		await new Promise((resolve) => setTimeout(resolve, LOOK_EVERY_MS));
	}
	const lines = entries.map((entry) => {
		const seen = last.get(entry);
		const words = seen === undefined ? 'not read' : shown(seen);
		const seconds = reached.get(entry);
		return seconds === undefined
			? `the ${entry.what}: NOT REACHED, the page still shows "${words}"`
			: `the ${entry.what}: "${words}" after ${seconds} seconds`;
	});
	return { all: reached.size === entries.length, lines };
}

/** Which of the three filings this run recorded, in words. */
function filedInThisRun(entries: PaidEntry[]): string {
	return entries.length === 3
		? 'All three filings were recorded as filed before this step.'
		: `Only ${entries.length} of the three filings were recorded as filed in this run ` +
				`(${entries.map((entry) => entry.what).join(', ')}).`;
}

test.describe('the three filings', () => {
	// In order, and the rest are left out once one fails. A step that is left out without
	// failing (a wallet that is short) leaves out the ones after it too: each looks first.
	test.describe.configure({ mode: 'serial' });

	test('files one work log for a real deposit and finds it on the timeline', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidStoryOnly(testInfo.project.name, cfg.paid, testInfo.retry);

		const ref = reference('log');
		const card = await draftWorkLog(page, cfg, ref, waypoint);
		await waypoint(page, 'review-before-filing');
		const { proofPath } = await fileFromReview(page, cfg, waypoint, card, ref, {
			what: 'work log',
			who: 'contractor',
			deposit: '0.10'
		});
		recordPaidEntry({ campaignId: cfg.campaignId, what: 'work log', proofPath });
	});

	test('reports a milestone as done for a real deposit, and donors see it reported', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidStoryOnly(testInfo.project.name, cfg.paid, testInfo.retry);

		// A step left out (a wallet that is short) does not stop the ones after it, so each step
		// first sees for itself that the one before it happened. Nothing is paid otherwise.
		test.skip(
			!readPaidEntries(cfg.campaignId).some((entry) => entry.what === 'work log'),
			'Not filed, and nothing was paid: this run did not see its work log on the public ' +
				'timeline, so the story stops here and no milestone is claimed.'
		);

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
		const { proofPath } = await fileFromReview(page, cfg, waypoint, card, ref, {
			what: 'milestone claim',
			who: 'contractor',
			deposit: '1.00'
		});
		recordPaidEntry({ campaignId: cfg.campaignId, what: 'milestone claim', proofPath });

		// Donors now see the milestone as reported done, and not yet confirmed.
		await openBuildMilestone(page, cfg.siteUrl, cfg.campaignId);
		await expectMilestoneStatus(page, 'Claimed complete');
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

			// Never confirm a milestone nobody claimed: the claim may have been left out (a wallet
			// that is short). Look at the public page first, before anything can be paid.
			await openBuildMilestone(page, cfg.siteUrl, cfg.campaignId);
			const status = await milestoneStatus(page);
			const claimed = status === 'Claimed complete';
			test.skip(
				!claimed ||
					!readPaidEntries(cfg.campaignId).some((entry) => entry.what === 'milestone claim'),
				'Not filed, and nothing was paid: ' +
					(!claimed
						? `the milestone’s public page says "${status}", not "Claimed complete"`
						: 'this run did not see its own claim on the public timeline') +
					', so there is nothing to confirm.'
			);

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
			const { proofPath } = await fileFromReview(page, cfg, waypoint, card, ref, {
				what: 'confirmation',
				who: 'confirmer',
				deposit: '1.00'
			});
			recordPaidEntry({ campaignId: cfg.campaignId, what: 'confirmation', proofPath });

			// Donors now see the milestone as confirmed.
			await openBuildMilestone(page, cfg.siteUrl, cfg.campaignId);
			await expectMilestoneStatus(page, 'Confirmed');
			await waypoint(page, 'milestone-confirmed');
		});
	});
});

test.describe('after the filings, as a donor who is not signed in', () => {
	test.use({ storageState: { cookies: [], origins: [] } });

	test('the entries’ receipts read verified within 4 minutes', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidStoryOnly(testInfo.project.name, cfg.paid, testInfo.retry);
		test.setTimeout(WAIT_MS + 180_000);
		const entries = readPaidEntries(cfg.campaignId);
		test.skip(
			entries.length === 0,
			'Not checked: no entry was recorded as filed in this run, so there is no receipt to wait for.'
		);

		const { all, lines } = await waitOnProofPages(
			page,
			cfg.siteUrl,
			entries,
			(seen) => seen.receipt === RECEIPT_VERIFIED,
			(seen) => seen.receipt
		);
		console.log(`Receipts, as the public proof pages show them: ${lines.join('; ')}.`);
		await waypoint(page, 'receipts-after-the-wait');
		if (!all) {
			throw new Error(
				`RECEIPTS NOT ALL VERIFIED within ${WAIT_MS / 60_000} minutes of the last filing. ` +
					`${filedInThisRun(entries)} The filings themselves are not in doubt: this step only ` +
					`waits for Tejido to match each one to its public receipt. ${lines.join('; ')}.`
			);
		}
	});

	test('the deposits show as returned within 4 more minutes', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		paidStoryOnly(testInfo.project.name, cfg.paid, testInfo.retry);
		test.setTimeout(WAIT_MS + 180_000);
		const entries = readPaidEntries(cfg.campaignId);
		test.skip(
			!entries.some((entry) => entry.what === 'confirmation'),
			'Not checked: the confirmation was not recorded as filed in this run, so the milestone ' +
				'is not confirmed and no deposit is due back.'
		);

		const { all, lines } = await waitOnProofPages(
			page,
			cfg.siteUrl,
			entries,
			(seen) => seen.deposit === DEPOSIT_REFUNDED,
			(seen) => seen.deposit
		);
		console.log(`Deposits, as the public proof pages show them: ${lines.join('; ')}.`);
		await waypoint(page, 'deposits-after-the-wait');
		if (!all) {
			throw new Error(
				`DEPOSITS NOT ALL SHOWN AS RETURNED within ${WAIT_MS / 60_000} more minutes. ` +
					`${filedInThisRun(entries)} The filings themselves are not in doubt: this step only ` +
					'waits for the public pages to show each deposit as refunded to the test person. ' +
					`${lines.join('; ')}. Before more paid runs, look at the two test people’s agent ` +
					'wallets: deposits that do not come back have to be topped up by hand.'
			);
		}
	});
});
