/**
 * The chat opened for one milestone, the way a reminder's button opens it
 * (`/chat?milestone=<id>`). Signed in. No message is sent, so no model is called.
 *
 * The milestone used is the LAST one on the test campaign. Opened without a milestone, the
 * chat names the first one it finds due, so naming a different one shows the link was read.
 */
import { expect, needsSignIn, test } from '../lib/harness.ts';
import { CONFIRMER_STATE } from '../lib/paths.ts';
import type { E2eConfig } from '../lib/config.ts';
import type { Page } from '@playwright/test';

needsSignIn();

/** The assistant's opening words. The page writes them itself: no model is asked. */
const greeting = (page: Page) => page.locator('.log .tj-msg--assistant').first();
/** The milestone the opening words name. (The first name in bold is the project's.) */
const named = (page: Page) => greeting(page).locator('strong').nth(1);

/** Counts what the page sends to the assistant from now on. These checks must send nothing. */
function countMessages(page: Page): () => number {
	let sent = 0;
	page.on('request', (request) => {
		if (new URL(request.url()).pathname === '/api/chat') sent += 1;
	});
	return () => sent;
}

/** The id of the test campaign's last milestone, read from its public list as a donor sees it. */
async function lastMilestoneId(page: Page, cfg: E2eConfig): Promise<string> {
	const base = `/campaigns/${cfg.campaignId}/milestones`;
	await page.goto(`${cfg.siteUrl}${base}`);
	const links = page.getByRole('main').locator(`a[href^="${base}/"]`);
	await expect(links.first()).toBeVisible();
	const address = await links.last().getAttribute('href');
	const id = address?.slice(base.length + 1) ?? '';
	expect(id, 'A milestone’s page should be named by its id.').toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
	return id;
}

/** The milestone the chat names when it is opened with no milestone in its address. */
async function usualMilestone(page: Page, cfg: E2eConfig): Promise<string> {
	await page.goto(`${cfg.appUrl}/chat`);
	await expect(greeting(page)).toContainText('You’re signed in as');
	return (await named(page).innerText()).trim();
}

test('a reminder’s button opens the chat for that milestone, and the chat names it', async ({
	page,
	cfg,
	waypoint
}) => {
	const id = await lastMilestoneId(page, cfg);
	const usual = await usualMilestone(page, cfg);
	const messages = countMessages(page);

	// The reminder for that milestone, and its one button.
	await page.goto(`${cfg.appUrl}/reminder?milestone=${id}`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Milestone \d+ (is|was) due /);
	const reminder = await page.getByRole('main').innerText();
	await page.getByRole('link', { name: 'Report on this milestone' }).click();
	await expect(page).toHaveURL(`${cfg.appUrl}/chat?milestone=${id}`);

	// The chat says what the reminder was about: the same milestone the reminder page named,
	// and not the one it would open with otherwise.
	await expect(greeting(page)).toContainText('Your reminder is about');
	const title = (await named(page).innerText()).trim();
	expect(title, 'The chat should name the milestone its address asks for.').not.toBe(usual);
	expect(reminder, 'The chat should name the milestone the reminder was about.').toContain(title);

	// Its first button is about that milestone. It is not pressed: pressing it asks the model.
	await expect(page.getByRole('button', { name: 'Report on this milestone' })).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Log this week’s work' })).toHaveCount(0);
	await expect(page.locator('.log .tj-msg--human')).toHaveCount(0);
	expect(messages(), 'Opening the chat should send the assistant nothing.').toBe(0);
	await waypoint(page, 'chat-for-one-milestone');
});

test('a chat link naming a milestone that is not this person’s shows nothing of it', async ({
	page,
	cfg,
	waypoint
}) => {
	const usual = await usualMilestone(page, cfg);
	const messages = countMessages(page);

	// The App does not say the link was wrong: it leaves the milestone out and opens the chat
	// as it always does. (The reminder PAGE is where a person is told "not for you".)
	await page.goto(`${cfg.appUrl}/chat?milestone=no-such-milestone-e2e`);
	await expect(greeting(page)).toContainText('Next due from you:');
	await expect(greeting(page)).not.toContainText('Your reminder is about');
	await expect(named(page)).toHaveText(usual);
	await expect(page.getByText('no-such-milestone-e2e')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Log this week’s work' })).toBeEnabled();
	await expect(page.getByRole('button', { name: 'Report on this milestone' })).toHaveCount(0);
	expect(messages(), 'Opening the chat should send the assistant nothing.').toBe(0);
	await waypoint(page, 'chat-milestone-not-theirs');
});

test.describe('as the confirmer', () => {
	test.use({ storageState: CONFIRMER_STATE });

	test('the chat opened for a milestone they confirm names it, and offers no confirmation yet', async ({
		page,
		cfg,
		waypoint
	}) => {
		const id = await lastMilestoneId(page, cfg);
		const usual = await usualMilestone(page, cfg);
		const messages = countMessages(page);

		await page.goto(`${cfg.appUrl}/chat?milestone=${id}`);
		await expect(greeting(page)).toContainText('You’re signed in as');
		const title = (await named(page).innerText()).trim();
		expect(title, 'The chat should name the milestone its address asks for.').not.toBe(usual);

		// Nothing on the test campaign has been reported as done, so there is nothing to confirm,
		// and the chat says so rather than offering to confirm it.
		await expect(greeting(page)).toContainText(`You confirm ${title}`);
		await expect(greeting(page)).toContainText('It hasn’t been reported as complete yet.');
		await expect(page.getByRole('button', { name: 'Confirm this milestone' })).toHaveCount(0);
		expect(messages(), 'Opening the chat should send the assistant nothing.').toBe(0);
		await waypoint(page, 'confirmer-chat-for-one-milestone');
	});
});
