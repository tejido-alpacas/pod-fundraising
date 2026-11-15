/**
 * More of the App's evidence page, as the signed-in contractor: a file kept from donors, a PDF,
 * and the files the App refuses. No message is sent to the assistant, so no model is called.
 *
 * WHAT THIS LEAVES ON THE LIVE SITE: two tiny PDFs (about 500 bytes each) in the evidence
 * store, uploaded by the test contractor. One is public, one is kept from donors. Each is the
 * same bytes on every run, so the store keeps one copy of each, however many runs there are.
 * Neither is attached to a report, so neither appears on the test campaign's public page.
 */
import { expect, needsSignIn, test } from '../lib/harness.ts';
import {
	EVIDENCE_MAX_MEGABYTES,
	fingerprintOf,
	testDocumentFile,
	testNotPublicFile,
	tooBigFile,
	wrongKindFile
} from '../lib/files.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';
import type { Page } from '@playwright/test';

needsSignIn();

const NOT_PUBLIC_WORDS =
	'To keep a file from donors, say what it is (up to 80 characters) and why donors are not ' +
	'shown it (up to 200 characters). Fill in both, then choose the file again. Nothing was uploaded.';

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

test('a file can be kept from donors, and only the people named can open it', async ({
	page,
	cfg,
	waypoint,
	playwright,
	browser
}) => {
	const file = testNotPublicFile();
	await openEvidencePage(page, cfg.appUrl);
	const uploads = countUploads(page);

	// Ticked, with the two lines left empty: the file is not sent at all, so it can never go up
	// as public by mistake.
	await page.getByRole('checkbox', { name: /Keep these files from donors/ }).check();
	await expect(page.getByText('Donors read both lines.')).toBeVisible();
	await chooseFiles(page).setInputFiles(file);
	await expect(rowOf(page, file.name).getByRole('alert')).toHaveText(NOT_PUBLIC_WORDS);
	expect(uploads(), 'A file without its two lines should not be sent.').toBe(0);
	await waypoint(page, 'not-public-lines-missing');
	await page.getByRole('button', { name: `Remove ${file.name} from this list` }).click();
	await expect(rowOf(page, file.name)).toHaveCount(0);

	// With both lines, it uploads, and the page says who can open it.
	await page.getByLabel('What it is').fill('Automated test document');
	await page
		.getByLabel('Why donors are not shown it')
		.fill('An automated check that a file can be kept from donors.');
	await chooseFiles(page).setInputFiles(file);
	const row = rowOf(page, file.name);
	await expect(row).toContainText(
		'Uploaded. Not public: only you and this project’s confirmers can open it.',
		{ timeout: 60_000 }
	);
	await expect(row).not.toContainText('Donors can see it.');
	expect(uploads()).toBe(1);
	await waypoint(page, 'not-public-uploaded');

	const address = await row.getByRole('link', { name: `Open ${file.name}` }).getAttribute('href');
	expect(address, 'The file should have an address named by its fingerprint.').toContain(
		`/evidence/${fingerprintOf(file)}.pdf`
	);
	const url = new URL(address ?? '', cfg.appUrl).href;

	// Signed out, as a donor would be: refused, and none of the file comes back.
	const anyone = await playwright.request.newContext({ storageState: SIGNED_OUT });
	try {
		const refused = await anyone.get(url);
		expect(refused.status(), 'A file kept from donors should not open signed out.').toBe(401);
		expect(refused.headers()['content-type'] ?? '').not.toContain('application/pdf');
		expect((await refused.body()).includes(file.buffer.subarray(0, 64))).toBe(false);
	} finally {
		await anyone.dispose();
	}

	// The person who uploaded it can open it, and no browser or proxy is told to keep a copy.
	const theirs = await page.request.get(url);
	expect(theirs.status(), 'Its uploader should be able to open it.').toBe(200);
	expect(theirs.headers()['cache-control']).toBe('private, no-store');
	expect((await theirs.body()).equals(file.buffer)).toBe(true);

	// So can the project's confirmer.
	const confirmer = await browser.newContext({ storageState: CONFIRMER_STATE });
	try {
		const seen = await confirmer.request.get(url);
		expect(seen.status(), 'The project’s confirmer should be able to open it.').toBe(200);
		expect((await seen.body()).equals(file.buffer)).toBe(true);
	} finally {
		await confirmer.close();
	}
});

test('a PDF can be added as evidence, and opens for anyone', async ({
	page,
	cfg,
	waypoint,
	playwright
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
