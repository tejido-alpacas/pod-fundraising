/**
 * Signs one test person in to the App through Qatom's own sign-in pages, from their invite.
 *
 * The App sends the browser to Qatom asking for the scopes `openid profile email twin
 * offline_access`, with `prompt=consent` and Tejido's Qatom MCP server as the `resource`
 * (packages/qatom/src/person, apps/app/src/routes/auth/sign-in). Qatom then shows, in order:
 *
 *   1. the email step            #email-input, #email-submit-btn
 *   2. the code step             #email-code-input (it submits itself at six digits)
 *   3. sometimes a passkey offer #passkey-skip-btn
 *   4. the wallet step, which for Tejido's client finishes by itself; the buttons it can show
 *      for other clients are pressed if they appear (#confirm-authorization-btn,
 *      #proceed-without-wallet, #account-select-continue)
 *
 * and sends the browser back to the App. These ids were read from the sign-in page Qatom
 * serves in production; none was checked by running this. See e2e/README.md.
 *
 * ONE code is asked for, by pressing Continue once. Nothing here presses "Send again".
 */
import { expect, type Locator, type Page } from '@playwright/test';
import type { E2eConfig, TestPerson } from './config.ts';
import { until, type Waypoint } from './harness.ts';
import { waitForSignInCode, type InboxQueue } from './inbox.ts';
import { assertQatomPage, onOrigin } from './safety.ts';

const CODE_WAIT_MS = 120_000;
const RETURN_WAIT_MS = 90_000;

async function shownText(locator: Locator): Promise<string | null> {
	if (!(await locator.first().isVisible())) return null;
	return (await locator.first().innerText()).trim() || null;
}

/** The buttons Qatom may put between the code and the way back. Each is pressed at most once. */
const ONWARD = [
	{ id: 'passkey-skip-btn', waypoint: 'qatom-passkey-offer' },
	{ id: 'account-select-continue', waypoint: 'qatom-account' },
	{ id: 'confirm-authorization-btn', waypoint: 'qatom-wallet' },
	{ id: 'proceed-without-wallet', waypoint: 'qatom-no-wallet' }
];

export async function signInFromInvite(
	page: Page,
	cfg: E2eConfig,
	person: TestPerson,
	queue: InboxQueue,
	waypoint: Waypoint
): Promise<void> {
	// 1. The invite, signed out.
	await page.goto(`${cfg.appUrl}/invite/${person.partyId}`);
	await expect(page.getByRole('heading', { level: 1 })).toContainText('you’re invited');
	await waypoint(page, 'invite');
	await page.getByRole('link', { name: 'Sign in with Qatom', exact: true }).click();

	// 2. Qatom's email step. Or the App's own page saying the sign-in could not start.
	const email = page.locator('#email-input');
	await until('Qatom’s sign-in page to ask for an email address', 45_000, async () => {
		if (await email.isVisible()) return true;
		if (onOrigin(page.url(), cfg.appUrl) && new URL(page.url()).pathname === '/auth/problem') {
			throw new Error(`The App could not start the sign-in: ${await problemTitle(page)}`);
		}
		return null;
	});
	assertQatomPage(page.url(), cfg);
	await waypoint(page, 'qatom-email');

	// A little slack for two clocks that disagree. Runs are one at a time, so nothing newer
	// than this can belong to an earlier sign-in of the same person.
	const notBeforeMs = Date.now() - 30_000;
	await email.fill(person.email);
	await page.locator('#email-submit-btn').click();

	// 3. The code step. If Qatom refuses to send a code (its limit), say what it said and stop.
	const code = page.locator('#email-code-input');
	await until('Qatom to ask for the emailed code', 45_000, async () => {
		if (await code.isVisible()) return true;
		const refused = await shownText(page.locator('#email-error'));
		if (refused) throw new Error(`Qatom did not send a code: ${refused}`);
		return null;
	});
	await waypoint(page, 'qatom-code');

	const digits = await waitForSignInCode(queue, {
		recipient: person.email,
		notBeforeMs,
		timeoutMs: CODE_WAIT_MS
	});
	assertQatomPage(page.url(), cfg);
	await code.fill(digits);

	// 4. Whatever Qatom shows next, until the browser is back on the App.
	const pressed = new Set<string>();
	try {
		await until('Qatom to send the browser back to the App', RETURN_WAIT_MS, async () => {
			const url = page.url();
			if (onOrigin(url, cfg.appUrl)) {
				return new URL(url).pathname === '/auth/callback' ? null : true;
			}
			const wrong = await shownText(page.locator('#code-error'));
			if (wrong) throw new Error(`Qatom did not accept the code: ${wrong}`);
			const failed = await shownText(page.locator('.wl-banner--danger'));
			if (failed) throw new Error(`Qatom could not finish the sign-in: ${failed}`);

			for (const step of ONWARD) {
				const button = page.locator(`#${step.id}`);
				if (pressed.has(step.id) || !(await button.isVisible()) || !(await button.isEnabled())) {
					continue;
				}
				pressed.add(step.id);
				assertQatomPage(page.url(), cfg);
				await waypoint(page, step.waypoint);
				await button.click();
				break;
			}
			return null;
		});
	} catch (error) {
		// A step this suite does not know shows up here. The picture says which.
		if (!onOrigin(page.url(), cfg.appUrl)) await waypoint(page, 'qatom-stuck');
		throw error;
	}

	// 5. Back on the App, signed in as this party.
	await page.waitForLoadState('domcontentloaded');
	if (new URL(page.url()).pathname === '/auth/problem') {
		await waypoint(page, 'sign-in-problem');
		throw new Error(`The App did not sign ${person.email} in: ${await problemTitle(page)}`);
	}
	await expect(page.getByText('Your project', { exact: true })).toBeVisible();
	await expect(page.getByText(`Signed in with the Qatom account ${person.email}.`)).toBeVisible();
	await waypoint(page, 'signed-in');
}

async function problemTitle(page: Page): Promise<string> {
	return (await page.title()).replace(/ · Tejido$/, '');
}
