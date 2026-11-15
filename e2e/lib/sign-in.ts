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
 *   4. the wallet step. Because the sign-in names a Qatom MCP server, Qatom offers to add funds
 *      by card here ("Add funds to your wallet"), unless the client's row says
 *      `"show_chargeup": false`. "Skip for now" is pressed, and nothing else on that page: this
 *      suite never chooses an amount or types a card. The other buttons the step can show are
 *      pressed if they appear (#confirm-authorization-btn, #proceed-without-wallet,
 *      #account-select-continue, and #finish-sign-in-retry once if finishing fails)
 *
 * and sends the browser back to the App. The first run against the live site reached the offer
 * to add funds and stopped there; everything after it is still unchecked. See e2e/README.md.
 *
 * The Campaign Site signs a visitor in through the same pages (`signInAtQatom`, used by
 * specs/site-sign-in.spec.ts). It asks Qatom for less: no MCP server and no `offline_access`
 * (apps/web/src/routes/(campaign-site)/auth/sign-in), so step 4 may show fewer buttons there.
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

type Onward = { key: string; waypoint: string; find: (page: Page) => Locator };

/** The buttons Qatom may put between the code and the way back. Each is pressed at most once. */
const ONWARD: Onward[] = [
	{
		key: 'passkey-skip',
		waypoint: 'qatom-passkey-offer',
		find: (page) => page.locator('#passkey-skip-btn')
	},
	{
		key: 'account-continue',
		waypoint: 'qatom-account',
		find: (page) => page.locator('#account-select-continue')
	},
	{
		key: 'confirm-authorization',
		waypoint: 'qatom-wallet',
		find: (page) => page.locator('#confirm-authorization-btn')
	},
	{
		key: 'proceed-without-wallet',
		waypoint: 'qatom-no-wallet',
		find: (page) => page.locator('#proceed-without-wallet')
	},
	// The offer to add funds by card. The button has no id; Qatom's own checks find it by name.
	{
		key: 'add-funds-skip',
		waypoint: 'qatom-add-funds',
		find: (page) =>
			page
				.locator('#wallet-load-container')
				.getByRole('button', { name: 'Skip for now', exact: true })
	},
	// Shown when finishing the sign-in failed after the offer was skipped.
	{
		key: 'finish-retry',
		waypoint: 'qatom-finish-retry',
		find: (page) => page.locator('#finish-sign-in-retry')
	}
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

	await signInAtQatom(
		page,
		cfg,
		{ email: person.email, origin: cfg.appUrl, name: 'the App' },
		queue,
		waypoint
	);

	// 5. Back on the App, signed in as this party.
	await expect(page.getByText('Your project', { exact: true })).toBeVisible();
	await expect(page.getByText(`Signed in with the Qatom account ${person.email}.`)).toBeVisible();
	await waypoint(page, 'signed-in');
}

/** Who is signing in, and the Tejido site that sent them to Qatom and gets them back. */
export interface QatomSignIn {
	email: string;
	/** That site's origin: `cfg.appUrl` or `cfg.siteUrl`. */
	origin: string;
	/** That site in words, for a failure: "the App". */
	name: string;
}

/**
 * Steps 2 to 4: Qatom's own pages, from just after "Sign in" was pressed on a Tejido site until
 * the browser is back on that site with the sign-in finished. Fails, saying what the site said,
 * if the site could not start the sign-in or refused it.
 */
export async function signInAtQatom(
	page: Page,
	cfg: E2eConfig,
	{ email: address, origin, name }: QatomSignIn,
	queue: InboxQueue,
	waypoint: Waypoint
): Promise<void> {
	// 2. Qatom's email step. Or the App's own page saying the sign-in could not start.
	const email = page.locator('#email-input');
	await until('Qatom’s sign-in page to ask for an email address', 45_000, async () => {
		if (await email.isVisible()) return true;
		if (onOrigin(page.url(), origin) && new URL(page.url()).pathname === '/auth/problem') {
			throw new Error(`${capital(name)} could not start the sign-in: ${await problemTitle(page)}`);
		}
		return null;
	});
	assertQatomPage(page.url(), cfg);
	await waypoint(page, 'qatom-email');

	// A little slack for two clocks that disagree. Runs are one at a time, so nothing newer
	// than this can belong to an earlier sign-in of the same person.
	const notBeforeMs = Date.now() - 30_000;
	await email.fill(address);
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
		recipient: address,
		notBeforeMs,
		timeoutMs: CODE_WAIT_MS
	});
	assertQatomPage(page.url(), cfg);
	await code.fill(digits);

	// 4. Whatever Qatom shows next, until the browser is back on the site it came from.
	const pressed = new Set<string>();
	try {
		await until(`Qatom to send the browser back to ${name}`, RETURN_WAIT_MS, async () => {
			const url = page.url();
			if (onOrigin(url, origin)) {
				return new URL(url).pathname === '/auth/callback' ? null : true;
			}
			const wrong = await shownText(page.locator('#code-error'));
			if (wrong) throw new Error(`Qatom did not accept the code: ${wrong}`);
			const failed = await shownText(page.locator('.wl-banner--danger'));
			if (failed) throw new Error(`Qatom could not finish the sign-in: ${failed}`);

			for (const step of ONWARD) {
				const button = step.find(page).first();
				if (pressed.has(step.key) || !(await button.isVisible()) || !(await button.isEnabled())) {
					continue;
				}
				pressed.add(step.key);
				assertQatomPage(page.url(), cfg);
				await waypoint(page, step.waypoint);
				await button.click();
				break;
			}
			return null;
		});
	} catch (error) {
		// A step this suite does not know shows up here. The picture shows it, and the harness adds
		// to the failure what the page was showing (its step, headings and buttons), so the run's
		// log is enough to tell which step it was.
		if (!onOrigin(page.url(), origin)) await waypoint(page, 'qatom-stuck');
		throw error;
	}

	// Back on the site. It may have refused the sign-in.
	await page.waitForLoadState('domcontentloaded');
	if (new URL(page.url()).pathname === '/auth/problem') {
		await waypoint(page, 'sign-in-problem');
		throw new Error(`${capital(name)} did not sign ${address} in: ${await problemTitle(page)}`);
	}
}

function capital(words: string): string {
	return words.charAt(0).toUpperCase() + words.slice(1);
}

async function problemTitle(page: Page): Promise<string> {
	return (await page.title()).replace(/ · Tejido$/, '');
}
