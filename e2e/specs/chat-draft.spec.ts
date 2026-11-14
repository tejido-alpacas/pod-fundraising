/**
 * One conversation with the App's assistant, as far as its review card. Nothing is filed and
 * no money moves. This calls the real model, once per run: it runs on the phone only, and is
 * left to `paid-filing` on a paid run, which holds the same conversation and then files.
 */
import { expect, test } from '../lib/harness.ts';
import { draftWorkLog } from '../lib/chat.ts';

// The model's answers vary. One second try, never more.
test.describe.configure({ retries: 1 });
test.setTimeout(900_000);

test('the assistant drafts a work log and shows its review card', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	test.skip(
		testInfo.project.name !== 'phone',
		'One model conversation per run: the phone project holds it.'
	);
	test.skip(cfg.paid, 'E2E_PAID=true: paid-filing holds this same conversation, then files.');

	const card = await draftWorkLog(page, cfg, `ref-${Date.now().toString(36)}`, waypoint);

	// The structure of the card, never the assistant's wording.
	await expect(card.locator('.tj-kv__row').first()).toBeVisible();
	await expect(card.getByText('Filing deposit.')).toBeVisible();
	await expect(card.getByRole('button', { name: 'File this entry' })).toBeEnabled();
	await expect(card.getByRole('button', { name: 'Change something' })).toBeEnabled();
	await waypoint(page, 'chat-review-card');
});
