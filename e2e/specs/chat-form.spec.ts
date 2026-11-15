/**
 * The report form inside the chat ("Fill in the form"). Signed in.
 *
 * The first checks open the form and send nothing: what it offers for each kind of milestone,
 * and what it says when something is missing. No model is called by them.
 *
 * The last check fills the form in for a work log and sends it, which asks the real model for
 * one reply (two if it has to be nudged): it runs on the phone only, on unpaid runs only, and
 * goes as far as the assistant's review card. NOTHING IS FILED: neither of the card's buttons
 * is pressed.
 */
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { openChat, replyAfter, reviewCard } from '../lib/chat.ts';
import { readPaidEntries } from '../lib/paid-entries.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';
import type { E2eConfig } from '../lib/config.ts';
import type { Locator, Page } from '@playwright/test';

needsSignIn();

const assistantBubbles = (page: Page) => page.locator('.log .tj-msg--assistant');

/** Counts what the page sends to the assistant from now on. */
function countMessages(page: Page): () => number {
	let sent = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/chat') sent += 1;
	});
	return () => sent;
}

/** Opens the chat and its form, and answers the form. */
async function openForm(page: Page, cfg: E2eConfig): Promise<Locator> {
	await openChat(page, cfg);
	await page.getByRole('button', { name: 'Fill in the form' }).click();
	const form = page.getByRole('form', { name: /^Report details/ });
	await expect(form).toBeVisible();
	// The page says, above the form, that sending it files nothing.
	await expect(page.getByText('Sending this files nothing and pays no deposit')).toBeVisible();
	return form;
}

test('the form offers what each milestone takes, and says what is missing', async ({
	page,
	cfg,
	waypoint
}) => {
	const form = await openForm(page, cfg);
	const messages = countMessages(page);

	// The contractor's three milestones, and the two reports a contractor can make on one. On a
	// paid run the phone confirms the third before the desktop gets here, and a confirmed
	// milestone takes no more reports: the form then offers the two that are left.
	const confirmed = readPaidEntries(cfg.campaignId).some((entry) => entry.what === 'confirmation');
	const milestone = form.getByLabel('Milestone', { exact: true });
	await expect(
		milestone.locator('option'),
		confirmed
			? 'This run confirmed the third milestone, so the form should offer the other two.'
			: 'The form should offer the contractor’s three milestones.'
	).toHaveCount(confirmed ? 2 : 3);
	await expect(form.getByRole('radio', { name: /^Work log/ })).toBeChecked();
	await expect(form.getByRole('radio', { name: /^Confirm the milestone/ })).toHaveCount(0);
	await waypoint(page, 'form-open');

	// Sent empty: it says what is missing, and nothing goes to the assistant.
	const send = form.getByRole('button', { name: 'Send to the assistant' });
	await send.click();
	await expect(form.getByRole('alert')).toHaveText(
		'Write a note saying what was done. It can be up to 4,000 characters.'
	);
	// A percent that cannot be one.
	await form.getByLabel('What was done').fill('An automated check of the form. Not sent.');
	await form.getByLabel(/^Percent complete/).fill('150');
	await send.click();
	await expect(form.getByRole('alert')).toHaveText(
		'Give the percent complete as a number from 0 to 100.'
	);
	await waypoint(page, 'form-needs-fixing');

	// The test campaign's second milestone is a delivery: the form then asks how many of what.
	await milestone.selectOption({ index: 1 });
	await form.getByRole('radio', { name: /^Delivery made/ }).check();
	await expect(form.getByLabel('Quantity delivered')).toBeVisible();
	await expect(form.getByLabel('Unit: what the quantity counts')).toBeVisible();
	await expect(form.getByLabel(/^Percent complete/)).toHaveCount(0);
	await send.click();
	await expect(
		form.getByText('Give how many were delivered, as a number that is zero or more.')
	).toBeVisible();
	await waypoint(page, 'form-for-a-delivery');

	// Closing it puts it away. Nothing was sent by any of this.
	await page.getByRole('button', { name: 'Close the form' }).click();
	await expect(form).toBeHidden();
	await expect(page.locator('.log .tj-msg--human')).toHaveCount(0);
	expect(messages(), 'A form that needs fixing should send the assistant nothing.').toBe(0);
});

