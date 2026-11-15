/**
 * Reads, from a live page, what `describeSeenPage` puts in the log when a test fails: where the
 * page is and what it shows. It reads what a person could see and nothing else: no input's
 * value, no cookie, no storage, and of the address only the host, the path and Qatom's `step`.
 */
import type { Page } from '@playwright/test';
import { describeSeenPage, type SeenPage } from './stuck-page.ts';

/** Never waits on the page: a page that is stuck must not hold up the report of a failure. */
const QUICK = { timeout: 2_000 };

/** What the page shows now. Never throws: whatever was read before the page went away is kept. */
export async function seenOn(page: Page): Promise<SeenPage> {
	const seen: SeenPage = {
		host: '(no page)',
		path: '',
		step: null,
		title: '',
		headings: [],
		buttons: [],
		alerts: [],
		opening: ''
	};
	try {
		const address = new URL(page.url());
		// Anything that is not a web address (a blank or generated page) is named by its kind only.
		const web = address.protocol === 'https:' || address.protocol === 'http:';
		seen.host = web ? address.host : address.protocol;
		seen.path = web ? address.pathname : '';
		seen.step = address.searchParams.get('step');
		seen.title = await page.title();
		for (const heading of await page.getByRole('heading').all()) {
			if (await heading.isVisible()) seen.headings.push(await heading.innerText(QUICK));
		}
		for (const button of await page.getByRole('button').all()) {
			if (!(await button.isVisible())) continue;
			seen.buttons.push({
				text: await button.innerText(QUICK),
				id: await button.getAttribute('id', QUICK),
				disabled: await button.isDisabled(QUICK)
			});
		}
		for (const alert of await page.locator('[role="alert"], [role="status"]').all()) {
			if (await alert.isVisible()) seen.alerts.push(await alert.innerText(QUICK));
		}
		seen.opening = await page.locator('body').innerText(QUICK);
	} catch {
		// The page went away while it was being read. What was read so far is still worth saying.
	}
	return seen;
}

/** The lines for the log, or null when no page was ever opened. */
export async function describePage(page: Page): Promise<string | null> {
	if (page.isClosed() || page.url() === 'about:blank') return null;
	return describeSeenPage(await seenOn(page));
}
