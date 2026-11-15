/**
 * THE ONE PLACE A TEST MOVES MONEY. It runs only when E2E_PAID is exactly `true`.
 *
 * It holds the same conversation as `chat-draft`, then presses "File this entry": the
 * assistant buys the campaign's work-log item as the contractor, which pays a real 0.10 deposit
 * from the contractor's own Qatom agent wallet. Then it finds the entry on the public timeline.
 *
 * One filing per run, never retried. If the page cannot say whether the filing went through,
 * the spec fails saying exactly that. It does not file again, and neither should a person until
 * they have looked.
 */
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { draftWorkLog } from '../lib/chat.ts';
import { until } from '../lib/harness.ts';

needsSignIn();

test.describe.configure({ retries: 0 });
test.setTimeout(1_200_000);

const FILING_MS = 300_000;
const UNKNOWN =
	'IT IS NOT KNOWN WHETHER THE FILING WENT THROUGH. The deposit may have been paid. Do not run the ' +
	'paid spec again until you have looked at the test campaign’s public page and the contractor’s wallet.';

test('files one work log for a real deposit and finds it on the timeline', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	test.skip(
		!cfg.paid,
		'Not run: E2E_PAID is not "true", so no deposit was spent and nothing was filed.'
	);
	test.skip(testInfo.project.name !== 'phone', 'One filing per run: the phone project makes it.');
	// Belt and braces: a retry of this test would pay a second deposit.
	expect(testInfo.retry, 'The paid spec must never be retried.').toBe(0);

	const reference = `ref-${Date.now().toString(36)}`;
	const card = await draftWorkLog(page, cfg, reference, waypoint);
	await waypoint(page, 'review-before-filing');

	// From here on, money may have moved. Every way out says what is and is not known.
	const bubbles = page.locator('.log .tj-msg--assistant');
	const before = await bubbles.count();
	await card.getByRole('button', { name: 'File this entry' }).click();

	const log = page.getByLabel('Conversation');
	let outcome: 'submitted' | 'problem' | 'unknown' | 'not_sent';
	try {
		outcome = await until('the filing to be answered', FILING_MS, async () => {
			if (await log.getByText('know if this was filed').isVisible()) return 'unknown';
			if (
				await log
					.getByText(/Submitted at \d/)
					.first()
					.isVisible()
			)
				return 'submitted';
			if (await log.getByText('came back with a problem').isVisible()) return 'problem';
			// The reply ended and the page drew no filing at all.
			const ended = await page.getByRole('button', { name: 'Send', exact: true }).isVisible();
			const working = await log
				.getByText(/Sending the filing|Working on a reply|Checking with Qatom/)
				.isVisible();
			return ended && !working && (await bubbles.count()) > before ? 'not_sent' : null;
		});
	} catch {
		await waypoint(page, 'filing-timed-out');
		throw new Error(`The page showed no answer within ${FILING_MS / 1000} seconds. ${UNKNOWN}`);
	}
	await waypoint(page, `filing-${outcome.replace('_', '-')}`);

	if (outcome === 'unknown')
		throw new Error(`The reply stopped while the filing was being sent. ${UNKNOWN}`);
	if (outcome === 'problem') {
		throw new Error(
			'The filing was sent and Tejido answered with a problem. The deposit may have been paid. ' +
				'See the screenshot for what the assistant said, and look at the public page before filing again.'
		);
	}
	if (outcome === 'not_sent') {
		throw new Error(
			'The assistant replied without filing: the page shows no filing was sent, so as far as it ' +
				'shows no deposit was paid. See the screenshot for what it asked (for example, to approve ' +
				'a payment in Qatom or to top up the wallet).'
		);
	}

	// Submitted. Let the assistant finish saying so, then look for the entry where donors would.
	await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({
		timeout: 120_000
	});
	await waypoint(page, 'filing-reply');

	const timeline = page.locator('section[aria-labelledby="timeline"]');
	await expect(async () => {
		await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
		await expect(timeline).toContainText(reference, { timeout: 5_000 });
	}, `The filing was submitted, but the entry "${reference}" is not on the public timeline. The deposit was paid; do not file again.`).toPass(
		{ timeout: 120_000 }
	);
	await waypoint(page, 'timeline-entry');
});
