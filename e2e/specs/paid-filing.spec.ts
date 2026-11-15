/**
 * THE ONE PLACE A TEST MOVES MONEY. It runs only when E2E_PAID is exactly `true`.
 *
 * It holds the same conversation as `chat-draft`, then presses "File this entry": the
 * assistant buys the campaign's work-log item as the contractor, which pays a real 0.10 deposit
 * from the contractor's own Qatom agent wallet. Then it finds the entry on the public timeline.
 *
 * One filing per run, never retried. Every way out says which of these happened, in capitals
 * where it matters: nothing was filed; the filing is waiting for an approval in Qatom; it is not
 * known whether it went through; or it was filed. It never files again, and neither should a
 * person until they have looked.
 *
 * The test campaign has no catalog items of its own. The assistant files with the Qatom tools
 * whose names end in log_work and milestone_hit, and Tejido finds the campaign from the
 * contractor's reporter code. Nothing here names a tool to the assistant: a contractor would not.
 * The entry's receipt stays "pending" (the reconciler skips a campaign without items), so
 * nothing here waits for a verified receipt.
 */
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { draftWorkLog } from '../lib/chat.ts';
import { until } from '../lib/harness.ts';
import { tidy } from '../lib/stuck-page.ts';

needsSignIn();

test.describe.configure({ retries: 0 });
// Longer than everything below can take added together (four replies of the draft, the upload,
// the filing, the reply after it and the timeline), so the test's own clock never cuts in while
// money may be moving: every way out below says what is and is not known.
test.setTimeout(1_800_000);

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
	const file = card.getByRole('button', { name: 'File this entry' });
	// Not pressable means nothing was sent: say so before any money can have moved.
	await expect(
		file,
		'The review card’s "File this entry" cannot be pressed. Nothing was sent.'
	).toBeEnabled();
	await file.click();

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
	} catch (error) {
		// Whatever went wrong while waiting (no answer in time, or the page itself failing), the
		// filing may already have been sent.
		await waypoint(page, 'filing-timed-out').catch(() => undefined);
		const why = error instanceof Error ? error.message : String(error);
		throw new Error(
			`The page gave no answer to the filing. ${UNKNOWN}\nWhat stopped the wait: ${why}`,
			{ cause: error }
		);
	}
	await waypoint(page, `filing-${outcome.replace('_', '-')}`);

	if (outcome === 'unknown')
		throw new Error(`The reply stopped while the filing was being sent. ${UNKNOWN}`);

	// In every other case the assistant's reply is ending or has ended. Let it finish, and keep
	// its last words for the log: they are what says why, when something below is not as hoped.
	await expect(
		page.getByRole('button', { name: 'Send', exact: true }),
		`The assistant's reply after the filing did not finish. ${outcome === 'not_sent' ? 'No filing was sent.' : UNKNOWN}`
	).toBeVisible({ timeout: 120_000 });
	await waypoint(page, 'filing-reply');
	const said = tidy(
		await page.locator('.log .tj-msg--assistant .tj-msg__bubble').last().innerText(),
		700
	);
	const words = `The assistant’s last words: "${said}"`;
	// The assistant is told to say so when Qatom wants the person to approve a payment.
	const approval = /approv/i.test(said);

	if (outcome === 'not_sent') {
		throw new Error(
			'NOTHING WAS FILED: the assistant replied without using a filing tool, so no deposit was ' +
				'paid. It is safe to run again once the cause is dealt with. ' +
				(approval ? 'It speaks of an approval: see its words. ' : '') +
				words
		);
	}

	// A filing tool was used and answered ("submitted"), or answered with an error ("problem").
	// Neither says the report was recorded: Qatom can answer that a payment is waiting to be
	// approved, and Tejido can refuse a report. The public timeline is what says it landed.
	const timeline = page.locator('section[aria-labelledby="timeline"]');
	let listed = true;
	try {
		await expect(async () => {
			await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
			await expect(timeline).toContainText(reference, { timeout: 5_000 });
		}).toPass({ timeout: outcome === 'submitted' ? 120_000 : 30_000 });
	} catch {
		listed = false;
	}

	if (!listed && approval) {
		await waypoint(page, 'timeline-without-the-entry');
		throw new Error(
			'THE FILING IS WAITING FOR AN APPROVAL IN QATOM, as far as the page and the assistant show. ' +
				`A filing tool was used, the entry "${reference}" is not on the public timeline, and the ` +
				'assistant speaks of approving a payment. No deposit shows as paid. But approving that ' +
				'waiting payment in Qatom later WOULD pay it and file this entry, so do not approve it ' +
				'unless you want that. To let a paid run file by itself, set the test contractor’s ' +
				`auto-approve limit to at least 0.10, then run again. ${words}`
		);
	}
	if (!listed) {
		await waypoint(page, 'timeline-without-the-entry');
		throw new Error(
			(outcome === 'problem'
				? 'The filing was sent and came back with a problem'
				: 'The filing was sent and answered') +
				`, and the entry "${reference}" is not on the public timeline. Either Tejido refused the ` +
				'report, or Qatom did not take the payment, or the assistant changed the note so the entry ' +
				'is there under other words. THE DEPOSIT MAY HAVE BEEN PAID. Do not run the paid spec again ' +
				`until you have looked at the test campaign’s public page and the contractor’s wallet. ${words}`
		);
	}
	if (outcome === 'problem') {
		await waypoint(page, 'timeline-entry');
		throw new Error(
			`The chat said the filing came back with a problem, yet the entry "${reference}" is on the ` +
				`public timeline: it was filed and the deposit was paid. Do not file again. ${words}`
		);
	}
	await waypoint(page, 'timeline-entry');

	// The entry's own proof page, as a donor opens it.
	await timeline
		.getByRole('article')
		.filter({ hasText: reference })
		.getByRole('link', { name: /View proof/ })
		.click();
	await expect(page.getByRole('heading', { name: 'What was reported' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What happened' })).toBeVisible();
	await expect(page.getByRole('main')).toContainText(reference);
	await waypoint(page, 'proof-of-the-entry');
});
