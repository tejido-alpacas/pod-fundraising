/**
 * Signs each test person in ONCE, through real Qatom, and saves their signed-in browser for
 * every other spec. The contractor signs in on a phone-sized screen and the confirmer on a
 * desktop-sized one, so the sign-in pages are photographed at both without a second code.
 *
 * Never retried: a retry would ask Qatom for another code.
 */
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { needsSignIn, test } from '../lib/harness.ts';
import { sqsInboxQueue } from '../lib/inbox.ts';
import { CONFIRMER_STATE, CONTRACTOR_STATE } from '../lib/paths.ts';
import { signInFromInvite } from '../lib/sign-in.ts';
import { DESKTOP, PHONE } from '../lib/viewports.ts';

needsSignIn();
test.describe.configure({ mode: 'serial', retries: 0 });
// Reading the inbox can take two minutes on top of the pages themselves.
test.setTimeout(300_000);

test.describe('the contractor, on a phone', () => {
	test.use({ ...PHONE, storageState: { cookies: [], origins: [] } });

	test('signs in from their invite', async ({ page, cfg, waypoint }) => {
		await signInFromInvite(page, cfg, cfg.contractor, sqsInboxQueue(cfg.inbox), waypoint);
		mkdirSync(dirname(CONTRACTOR_STATE), { recursive: true });
		await page.context().storageState({ path: CONTRACTOR_STATE });
	});
});

test.describe('the confirmer, on a desktop', () => {
	test.use({ ...DESKTOP, storageState: { cookies: [], origins: [] } });

	test('signs in from their invite', async ({ page, cfg, waypoint }) => {
		await signInFromInvite(page, cfg, cfg.confirmer, sqsInboxQueue(cfg.inbox), waypoint);
		mkdirSync(dirname(CONFIRMER_STATE), { recursive: true });
		await page.context().storageState({ path: CONFIRMER_STATE });
	});
});