test.describe('as the confirmer', () => {
	test.use({ storageState: CONFIRMER_STATE });

	test('the form offers a confirmer only a confirmation', async ({ page, cfg, waypoint }) => {
		const form = await openForm(page, cfg);
		const messages = countMessages(page);

		await expect(form.getByRole('radio')).toHaveCount(1);
		await expect(form.getByRole('radio', { name: /^Confirm the milestone/ })).toBeChecked();
		await expect(form.getByLabel('What you checked before confirming')).toBeVisible();
		await waypoint(page, 'confirmer-form-open');
		// Not sent: a confirmation is a paid filing, and nothing has been reported as done.
		expect(messages()).toBe(0);
	});
});

test.describe('sent to the assistant', () => {
	// The model's answers vary. One second try, never more.
	test.describe.configure({ retries: 1 });
	test.setTimeout(600_000);

	test('a filled-in form comes back as the review card, with its values on it', async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		test.skip(
			testInfo.project.name !== 'phone',
			'This asks the real model for a reply: once per run, on the phone project.'
		);
		test.skip(cfg.paid, 'E2E_PAID=true: a paid run keeps to the one conversation it files from.');

		const form = await openForm(page, cfg);
		const reference = `ref-${Date.now().toString(36)}`;
		const note = `Automated end-to-end check ${reference}. Sent from the report form. A test entry, not real work.`;

		// A work log on the first milestone: the form's own first choices.
		const milestone = form.getByLabel('Milestone', { exact: true });
		const title = (await milestone.locator('option').first().innerText()).trim();
		await milestone.selectOption({ index: 0 });
		await form.getByRole('radio', { name: /^Work log/ }).check();
		await form.getByLabel(/^How the work is going/).selectOption({ label: 'On track' });
		await form.getByLabel(/^Percent complete/).fill('10');
		await form.getByLabel('What was done').fill(note);
		await waypoint(page, 'form-filled');

		const before = await assistantBubbles(page).count();
		await form.getByRole('button', { name: 'Send to the assistant' }).click();

		// Fails here, in the page's own words, if the form was not sent or the reply stopped early.
		await replyAfter(page, before, 'the report form');

		// The conversation shows the form back, and says it is only a draft.
		const sent = page.locator('.log .tj-msg--human .sent-form');
		await expect(sent).toContainText('Work log');
		await expect(sent).toContainText(title);
		await expect(sent).toContainText('On track');
		await expect(sent).toContainText('10%');
		await expect(sent).toContainText(reference);
		await expect(page.getByText('Sent to the assistant as a draft.')).toBeVisible();
		await waypoint(page, 'form-sent');

		// The assistant should show the review straight away. One nudge if it asks something first.
		const card = reviewCard(page);
		if (!(await card.isVisible())) {
			const again = await assistantBubbles(page).count();
			await page
				.locator('#draft')
				.fill(
					'Please show the review now, with exactly what the form gave you. Do not file anything.'
				);
			await page.getByRole('button', { name: 'Send', exact: true }).click();
			await replyAfter(page, again, 'the request for the review');
		}
		await expect(card, 'The assistant did not show its review card.').toBeVisible();

		// The form's values are on the card: which milestone, the percent, and the note.
		await expect(card).toContainText(title);
		await expect(card).toContainText(reference);
		await expect(
			card.locator('.tj-kv__row').filter({ hasText: /percent/i }),
			'The card should carry the percent complete the form gave.'
		).toContainText('10');
		await expect(card.getByText('Filing deposit.')).toBeVisible();
		// Both buttons are there and work. NEITHER IS PRESSED: "File this entry" spends a deposit.
		await expect(card.getByRole('button', { name: 'File this entry' })).toBeEnabled();
		await expect(card.getByRole('button', { name: 'Change something' })).toBeEnabled();
		await expect(
			page.locator('.log .tj-msg--human').filter({ hasText: 'Yes, file this entry' }),
			'Nothing in this check says yes to filing.'
		).toHaveCount(0);
		await waypoint(page, 'form-review-card');
	});
});
