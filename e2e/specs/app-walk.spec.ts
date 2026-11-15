/**
 * Walks the App as the signed-in contractor: home, adding evidence (one small picture, uploaded
 * for real), the fix page, and the chat as it opens. No message is sent, so no model is called.
 * Then the confirmer's home, to show the other role.
 */
import { expect, test } from '../lib/harness.ts';
import { openChat } from '../lib/chat.ts';
import { testEvidenceFile } from '../lib/image.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';

test('home shows the project and what can be done', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.appUrl}/`);
	await expect(page.getByText('Your project', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Due next' })).toBeVisible();
	await expect(page.getByRole('link', { name: /File a report/ }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: /Add evidence/ }).first()).toBeVisible();
	await expect(
		page.getByText('Finish linking your Qatom wallets'),
		'The sign-in should have linked both wallets to the party.'
	).toHaveCount(0);
	await waypoint(page, 'home');
});

test('a picture can be added as evidence', async ({ page, cfg, waypoint }, testInfo) => {
	await page.goto(`${cfg.appUrl}/upload`);
	// The drop area is put in the page once the page's script runs; a file chosen then is sent at
	// once. It is for dragging with a mouse, so the App shows it on a wide screen and hides it on
	// a phone: being in the page is the sign the script runs, and being seen is checked on desktop.
	const drop = page.getByText('Or drop files here');
	await expect(drop).toBeAttached({ timeout: 30_000 });
	if (testInfo.project.name === 'desktop') await expect(drop).toBeVisible();
	else await expect(drop).toBeHidden();
	await expect(page.getByText('Take a photo', { exact: true })).toBeVisible();
	await expect(page.getByText('Choose files', { exact: true })).toBeVisible();
	await waypoint(page, 'upload-empty');

	await page
		.locator('form.tj-picker input[type="file"][multiple]')
		.setInputFiles(testEvidenceFile());
	const row = page.locator('.tj-upload').filter({ hasText: 'e2e-evidence.png' });
	await expect(row).toContainText('Uploaded. Donors can see it.', { timeout: 60_000 });
	await expect(page.getByRole('heading', { name: 'Hand them to your report' })).toBeVisible();
	await waypoint(page, 'upload-done');
});

test('the fix page opens', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.appUrl}/fix`);
	// "Nothing to fix" or "Choose the report to fix": either is the page working.
	await expect(page.getByRole('heading', { level: 1 })).toContainText(/fix/i);
	await waypoint(page, 'fix');
});

test('the chat opens, ready for a report', async ({ page, cfg, waypoint }) => {
	await openChat(page, cfg);
	await expect(page.getByLabel('Conversation')).toContainText('You’re signed in as');
	await expect(page.locator('#draft')).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
	await waypoint(page, 'chat-open');
});

test.describe('as the confirmer', () => {
	test.use({ storageState: CONFIRMER_STATE });

	test('home shows the milestones they confirm', async ({ page, cfg, waypoint }) => {
		await page.goto(`${cfg.appUrl}/`);
		await expect(page.getByText('Your project', { exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: /Confirm a milestone/ }).first()).toBeVisible();
		await waypoint(page, 'confirmer-home');
	});
});
