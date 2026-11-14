/**
 * The end-to-end suite's own Playwright configuration. See README.md in this folder.
 *
 * It reads no environment variable itself, so `npm run e2e:list` works with nothing set. The
 * specs get their configuration, checked, from `lib/harness.ts`.
 */
import { defineConfig } from '@playwright/test';
import { CONTRACTOR_STATE, REPORT, TEST_OUTPUT } from './lib/paths.ts';
import { DESKTOP, PHONE } from './lib/viewports.ts';

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
		{ name: 'sign-in', testMatch: 'sign-in.spec.ts' },
		{
			name: 'phone',
			testIgnore: 'sign-in.spec.ts',
			dependencies: ['sign-in'],
			use: { ...PHONE, storageState: CONTRACTOR_STATE }
		},
		{
			name: 'desktop',
			testIgnore: 'sign-in.spec.ts',
			dependencies: ['sign-in'],
			use: { ...DESKTOP, storageState: CONTRACTOR_STATE }
		}
	]
});
