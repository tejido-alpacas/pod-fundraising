/**
 * The end-to-end suite's own Playwright configuration. See README.md in this folder.
 *
 * It reads no environment variable itself, so `npm run e2e:list` works with nothing set. The
 * specs get their configuration, checked, from `lib/harness.ts`.
 */
import { defineConfig } from '@playwright/test';
import { CONTRACTOR_STATE, DONOR_STATE, REPORT, TEST_OUTPUT } from './lib/paths.ts';
import { DESKTOP, PHONE } from './lib/viewports.ts';

// Each sign-in spec by its whole name under specs/, so neither pattern can match the other file.
const APP_SIGN_IN = '**/specs/sign-in.spec.ts';
const SITE_SIGN_IN = '**/specs/site-sign-in.spec.ts';
const SITE_SIGNED_IN = [SITE_SIGN_IN, '**/specs/site-signed-in.spec.ts'];

export default defineConfig({
	testDir: './specs',
	outputDir: TEST_OUTPUT,
	// One thing at a time, in order: the test people are shared, Qatom limits sign-in codes, and
	// the paid spec must never run twice.
	workers: 1,
	fullyParallel: false,
	// Nothing is retried unless a spec says so. A retried sign-in asks for another code, and a
	// retried filing pays another deposit.
	retries: 0,
	forbidOnly: true,
	timeout: 120_000,
	expect: { timeout: 15_000 },
	reporter: [['list'], ['html', { outputFolder: REPORT, open: 'never' }]],
	use: {
		// A trace or a video would record cookies and sign-in addresses. Screenshots only.
		trace: 'off',
		video: 'off',
		screenshot: 'only-on-failure',
		locale: 'en-GB',
		timezoneId: 'UTC'
	},
	projects: [
		// Signs each test person in ONCE and saves their signed-in browser. Everything else reuses it.
		{ name: 'sign-in', testMatch: APP_SIGN_IN },
		{
			name: 'phone',
			testIgnore: [APP_SIGN_IN, ...SITE_SIGNED_IN],
			dependencies: ['sign-in'],
			use: { ...PHONE, storageState: CONTRACTOR_STATE }
		},
		{
			name: 'desktop',
			testIgnore: [APP_SIGN_IN, ...SITE_SIGNED_IN],
			dependencies: ['sign-in'],
			use: { ...DESKTOP, storageState: CONTRACTOR_STATE }
		},
		// The third test person signs in on the Campaign Site, once. These two projects stand apart
		// from the three above, so a failure here skips nothing there, and the other way round.
		{ name: 'site-sign-in', testMatch: SITE_SIGN_IN },
		// What that person then sees. The spec sets the phone and desktop screens itself.
		{
			name: 'site-signed-in',
			testMatch: '**/specs/site-signed-in.spec.ts',
			dependencies: ['site-sign-in'],
			use: { storageState: DONOR_STATE }
		}
	]
});
