/**
 * Driving the App's chat: saying something, attaching the picture, and getting the assistant
 * to show its review card. The assistant is the real model, so nothing here depends on its
 * words: only on what the page draws around them.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { E2eConfig } from './config.ts';
import { until, type Waypoint } from './harness.ts';
import { testEvidenceFile } from './image.ts';

/** How long one reply may take. The model also calls Qatom's tools, which can be slow. */
export const REPLY_MS = 240_000;

const assistantBubbles = (page: Page) => page.locator('.log .tj-msg--assistant');
const sendButton = (page: Page) => page.getByRole('button', { name: 'Send', exact: true });
export const reviewCard = (page: Page) =>
	page.getByRole('group', { name: 'Review before you file' }).last();

/** Opens the chat and waits until its buttons work, which is when the page's script has started. */
export async function openChat(page: Page, cfg: E2eConfig): Promise<void> {
	await page.goto(`${cfg.appUrl}/chat`);
	await expect(page.getByRole('heading', { level: 1, name: 'File a report' })).toBeAttached();
	await expect(
		page.getByText('Your Qatom sign-in has run out'),
		'The assistant cannot reach Qatom as this person. Run the suite again so it signs in afresh.'
	).toHaveCount(0);

	// The attach button does nothing until the page's script runs. Pressing it is the probe.
	const attach = page.getByRole('button', { name: 'Add photo or file' });
	await expect(async () => {
		if ((await attach.getAttribute('aria-expanded')) !== 'true') await attach.click();
		await expect(page.locator('#attach-choices')).toBeVisible({ timeout: 1500 });
	}).toPass({ timeout: 30_000 });
}

/**
 * Waits for the reply to whatever was just sent: a new assistant bubble, and the Send button
 * back in place of Stop. Fails with the page's own words if the message was not sent or the
 * reply stopped early.
 */
export async function replyAfter(page: Page, before: number, what: string): Promise<void> {
	await until(`the assistant to finish its reply to ${what}`, REPLY_MS, async () => {
		const notSent = page.getByRole('alert').filter({ hasText: 'Not sent' });
		if (await notSent.isVisible()) {
			throw new Error(`The chat did not send ${what}: ${(await notSent.innerText()).trim()}`);
		}
		const settled =
			(await sendButton(page).isVisible()) && (await assistantBubbles(page).count()) > before;
		return settled ? true : null;
	});
	const stopped = page.locator('.log .tj-msg--error').last();
	if (await stopped.isVisible()) {
		throw new Error(
			`The assistant's reply to ${what} stopped early: ${(await stopped.innerText()).trim()}`
		);
	}
}

async function say(page: Page, text: string, what: string): Promise<void> {
	const before = await assistantBubbles(page).count();
	await page.locator('#draft').fill(text);
	await sendButton(page).click();
	await replyAfter(page, before, what);
}

/**
 * One conversation, as far as the review card: says what was done, attaches the picture, asks
 * for the review. Returns the card. Nothing is filed by this.
 *
 * `reference` is put in the note so the entry can be found afterwards if it is filed.
 */
export async function draftWorkLog(
	page: Page,
	cfg: E2eConfig,
	reference: string,
	waypoint: Waypoint
): Promise<Locator> {
	await openChat(page, cfg);
	await waypoint(page, 'chat-open');

	await say(
		page,
		'I want to file a work log on the first milestone I owe. This is an automated test of the ' +
			`app, not real work. Status: on track. Percent complete: 10. Use this note word for word: ` +
			`"Automated end-to-end check ${reference}. A test entry, not real work." ` +
			'I will attach one photo next. Do not file anything yet.',
		'the description of the work'
	);
	await waypoint(page, 'chat-described');

	// The picture goes through the chat's own "Choose file", which uploads it for real and then
	// tells the assistant.
	const before = await assistantBubbles(page).count();
	const attach = page.getByRole('button', { name: 'Add photo or file' });
	if ((await attach.getAttribute('aria-expanded')) !== 'true') await attach.click();
	await page
		.locator('#attach-choices input[type="file"]:not([capture])')
		.setInputFiles(testEvidenceFile());
	await expect(page.locator('.tj-attach').filter({ hasText: 'Uploaded ·' })).toBeVisible({
		timeout: 60_000
	});
	await replyAfter(page, before, 'the attached photo');
	await waypoint(page, 'chat-photo-attached');

	// Ask for the review. The assistant may ask one more question first: one nudge, no more.
	const card = reviewCard(page);
	await say(
		page,
		'That is everything. Attach the photo I just uploaded and show me the review before filing.',
		'the request for the review'
	);
	if (!(await card.isVisible())) {
		await say(
			page,
			'Please show the review now, with exactly what I have given you. Do not file yet.',
			'the second request for the review'
		);
	}
	await expect(card, 'The assistant did not show its review card.').toBeVisible();
	return card;
}
