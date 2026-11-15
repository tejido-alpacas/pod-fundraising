/**
 * Signs the third test person in on the Campaign Site (tejido.net) ONCE, through real Qatom,
 * and saves their signed-in browser for site-signed-in.spec.ts. They are a visitor: no party of
 * any campaign, so nothing in the database is set up for them. Their address is on the test
 * inbox's domain, and it is theirs alone, so the two App test people's sign-in codes are not
 * spent.
 *
 * It starts from the header's own "Sign in" on a phone-sized screen, where that link and the
 * person's email are both inside the menu, and ends back on the page it started from.
 *
 * Never retried: a retry would ask Qatom for another code.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { sqsInboxQueue } from '../lib/inbox.ts';
import { DONOR_STATE } from '../lib/paths.ts';
import { signInAtQatom } from '../lib/sign-in.ts';
import { HEADER_WORDS, menu, openMenu } from '../lib/site-header.ts';
import { PHONE } from '../lib/viewports.ts';

needsSignIn();
test.describe.configure({ mode: 'serial', retries: 0 });
// Reading the inbox can take two minutes on top of the pages themselves.
test.setTimeout(300_000);
test.use({ ...PHONE, storageState: { cookies: [], origins: [] } });

const WORDS = HEADER_WORDS.en;
/** Where the visitor is when they press Sign in, and so where the sign-in brings them back. */
const START = '/explore';

test('a visitor signs in on the Campaign Site and is shown as signed in', async ({
	page,
	cfg,
	waypoint
}) => {
	// 1. Signed out, on a page of the site. The menu offers Sign in, and no email.
	await page.goto(`${cfg.siteUrl}${START}`);
	await openMenu(page, 'en');
	await expect(menu(page).getByText(WORDS.signedInAs)).toHaveCount(0);
	await waypoint(page, 'signed-out-menu');
	await menu(page).getByRole('link', { name: WORDS.signIn, exact: true }).click();

	// 2 to 4. Qatom's own pages: the email, the emailed code, and whatever it shows after.
	await signInAtQatom(
		page,
		cfg,
		{ email: cfg.donor.email, origin: cfg.siteUrl, name: 'the Campaign Site' },
		sqsInboxQueue(cfg.inbox),
		waypoint
	);

	// 5. Back on the page the visitor started from, shown as signed in: their email and a
	// Sign out button where Sign in was.
	expect(new URL(page.url()).pathname, 'The sign-in should come back to the page it left.').toBe(
		START
	);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explore');
	await openMenu(page, 'en');
	await expect(menu(page).getByText(`${WORDS.signedInAs}${cfg.donor.email}`)).toBeVisible();
	await expect(menu(page).getByRole('button', { name: WORDS.signOut, exact: true })).toBeVisible();
	await expect(page.getByRole('link', { name: WORDS.signIn, exact: true })).toHaveCount(0);
	await waypoint(page, 'signed-in-menu');

	mkdirSync(dirname(DONOR_STATE), { recursive: true });
	await page.context().storageState({ path: DONOR_STATE });
});
