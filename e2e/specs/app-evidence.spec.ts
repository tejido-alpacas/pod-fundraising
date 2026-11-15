/**
 * More of the App's evidence page, as the signed-in contractor: a PDF, the same file chosen
 * twice, the button that copies the files for a report, and the files the App refuses. No
 * message is sent to the assistant, so no model is called.
 *
 * WHAT THIS LEAVES ON THE LIVE SITE: one tiny public PDF (about 500 bytes) in the evidence
 * store, uploaded by the test contractor. It is the same bytes on every run, so the store keeps
 * one copy, however many runs there are. It is not attached to a report, so it does not appear
 * on the test campaign's public page.
 *
 * A file kept from donors is not checked here: `app-walk` checks that.
 */
import { expect, needsSignIn, test } from '../lib/harness.ts';
import {
	EVIDENCE_MAX_MEGABYTES,
	fingerprintOf,
	testDocumentFile,
	tooBigFile,
	wrongKindFile
} from '../lib/files.ts';
import type { Page } from '@playwright/test';

needsSignIn();

/**
 * Nobody's browser. It has to be said: a request context made inside a test otherwise starts
 * with the project's signed-in cookie, and "signed out" would not be.
 */
const SIGNED_OUT = { cookies: [], origins: [] };

/** Opens the evidence page and waits until a chosen file would be sent, not just listed. */
async function openEvidencePage(page: Page, appUrl: string): Promise<void> {
	await page.goto(`${appUrl}/upload`);
	// The drop area is put in the page once the page's script runs.
	await expect(page.getByText('Or drop files here')).toBeAttached({ timeout: 30_000 });
}

const chooseFiles = (page: Page) => page.locator('form.tj-picker input[type="file"][multiple]');
const rowOf = (page: Page, name: string) => page.locator('.tj-upload').filter({ hasText: name });

/** Counts the uploads the page sends from now on. A refused file must send none. */
function countUploads(page: Page): () => number {
	let sent = 0;
	page.on('request', (request) => {
		if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/evidence') {
			sent += 1;
		}
	});
	return () => sent;
}

test('a PDF can be added as evidence, and opens for anyone', async ({
	page,
	cfg,
	waypoint,
	playwright,
	context
}) => {
	const file = testDocumentFile();
	await openEvidencePage(page, cfg.appUrl);

	await chooseFiles(page).setInputFiles(file);
	const row = rowOf(page, file.name).first();
	await expect(row).toContainText('Uploaded. Donors can see it.', { timeout: 60_000 });

	const address = await row.getByRole('link', { name: `Open ${file.name}` }).getAttribute('href');
	expect(address, 'The PDF should have an address named by its fingerprint.').toContain(
		`/evidence/${fingerprintOf(file)}.pdf`
	);
	const anyone = await playwright.request.newContext({ storageState: SIGNED_OUT });
	try {
		const opened = await anyone.get(new URL(address ?? '', cfg.appUrl).href);
		expect(opened.status(), 'A public PDF should open without signing in.').toBe(200);
		expect(opened.headers()['content-type']).toBe('application/pdf');
		// The browser is told to show it as the PDF it is, and nothing else.
		expect(opened.headers()['x-content-type-options']).toBe('nosniff');
		expect((await opened.body()).equals(file.buffer)).toBe(true);
	} finally {
		await anyone.dispose();
	}

	// Chosen a second time, the same file is not listed twice for the report.
	await chooseFiles(page).setInputFiles(file);
	await expect(page.locator('.tj-upload.is-excluded')).toContainText(
		`Left out: it is the same file as ${file.name}, which is uploaded.`,
		{ timeout: 60_000 }
	);
	await expect(page.getByText('2 chosen · 1 uploaded')).toBeVisible();
	await waypoint(page, 'pdf-uploaded');

	// "Copy for your report" puts the one file on the clipboard, as its address and fingerprint.
	await context.grantPermissions(['clipboard-read', 'clipboard-write']);
	await page.getByRole('button', { name: 'Copy 1 file for your report' }).click();
	await expect(
		page.getByRole('button', { name: 'Copied. Now paste it into your report' })
	).toBeVisible();
	// Read in the page, as text: this suite is not compiled with the browser's clipboard types.
	const pasted: unknown = await page.evaluate('navigator.clipboard.readText()');
	expect(typeof pasted === 'string' ? (JSON.parse(pasted) as unknown) : pasted).toEqual([
		{ url: new URL(address ?? '', cfg.appUrl).href, sha256: fingerprintOf(file) }
	]);
});

test('a file that is too big, and one of the wrong kind, are refused in plain words', async ({
	page,
	cfg,
	waypoint
}) => {
	await openEvidencePage(page, cfg.appUrl);
	const uploads = countUploads(page);
	// The page says its limits before anything is chosen.
	await expect(page.locator('.tj-picker__limits')).toContainText(
		`up to ${EVIDENCE_MAX_MEGABYTES} MB each`
	);

	const big = tooBigFile();
	const text = wrongKindFile();
	await chooseFiles(page).setInputFiles([big, text]);

	await expect(rowOf(page, big.name).getByRole('alert')).toHaveText(
		`This file is larger than ${EVIDENCE_MAX_MEGABYTES} MB, the most we can take. ` +
			'Choose a smaller file, or take the photo at a lower quality.'
	);
	await expect(rowOf(page, text.name).getByRole('alert')).toHaveText(
		'This kind of file cannot be used as evidence. Choose a photo (JPG, PNG, WEBP) or a document (PDF).'
	);
	// Sending either again could not help, so neither is offered a retry, and neither left.
	await expect(page.getByRole('button', { name: 'Retry' })).toHaveCount(0);
	await expect(page.getByText('2 chosen · 0 uploaded')).toBeVisible();
	await expect(page.getByRole('heading', { name: 'Hand them to your report' })).toHaveCount(0);
	expect(uploads(), 'A refused file should never leave the browser.').toBe(0);
	await waypoint(page, 'files-refused');

	// An agent sends files straight to the App rather than through this page. The App itself
	// refuses the wrong kind there too, before storing anything. (The too-big file is not sent
	// this way: that would push 10 MB at the live site on every run.)
	const straight = await page.request.post(`${cfg.appUrl}/api/evidence`, {
		headers: { origin: cfg.appUrl },
		multipart: { file: text }
	});
	expect(straight.status(), 'The App should refuse a text file sent straight to it.').toBe(415);
});
