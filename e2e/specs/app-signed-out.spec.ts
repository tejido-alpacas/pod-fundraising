/**
 * The App as someone who has not signed in: what each page says, and that each invitation
 * opens. Reads only, and no Qatom page is opened, so this runs on every run, including one
 * that does not sign in.
 */
import { expect, test } from '../lib/harness.ts';

test.use({ storageState: { cookies: [], origins: [] } });

test('home says what the App is for and offers the sign-in', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.appUrl}/`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		'Report your work on a funded project'
	);
	await expect(page.getByRole('heading', { name: 'Have an invitation?' })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Sign in with Qatom', exact: true })).toHaveAttribute(
		'href',
		'/auth/sign-in'
	);
	await waypoint(page, 'home-signed-out');
});

test('each test person’s invitation opens and offers the sign-in', async ({
	page,
	cfg,
	waypoint
}) => {
	for (const [who, person] of [
		['contractor', cfg.contractor],
		['confirmer', cfg.confirmer]
	] as const) {
		await page.goto(`${cfg.appUrl}/invite/${person.partyId}`);
		await expect(page.getByRole('heading', { level: 1 })).toContainText('you’re invited');
		await expect(page.getByRole('link', { name: 'Sign in with Qatom', exact: true })).toBeVisible();
		await waypoint(page, `invite-${who}`);
	}
});

test('an invitation that does not exist says so', async ({ page, cfg, waypoint }) => {
	const response = await page.goto(`${cfg.appUrl}/invite/no-such-party-e2e`);
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('We can’t find that');
	await waypoint(page, 'invite-not-found');
});

test('the pages that need a signed-in person say so, and show nothing else', async ({
	page,
	cfg,
	waypoint
}) => {
	await page.goto(`${cfg.appUrl}/upload`);
	await expect(page.getByText('Sign in to add evidence')).toBeVisible();
	await expect(page.locator('input[type="file"]')).toHaveCount(0);
	await waypoint(page, 'upload-signed-out');

	await page.goto(`${cfg.appUrl}/chat`);
	await expect(page.getByRole('heading', { level: 1, name: 'File a report' })).toBeAttached();
	await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
	await expect(page.locator('#draft')).toHaveCount(0);
	await waypoint(page, 'chat-signed-out');

	await page.goto(`${cfg.appUrl}/fix`);
	await expect(page.getByRole('link', { name: 'Go to the home page' })).toBeVisible();
	await expect(page.getByRole('button')).toHaveCount(0);
	await waypoint(page, 'fix-signed-out');
});

test('a reminder’s link says a report is due, and nothing about whose', async ({
	page,
	cfg,
	waypoint
}) => {
	await page.goto(`${cfg.appUrl}/reminder`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('A report is due on a project');
	// Signing in comes back to the reminder.
	await expect(page.getByRole('link', { name: 'Sign in with Qatom' })).toHaveAttribute(
		'href',
		'/auth/sign-in?return_to=%2Freminder'
	);
	// Signed out, the page names neither the project nor the person.
	await expect(page.getByText('Automated test campaign')).toHaveCount(0);
	await expect(page.getByText('E2E Test')).toHaveCount(0);
	await waypoint(page, 'reminder-signed-out');

	// A link that names the invited person starts the sign-in for them, and still shows nothing.
	await page.goto(`${cfg.appUrl}/reminder?party=${cfg.contractor.partyId}`);
	await expect(page.getByRole('link', { name: 'Sign in with Qatom' })).toHaveAttribute(
		'href',
		`/auth/sign-in?party=${cfg.contractor.partyId}&return_to=%2Freminder`
	);
	await expect(page.getByText('E2E Test')).toHaveCount(0);
});
