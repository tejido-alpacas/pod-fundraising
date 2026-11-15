/**
 * The report form inside the App's chat ("Fill in the form"): opening it, and sending it as far
 * as the assistant's review card. Sending the form files nothing and pays nothing; what is
 * filed afterwards is filed from the review card (lib/filing.ts).
 *
 * `openReportForm` is the same opening as `openForm` in specs/chat-form.spec.ts, which a spec
 * cannot lend to another spec. That check can use this one in its place.
 */
import { expect, type Locator, type Page } from '@playwright/test';
import { openChat, replyAfter, reviewCard } from './chat.ts';
import type { E2eConfig } from './config.ts';

const assistantBubbles = (page: Page) => page.locator('.log .tj-msg--assistant');

/** Opens the chat and its report form. Returns the form. */
export async function openReportForm(page: Page, cfg: E2eConfig): Promise<Locator> {
	await openChat(page, cfg);
	await page.getByRole('button', { name: 'Fill in the form' }).click();
	const form = page.getByRole('form', { name: /^Report details/ });
	await expect(form).toBeVisible();
	// The page says, above the form, that sending it files nothing.
	await expect(page.getByText('Sending this files nothing and pays no deposit')).toBeVisible();
	return form;
}

/** Chooses the form's milestone by its title. Fails, naming what is offered, if it is not there. */
export async function chooseFormMilestone(form: Locator, title: string): Promise<void> {
	const milestone = form.getByLabel('Milestone', { exact: true });
	const value = await milestone
		.locator('option')
		.filter({ hasText: title })
		.first()
		.getAttribute('value', { timeout: 5_000 })
		.catch(() => null);
	if (value === null) {
		const offered = await milestone.locator('option').allInnerTexts();
		throw new Error(
			`The report form does not offer the milestone "${title}". It offers: ` +
				`${offered.map((text) => `"${text.trim()}"`).join(', ') || 'none'}. Nothing was sent.`
		);
	}
	await milestone.selectOption(value);
}

/**
 * Sends the filled-in form to the assistant and waits for its review card, asking once more if
 * the assistant asks something first. Returns the card. Nothing is filed by this.
 */
export async function sendFormForReview(page: Page, form: Locator): Promise<Locator> {
	const before = await assistantBubbles(page).count();
	await form.getByRole('button', { name: 'Send to the assistant' }).click();
	// Fails here, in the page's own words, if the form was not sent or the reply stopped early.
	await replyAfter(page, before, 'the report form');
	await expect(page.getByText('Sent to the assistant as a draft.')).toBeVisible();

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
	return card;
}
