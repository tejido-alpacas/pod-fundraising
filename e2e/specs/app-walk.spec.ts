/**
 * Walks the App as the signed-in contractor: home, adding evidence (one small picture, uploaded
 * for real), the fix page, a reminder's link, and the chat as it opens. No message is sent, so no model is called.
 * Then the confirmer's home and chat, to show the other role. Nothing is sent to the assistant
 * here, so no model is called.
 */
import { createHash } from 'node:crypto';
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { openChat } from '../lib/chat.ts';
import {
	privateEvidenceFile,
	privateEvidencePng,
	testEvidenceFile,
	testEvidencePng
} from '../lib/image.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';

needsSignIn();

/** A request with no cookies at all. Without this it would carry the project's signed-in browser. */
const SIGNED_OUT = { storageState: { cookies: [], origins: [] } };

test('home shows the project and what can be done', async ({ page, cfg, waypoint }) => {
	await page.goto(`${cfg.appUrl}/`);
	await expect(page.getByText('Your project', { exact: true })).toBeVisible();
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Due next' })).toBeVisible();
	await expect(page.getByRole('link', { name: /File a report/ }).first()).toBeVisible();
	await expect(page.getByRole('link', { name: /Add evidence/ }).first()).toBeVisible();
	// The three milestones of the test campaign, each owed by this contractor.
	await expect(page.getByRole('heading', { name: 'Your milestones' })).toBeVisible();
	for (const number of [1, 2, 3]) {
		await expect(page.getByText(`Test milestone ${number}:`).first()).toBeVisible();
	}
	// Signing out is offered. It is not pressed: it would also end the assistant's access to
	// Qatom for this person, for every later check in the run.
	await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
	await expect(
		page.getByText('Finish linking your Qatom wallets'),
		'The sign-in should have linked both wallets to the party.'
	).toHaveCount(0);
	await waypoint(page, 'home');
});

test('a picture can be added as evidence', async ({
	page,
	cfg,
	waypoint,
	playwright
}, testInfo) => {
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

	// What the page promises a donor: the file opens for anyone, signed in or not, and its name
	// is the fingerprint of its bytes, so a copy can be checked against it.
	const address = await row
		.getByRole('link', { name: 'Open e2e-evidence.png' })
		.getAttribute('href');
	expect(address, 'The uploaded file should have a web address.').toMatch(
		/\/evidence\/[0-9a-f]{64}\.png$/
	);
	const fingerprint = createHash('sha256').update(testEvidencePng()).digest('hex');
	expect(address).toContain(`/evidence/${fingerprint}.png`);
	const anyone = await playwright.request.newContext(SIGNED_OUT);
	try {
		const file = await anyone.get(new URL(address ?? '', cfg.appUrl).href);
		expect(file.status(), 'A public evidence file should open without signing in.').toBe(200);
		expect(file.headers()['content-type']).toBe('image/png');
		expect(
			createHash('sha256')
				.update(await file.body())
				.digest('hex')
		).toBe(fingerprint);
	} finally {
		await anyone.dispose();
	}
});

test('a file kept from donors opens for its uploader and the confirmer, and for nobody else', async ({
	page,
	cfg,
	waypoint,
	playwright
}) => {
	await page.goto(`${cfg.appUrl}/upload`);
	await expect(page.getByText('Or drop files here')).toBeAttached({ timeout: 30_000 });

	// Who may see a file is decided before choosing it: it is sent as soon as it is chosen.
	await page.getByLabel('Keep these files from donors').check();
	await page.getByLabel('What it is').fill('Automated test file');
	await page
		.getByLabel('Why donors are not shown it')
		.fill('An automated check of the app, not real evidence.');
	await waypoint(page, 'upload-kept-from-donors-chosen');

	await page
		.locator('form.tj-picker input[type="file"][multiple]')
		.setInputFiles(privateEvidenceFile());
	const row = page.locator('.tj-upload').filter({ hasText: 'e2e-kept-from-donors.png' });
	await expect(row).toContainText('Uploaded. Not public', { timeout: 60_000 });
	await waypoint(page, 'upload-kept-from-donors-done');

	const address = await row
		.getByRole('link', { name: 'Open e2e-kept-from-donors.png' })
		.getAttribute('href');
	const fingerprint = createHash('sha256').update(privateEvidencePng()).digest('hex');
	expect(address).toContain(`/evidence/${fingerprint}.png`);
	const file = new URL(address ?? '', cfg.appUrl).href;

	// Nobody signed in: refused, and no bytes.
	const anyone = await playwright.request.newContext(SIGNED_OUT);
	// The confirmer of this project: allowed.
	const confirmer = await playwright.request.newContext({ storageState: CONFIRMER_STATE });
	try {
		const refused = await anyone.get(file);
		expect(refused.status(), 'A file kept from donors must not open without signing in.').toBe(401);
		expect((await refused.body()).includes(privateEvidencePng())).toBe(false);

		const forConfirmer = await confirmer.get(file);
		expect(forConfirmer.status(), 'The project’s confirmer may open it.').toBe(200);
		expect(
			createHash('sha256')
				.update(await forConfirmer.body())
				.digest('hex')
		).toBe(fingerprint);
	} finally {
		await anyone.dispose();
		await confirmer.dispose();
	}
	// The uploader, in this signed-in browser: allowed.
	const forUploader = await page.request.get(file);
	expect(forUploader.status(), 'The uploader may open their own file.').toBe(200);

	// And the public picture is still public: keeping one file from donors hides no other.
	const publicFingerprint = createHash('sha256').update(testEvidencePng()).digest('hex');
	const stillPublic = await playwright.request.newContext(SIGNED_OUT);
	try {
		const open = await stillPublic.get(`${cfg.appUrl}/evidence/${publicFingerprint}.png`);
		expect(open.status(), 'The public test picture should still open for anyone.').toBe(200);
	} finally {
		await stillPublic.dispose();
	}
});

