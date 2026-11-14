/**
 * What every spec starts from: the checked configuration, and `waypoint`, which keeps a named
 * screenshot of where the walk has got to.
 */
import { test as base, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { loadE2eConfig, type E2eConfig } from './config.ts';
import { SCREENSHOTS } from './paths.ts';
import { assertSafeToRun } from './safety.ts';

/** Takes a full-page screenshot named for this point in the walk, and adds it to the report. */
export type Waypoint = (page: Page, name: string) => Promise<void>;

export const test = base.extend<{ waypoint: Waypoint }, { cfg: E2eConfig }>({
	// Parsed and checked once per run, before any page is opened.
	cfg: [
		// Playwright wants a fixture named here; the browser's name is the cheapest one there is.
		async ({ browserName }, use) => {
			void browserName;
			const config = loadE2eConfig();
			assertSafeToRun(config);
			await use(config);
		},
		{ scope: 'worker' }
	],

	waypoint: async ({ cfg }, use, testInfo) => {
		void cfg;
		const folder = join(SCREENSHOTS, testInfo.project.name);
		const spec = basename(testInfo.file).replace(/\.spec\.ts$/, '');
		let count = 0;
		await use(async (page, name) => {
			count += 1;
			if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name)) {
				throw new Error(
					`A waypoint is named in lower-case words joined by hyphens, not "${name}".`
				);
			}
			mkdirSync(folder, { recursive: true });
			const path = join(folder, `${spec}--${String(count).padStart(2, '0')}-${name}.png`);
			await page.screenshot({ path, fullPage: true, animations: 'disabled' });
			await testInfo.attach(name, { path, contentType: 'image/png' });
		});
	}
});

export { expect };

/**
 * Waits until `check` answers something other than null, and returns it. Used instead of
 * Playwright's URL waits wherever the address may carry sign-in values: a timeout here reports
 * only `what`, never an address.
 */
export async function until<T>(
	what: string,
	timeoutMs: number,
	check: () => Promise<T | null>
): Promise<T> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const answer = await check();
		if (answer !== null) return answer;
		if (Date.now() >= deadline) {
			throw new Error(
				`Waited ${Math.round(timeoutMs / 1000)} seconds for ${what}. It did not happen.`
			);
		}
		await new Promise((resolve) => setTimeout(resolve, 500));
	}
}