test('the fix page shows what is incomplete, or says nothing is', async ({
	page,
	cfg,
	waypoint
}) => {
	await page.goto(`${cfg.appUrl}/fix`);
	const heading = page.getByRole('heading', { level: 1 });
	// Three states, each with its own page: no incomplete report, exactly one (opened at once),
	// or several to choose from. Which one depends on what has been filed on the test campaign.
	await expect(heading).toHaveText(
		/^(Nothing to fix|Choose the report to fix|Add what is missing to finish .+)$/
	);
	const state = (await heading.innerText()).trim();

	if (state === 'Nothing to fix') {
		await expect(page.getByText('None of your reports is incomplete.')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Back to your project' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Save to this report' })).toHaveCount(0);
		await waypoint(page, 'fix-nothing');
		return;
	}

	if (state === 'Choose the report to fix') {
		// Each incomplete report is listed with its milestone and what is missing, and opens.
		const choices = page.locator('a[href^="?entry="]');
		expect(await choices.count()).toBeGreaterThanOrEqual(2);
		await expect(page.getByText('You won’t pay again.')).toBeVisible();
		await waypoint(page, 'fix-choose');
		await choices.first().click();
		await expect(heading).toHaveText(/^Add what is missing to finish .+$/);
	}

	// One report, open: it says what was saved, that fixing costs no deposit, and offers to
	// save. Nothing is chosen or saved here: saving changes the report for good.
	await expect(page.getByText('You won’t pay the deposit again.')).toBeVisible();
	await expect(page.getByText('Already saved', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: 'Save to this report' })).toBeVisible();
	await waypoint(page, 'fix-one-report');
});

test('a reminder’s link says what is due and leads to the chat', async ({
	page,
	cfg,
	waypoint
}) => {
	await page.goto(`${cfg.appUrl}/reminder`);
	// What is due depends on what has been filed: the work log, or the next milestone.
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(
		/^(Your work log is due|Milestone \d+ (is|was) due .+)$/
	);
	await expect(page.locator('a[href^="/chat"]').filter({ visible: true }).first()).toBeVisible();
	await waypoint(page, 'reminder');

	// A link about a milestone that is not this person's says so, and shows nothing of it.
	await page.goto(`${cfg.appUrl}/reminder?milestone=no-such-milestone-e2e`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('This reminder is not for you');
	await waypoint(page, 'reminder-not-theirs');
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
		await expect(page.getByRole('heading', { name: 'Your milestones' })).toBeVisible();
		await expect(page.getByText('The ones you confirm')).toBeVisible();
		await expect(
			page.getByText('Finish linking your Qatom wallets'),
			'The sign-in should have linked both wallets to the party.'
		).toHaveCount(0);
		await waypoint(page, 'confirmer-home');
	});

	test('the chat opens for a confirmation, and nothing is sent', async ({
		page,
		cfg,
		waypoint
	}) => {
		await page.goto(`${cfg.appUrl}/`);
		await page
			.getByRole('link', { name: /Confirm a milestone/ })
			.first()
			.click();
		await expect(page).toHaveURL(`${cfg.appUrl}/chat`);
		await expect(
			page.getByText('Your Qatom sign-in has run out'),
			'The assistant cannot reach Qatom as the confirmer.'
		).toHaveCount(0);
		await expect(page.getByLabel('Conversation')).toContainText('You’re signed in as');
		await expect(page.locator('#draft')).toBeEnabled();
		await waypoint(page, 'confirmer-chat-open');
	});
});
