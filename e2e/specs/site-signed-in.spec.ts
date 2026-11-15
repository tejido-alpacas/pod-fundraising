/**
 * The Campaign Site as the visitor who signed in there (site-sign-in.spec.ts), on a phone-sized
 * and a desktop-sized screen:
 *
 * - the "Start a campaign" button: in the header bar or in its menu, by width and language;
 * - the campaign builder, every step, forwards and then Back through every step again;
 * - signing out.
 *
 * - creating one campaign with the builder's last button, publishing it as its creator, and
 *   what anyone then sees: it is on no public list, and its own page and Give page open.
 *
 * The builder keeps its answers in the browser, and "Continue" only asks the site to check
 * them. ONE CAMPAIGN IS CREATED on each unpaid run that signs in, by the one test that presses
 * "Create campaign", and published by the next. It is the tests' own (its organiser and its two
 * people are at the test inbox), so Tejido keeps it off every public list and deletes it by
 * itself about two hours later. No money is involved. See e2e/README.md.
 */
import type { Page } from '@playwright/test';
import { expect, needsSignIn, test } from '../lib/harness.ts';
import type { E2eConfig } from '../lib/config.ts';
import {
	BUILDER_PATH,
	HEADER_WORDS,
	LANGS,
	menu,
	menuButton,
	openIn,
	openMenu,
	startInBar,
	startInMenu,
	type Lang
} from '../lib/site-header.ts';
import {
	GIVE,
	UNIT,
	amountButtons,
	amountsOffered,
	campaignIdOf,
	giveHeading,
	giveWords,
	say
} from '../lib/give-page.ts';
import { milestoneStatus, openMilestone } from '../lib/milestone-page.ts';
import { whole } from '../lib/site-words.ts';
import { DESKTOP, PHONE } from '../lib/viewports.ts';

needsSignIn();

const SCREENS = [
	{ name: 'phone', use: PHONE },
	{ name: 'desktop', use: DESKTOP }
] as const;

/** The languages whose words leave the header bar no room for the button, at any width. */
const MENU_ONLY: readonly Lang[] = ['fr'];
/** The width from which the bar has room for it, in the other languages. */
const BAR_FROM = 1200;

// ---------------------------------------------------------------------------
// The builder's answers
// ---------------------------------------------------------------------------

/** A date this many days from now, as a date field takes it. */
function inDays(days: number): string {
	return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** "27 Nov 2026": how the builder shows a due date. */
function shownDate(date: string): string {
	return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}

interface Answers {
	title: string;
	summary: string;
	beneficiary: string;
	organiser: string;
	organiserEmail: string;
	goal: string;
	goalShown: string;
	milestone: { title: string; description: string; kind: string; kindHelp: string; due: string };
	worker: { name: string; title: string; email: string };
	confirmer: { name: string; title: string; email: string; reason: string };
	cadence: string;
}

/**
 * Every answer says it is a test, and every address is at example.org, which is reserved for
 * examples: no mail can reach anyone, and nobody can accept an invitation sent there. The one
 * test that creates a campaign puts test-inbox addresses in their place.
 */
function answers(title: string): Answers {
	return {
		title,
		summary: 'An automated check of the campaign builder.',
		beneficiary: 'Nobody: this is a test',
		organiser: 'Tejido automated test',
		organiserEmail: 'automated-test@example.org',
		goal: '8,500.50',
		goalShown: '8,500.50 USD-TDN',
		milestone: {
			title: 'Test milestone, nothing is built',
			description: 'Nothing: this milestone belongs to an automated test.',
			kind: 'Construction',
			kindHelp: 'Something is built or repaired.',
			due: inDays(60)
		},
		worker: {
			name: 'Test Contractor',
			title: 'Contractor',
			email: 'test-contractor@example.org'
		},
		confirmer: {
			name: 'Test Inspector',
			title: 'Building inspector',
			email: 'test-inspector@example.org',
			reason: 'An automated test. Not paid by any project.'
		},
		cadence: 'Every week'
	};
}

const TEST_TITLE = 'Automated test, not a real project';

// ---------------------------------------------------------------------------
// Walking the builder
// ---------------------------------------------------------------------------

const QUESTIONS = [
	{ name: 'Project', title: 'What is the project?' },
	{ name: 'Funding', title: 'How much does the project need?' },
	{ name: 'Milestones', title: 'What will be delivered, and by when?' },
	{ name: 'People', title: 'Who does the work, and who confirms it?' },
	{ name: 'Schedule', title: 'How often is work reported?' },
	{ name: 'Review', title: 'Check it before you create it' }
] as const;

/** The builder is showing this step (1 to 6): its question, and where it is in the six. */
async function onStep(page: Page, number: 1 | 2 | 3 | 4 | 5 | 6): Promise<void> {
	const step = QUESTIONS[number - 1];
	if (!step) throw new Error(`The builder has no step ${String(number)}.`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(step.title);
	await expect(page.getByText(`Step ${String(number)} of 6 · ${step.name}`)).toBeVisible();
}

/** The schedule step's choice for these answers: its name starts with the cadence's words. */
function cadenceChoice(page: Page, a: Answers) {
	return page.getByRole('radio', { name: new RegExp(`^${a.cadence}\\b(?! two)`) });
}

/** The list at the top of a step saying what has to be fixed before going on. */
function problems(page: Page) {
	return page.getByRole('alert').filter({ hasText: /needs? fixing/ });
}

/**
 * Answers the builder from its first step to its last, checking what each step asks for and
 * what it says when its answer is missing. Ends ON the review step with nothing pressed there.
 * Only "Continue" is pressed on the way, which saves nothing. `keep` photographs each step.
 */
async function answerToReview(
	page: Page,
	cfg: E2eConfig,
	a: Answers,
	keep: (name: string) => Promise<void>
): Promise<void> {
	const onward = (to: string) => page.getByRole('button', { name: `Continue to ${to}` });

	// Step 1, the project. Continue only works once the page's script runs, so it is pressed
	// until the page answers: with nothing filled in, it lists what is missing.
	await page.goto(`${cfg.siteUrl}${BUILDER_PATH}`);
	await onStep(page, 1);
	await expect(async () => {
		await onward('funding').click();
		await expect(problems(page)).toBeVisible({ timeout: 5_000 });
	}).toPass({ timeout: 45_000 });
	await page.getByLabel('Project name').fill(a.title);
	await page.getByLabel('What it is').fill(a.summary);
	await page.getByLabel('Who it is for').fill(a.beneficiary);
	await page.getByLabel('Your name, or your group’s').fill(a.organiser);
	await page.getByLabel('Your email').fill(a.organiserEmail);
	await onward('funding').click();

	// Step 2, the funding: one goal, optional, and it has to be a number.
	await onStep(page, 2);
	await expect(page.getByText('Giving is not open yet for a new campaign')).toBeVisible();
	const goal = page.getByLabel('Goal');
	await expect(goal).toHaveValue('');
	await goal.fill('a lot');
	await onward('milestones').click();
	await expect(problems(page)).toContainText(
		'Enter the goal as a number, such as 12,000 or 12000.50.'
	);
	await onStep(page, 2);
	await goal.fill(a.goal);
	await keep('funding');
	await onward('milestones').click();

	// Step 3, the milestones: at least one, each with a name, what is delivered, a kind, a date.
	await onStep(page, 3);
	await expect(page.getByText('No milestones yet')).toBeVisible();
	await onward('people').click();
	await expect(problems(page)).toContainText('Add at least one milestone.');
	await page.getByRole('button', { name: 'Add milestone' }).click();
	await page.getByLabel('Name', { exact: true }).fill(a.milestone.title);
	await page.getByLabel('What will be delivered').fill(a.milestone.description);
	await page.getByLabel('Kind of milestone').selectOption({ label: a.milestone.kind });
	await expect(page.getByText(a.milestone.kindHelp)).toBeVisible();
	await page.getByLabel('Due date').fill(a.milestone.due);
	await keep('milestone-being-added');
	await page.getByRole('button', { name: 'Done editing milestone 1' }).click();
	await expect(page.getByLabel('Due date')).toHaveCount(0);
	const row = page.getByRole('link', { name: new RegExp(a.milestone.title) });
	await expect(row).toContainText(a.milestone.kind);
	await expect(row).toContainText(`Due ${shownDate(a.milestone.due)}`);
	await keep('milestones');
	await onward('people').click();

	// Step 4, the people: someone who does the work, someone else who confirms it, and which of
	// them is named on each milestone.
	await onStep(page, 4);
	await expect(page.getByRole('heading', { name: 'The people doing the work' })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'The people confirming it' })).toBeVisible();
	await onward('schedule').click();
	await expect(problems(page)).toContainText(
		'Add at least one contractor or supplier who does the work.'
	);
	await expect(problems(page)).toContainText('Add at least one person to confirm milestones.');

	await page.getByRole('button', { name: 'Add a contractor or supplier' }).click();
	await page.getByLabel('Name', { exact: true }).fill(a.worker.name);
	await page.getByLabel('What they do').fill(a.worker.title);
	await page.getByLabel('Email for the invitation').fill(a.worker.email);
	await page.getByRole('button', { name: `Done editing ${a.worker.name}` }).click();

	await page.getByRole('button', { name: 'Add a confirmer' }).click();
	await page.getByLabel('Name', { exact: true }).fill(a.confirmer.name);
	await page.getByLabel('Who they are').fill(a.confirmer.title);
	await page.getByLabel('Email for the invitation').fill(a.confirmer.email);
	// A confirmer is also asked how they are related to the project: three choices.
	const related = page.getByRole('group', { name: 'How are they related to the project?' });
	await expect(related.getByRole('radio')).toHaveCount(3);
	await related.getByRole('radio', { name: /^Independent: no stake in the project/ }).check();
	await page.getByLabel('Why', { exact: true }).fill(a.confirmer.reason);
	await keep('confirmer-being-added');
	await page.getByRole('button', { name: `Done editing ${a.confirmer.name}` }).click();

	// With a milestone, a contractor and a confirmer, the step asks who does and who confirms it.
	await expect(
		page.getByRole('heading', { name: 'Who does and who confirms each milestone' })
	).toBeVisible();
	await page
		.getByLabel('Who does the work')
		.selectOption({ label: `${a.worker.name} · ${a.worker.title}` });
	await page
		.getByLabel('Who confirms it')
		.selectOption({ label: `${a.confirmer.name} · ${a.confirmer.title}` });
	await keep('people');
	await onward('schedule').click();

	// Step 5, the schedule: how often work is reported. One choice among several.
	await onStep(page, 5);
	await expect(page.getByText('Reminders are not sent yet')).toBeVisible();
	await onward('review').click();
	await expect(problems(page)).toContainText('Choose how often work is reported.');
	await cadenceChoice(page, a).check();
	await keep('schedule');
	await onward('review').click();

	// Step 6, the review: everything that was answered, and what the last button would do.
	await onStep(page, 6);
	// The facts are looked for anywhere on the page, not in a particular layout.
	const review = page.getByRole('main');
	for (const fact of [
		a.title,
		a.summary,
		a.beneficiary,
		a.organiser,
		a.organiserEmail,
		a.goalShown,
		a.milestone.title,
		a.milestone.kind,
		shownDate(a.milestone.due),
		a.milestone.description,
		a.worker.name,
		a.worker.title,
		a.confirmer.name,
		a.confirmer.title,
		a.confirmer.reason,
		a.cadence
	]) {
		await expect(review).toContainText(fact);
	}
	for (const step of QUESTIONS.slice(0, 5)) {
		await expect(review.getByRole('heading', { name: step.name, exact: true })).toBeVisible();
	}
	await expect(page.getByText('What “Create campaign” does')).toBeVisible();
	await expect(page.getByText('It saves the campaign as a draft.')).toBeVisible();
	await expect(page.getByRole('button', { name: 'Create campaign', exact: true })).toBeEnabled();
}

// ---------------------------------------------------------------------------
// On each screen
// ---------------------------------------------------------------------------

for (const screen of SCREENS) {
	test.describe(`on a ${screen.name}`, () => {
		test.use(screen.use);
		const wide = screen.name === 'desktop';

		for (const lang of LANGS) {
			const inBar = wide && !MENU_ONLY.includes(lang);

			test(`“Start a campaign” is in the header’s ${inBar ? 'bar' : 'menu'}, in ${lang}`, async ({
				page,
				cfg,
				waypoint
			}) => {
				const words = HEADER_WORDS[lang];
				await openIn(page, cfg, lang, '/about');

				if (inBar) {
					// The bar has room: the button is in it, and the bar needs no menu.
					await expect(startInBar(page)).toBeVisible();
					await expect(startInBar(page)).toHaveText(words.start);
					await expect(menuButton(page, lang)).toBeHidden();
					await expect(
						page
							.getByRole('banner')
							.getByRole('button', { name: words.signOut, exact: true })
							.filter({ visible: true })
					).toHaveCount(1);
				} else {
					// No room in the bar: the button is in the menu, and the menu is in reach.
					await expect(startInBar(page)).toBeHidden();
					await openMenu(page, lang);
					await expect(startInMenu(page)).toBeVisible();
					await expect(startInMenu(page)).toHaveText(words.start);
					await expect(menu(page).getByText(`${words.signedInAs}${cfg.donor.email}`)).toBeVisible();
				}
				await waypoint(page, `${screen.name}-start-a-campaign-${lang}`);

				// Either way it leads to the builder.
				await (inBar ? startInBar(page) : startInMenu(page)).click();
				await expect(page).toHaveURL(`${cfg.siteUrl}${BUILDER_PATH}`);
				await expect(page.getByRole('heading', { level: 1 })).toHaveText('What is the project?');
			});
		}

		if (wide) {
			test(`“Start a campaign” moves from the menu to the bar at ${String(BAR_FROM)} pixels wide`, async ({
				page,
				cfg,
				waypoint
			}) => {
				const height = screen.use.viewport.height;
				await openIn(page, cfg, 'en', '/about');

				await page.setViewportSize({ width: BAR_FROM - 1, height });
				await expect(startInBar(page)).toBeHidden();
				await openMenu(page, 'en');
				await expect(startInMenu(page)).toBeVisible();
				await waypoint(page, `${screen.name}-one-pixel-narrower-in-the-menu`);

				await page.setViewportSize({ width: BAR_FROM, height });
				await expect(startInBar(page)).toBeVisible();
				await expect(menuButton(page, 'en')).toBeHidden();
				await waypoint(page, `${screen.name}-at-the-width-in-the-bar`);

				// In French the bar has no room at this width or any wider one.
				await page.setViewportSize({ width: 1920, height });
				await expect(startInBar(page)).toBeVisible();
				await openIn(page, cfg, 'fr', '/about');
				await expect(startInBar(page)).toBeHidden();
				await openMenu(page, 'fr');
				await expect(startInMenu(page)).toBeVisible();
				await waypoint(page, `${screen.name}-widest-french-in-the-menu`);
			});
		}

		test('the campaign builder, every step, and Back keeps every answer', async ({
			page,
			cfg,
			waypoint
		}) => {
			const a = answers(TEST_TITLE);
			await answerToReview(page, cfg, a, (name) => waypoint(page, `${screen.name}-${name}`));
			await waypoint(page, `${screen.name}-review`);

			// Back, step by step, from the last to the first. Nothing was pressed on the review.
			const back = page.getByRole('link', { name: 'Back', exact: true });

			await back.click();
			await onStep(page, 5);
			await expect(cadenceChoice(page, a)).toBeChecked();

			await back.click();
			await onStep(page, 4);
			await expect(page.getByRole('link', { name: new RegExp(a.worker.name) })).toContainText(
				a.worker.title
			);
			await expect(page.getByRole('link', { name: new RegExp(a.confirmer.name) })).toContainText(
				a.confirmer.title
			);
			await expect(page.getByLabel('Who does the work').locator('option:checked')).toHaveText(
				`${a.worker.name} · ${a.worker.title}`
			);
			await expect(page.getByLabel('Who confirms it').locator('option:checked')).toHaveText(
				`${a.confirmer.name} · ${a.confirmer.title}`
			);

			await back.click();
			await onStep(page, 3);
			// The milestone's row opens it again, with what was typed.
			await page.getByRole('link', { name: new RegExp(a.milestone.title) }).click();
			await expect(page.getByLabel('Name', { exact: true })).toHaveValue(a.milestone.title);
			await expect(page.getByLabel('What will be delivered')).toHaveValue(a.milestone.description);
			await expect(page.getByLabel('Kind of milestone').locator('option:checked')).toHaveText(
				a.milestone.kind
			);
			await expect(page.getByLabel('Due date')).toHaveValue(a.milestone.due);

			await back.click();
			await onStep(page, 2);
			await expect(page.getByLabel('Goal')).toHaveValue(a.goal);

			await back.click();
			await onStep(page, 1);
			await expect(page.getByLabel('Project name')).toHaveValue(a.title);
			await expect(page.getByLabel('What it is')).toHaveValue(a.summary);
			await expect(page.getByLabel('Who it is for')).toHaveValue(a.beneficiary);
			await expect(page.getByLabel('Your name, or your group’s')).toHaveValue(a.organiser);
			await expect(page.getByLabel('Your email')).toHaveValue(a.organiserEmail);
			// The first step has no Back: it offers Cancel, which leaves the builder.
			await expect(back).toHaveCount(0);
			await expect(page.getByRole('link', { name: 'Cancel', exact: true })).toHaveAttribute(
				'href',
				'/'
			);
			await waypoint(page, `${screen.name}-back-at-the-first-step`);
		});
	});
}

// ---------------------------------------------------------------------------
// Creating a campaign, publishing it, and what the public then sees
// ---------------------------------------------------------------------------

/**
 * One campaign per run, the tests' own: its organiser is the signed-in visitor and its two
 * people have addresses at the test inbox, where nobody signs in. Tejido leaves such a campaign
 * off every public list whatever its state, and deletes it by itself about two hours later.
 * No money is involved in any step.
 *
 * Not on a paid run: that run already created a campaign of its own, and the site creates at
 * most 20 an hour counting everyone, real organisers included.
 */
test.describe('creating and publishing a campaign', () => {
	test.use(DESKTOP);
	// In order, the rest left out once one fails. Never retried: a retry would create another.
	test.describe.configure({ mode: 'serial', retries: 0 });

	/** What the first step made, for the steps after it. */
	let made: { title: string; path: string; id: string } | null = null;
	const madeOrSkip = (): { title: string; path: string; id: string } => {
		test.skip(made === null, 'Not checked: no campaign was created in this run.');
		if (made === null) throw new Error('No campaign was created in this run.');
		return made;
	};
	const notOnPaidRuns = (paid: boolean) =>
		test.skip(
			paid,
			'Not on a paid run: it already created a campaign of its own, and the site creates at ' +
				'most 20 campaigns an hour. Unpaid runs check this.'
		);

	test('“Create campaign” shows the created screen, and the draft is on no public list', async ({
		page,
		browser,
		cfg,
		waypoint
	}) => {
		notOnPaidRuns(cfg.paid);

		// Its own name, so this run's campaign cannot be mistaken for an earlier one. The
		// organiser is the signed-in visitor, so that person can publish it; the two people are at
		// the test inbox, so the campaign is the tests' own.
		const inbox = cfg.donor.email.slice(cfg.donor.email.indexOf('@') + 1);
		const base = answers(`Automated test ${Date.now().toString(36)}, not a real campaign`);
		const a: Answers = {
			...base,
			organiserEmail: cfg.donor.email,
			worker: { ...base.worker, email: `e2e-builder-contractor@${inbox}` },
			confirmer: { ...base.confirmer, email: `e2e-builder-inspector@${inbox}` }
		};
		await answerToReview(page, cfg, a, () => Promise.resolve());

		// THE ONE PRESS THAT CREATES. Once, and never again in this run.
		await page.getByRole('button', { name: 'Create campaign', exact: true }).click();
		const created = page.getByText('Campaign created', { exact: true });
		const refused = page.getByRole('alert').filter({ hasText: 'Not created: try again later' });
		await expect(created.or(refused)).toBeVisible({ timeout: 45_000 });
		if (await refused.isVisible()) {
			// Not a fault: the site's own limit, shared with real organisers and the paid runs.
			const notice =
				'NOT CREATED: the site creates at most 20 campaigns an hour, counting everyone, and ' +
				'that many were just created. Nothing was saved. The steps after this one are left out.';
			console.log(`::warning title=End-to-end: campaign not created::${notice}`);
			test.skip(true, notice);
		}

		// What the creator is shown: the campaign's name, that it is a draft, the way to its page,
		// one invitation link for each of the two people, into the App, and the button that
		// publishes it.
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(a.title);
		await expect(page.getByText('Saved as a draft. It is on no public list')).toBeVisible();
		const path = await page
			.getByRole('link', { name: 'Open the campaign’s page', exact: true })
			.getAttribute('href');
		expect(path ?? '', 'The created campaign should have a page of its own.').toMatch(
			/^\/campaigns\/[a-z0-9]+(-[a-z0-9]+)*$/
		);
		if (path === null) throw new Error('The created campaign has no page to open.');
		const invitations = page
			.getByRole('region', { name: 'Invitation links' })
			.locator('a[href*="/invite/"]');
		await expect(invitations).toHaveCount(2);
		for (const invitation of await invitations.all()) {
			expect((await invitation.getAttribute('href')) ?? '').toContain(`${cfg.appUrl}/invite/`);
		}
		await expect(page.getByRole('heading', { name: 'This campaign is a draft' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Publish campaign', exact: true })).toBeEnabled();
		// No picture of this page: the two invitation links on it are for those two people only.
		made = { title: a.title, path, id: campaignIdOf(path) };

		// As anyone else, signed out: the draft is on none of the three pages that list campaigns,
		// and its own link does open it, as the page said.
		const stranger = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		try {
			const visitor = await stranger.newPage();
			await expectOnNoList(visitor, cfg.siteUrl, made);
			const response = await visitor.goto(`${cfg.siteUrl}${path}`);
			expect(response?.status()).toBe(200);
			await expect(visitor.getByRole('heading', { level: 1 })).toHaveText(a.title);
			// A draft is not raising money: its page offers no way to give.
			await expect(visitor.getByRole('link', { name: 'Give to this campaign' })).toHaveCount(0);
			await waypoint(visitor, 'created-draft-by-its-link');
		} finally {
			await stranger.close();
		}
	});

	test('its creator publishes it, and its page then offers “Give to this campaign”', async ({
		page,
		cfg,
		waypoint
	}) => {
		notOnPaidRuns(cfg.paid);
		const campaign = madeOrSkip();

		// The creator, signed in, on the draft's own page: it says it is a draft and offers the
		// button. Nobody could give to it yet.
		await page.goto(`${cfg.siteUrl}${campaign.path}`);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(campaign.title);
		await expect(page.getByRole('heading', { name: 'This campaign is a draft' })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Give to this campaign' })).toHaveCount(0);
		const publish = page.getByRole('button', { name: 'Publish campaign', exact: true });
		await waypoint(page, 'draft-before-publishing');

		// THE ONE PRESS THAT PUBLISHES. Pressed until the page's script takes it, once it has.
		await expect(async () => {
			if (await publish.isVisible()) await publish.click();
			await expect(page.getByRole('status').filter({ hasText: 'Campaign published' })).toBeVisible({
				timeout: 5_000
			});
		}).toPass({ timeout: 45_000 });
		await expect(page.getByRole('status').filter({ hasText: 'Not published' })).toHaveCount(0);

		// It is now a campaign that is raising money: no longer a draft, nothing left to publish,
		// and its page leads to its Give page.
		await expect(page.getByRole('heading', { name: 'This campaign is a draft' })).toHaveCount(0);
		await expect(publish).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Give to this campaign' })).toHaveAttribute(
			'href',
			`/give/${campaign.id}`
		);
		await waypoint(page, 'published');

		// And it stays so for the creator who comes back.
		await page.reload();
		await expect(page.getByRole('heading', { name: 'This campaign is a draft' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Give to this campaign' })).toBeVisible();
	});

	test.describe('as anyone, signed out', () => {
		test.use({ storageState: { cookies: [], origins: [] } });

		test('once published, the test campaign is still on no public list, and opens by its address', async ({
			page,
			cfg,
			waypoint
		}) => {
			notOnPaidRuns(cfg.paid);
			const campaign = madeOrSkip();

			// Home, Explore and the Give list: none links to it or names it.
			await expectOnNoList(page, cfg.siteUrl, campaign);

			// Its own page opens for anyone who has the address, and offers the way to give.
			const response = await page.goto(`${cfg.siteUrl}${campaign.path}`);
			expect(response?.status(), 'The published test campaign’s own page should open.').toBe(200);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(campaign.title);
			await expect(page.getByRole('link', { name: 'Give to this campaign' })).toHaveAttribute(
				'href',
				`/give/${campaign.id}`
			);
			await waypoint(page, 'published-by-its-address');

			// Its one milestone has its own page, and nothing has been reported on it.
			await openMilestone(page, cfg.siteUrl, campaign.id, 'Test milestone, nothing is built');
			expect(await milestoneStatus(page)).toBe('Not started');
		});

		test('its Give page opens by its address and lists the amounts on sale', async ({
			page,
			cfg,
			waypoint
		}, testInfo) => {
			notOnPaidRuns(cfg.paid);
			const campaign = madeOrSkip();

			const response = await page.goto(`${cfg.siteUrl}/give/${campaign.id}`);
			expect(response?.status(), 'The published test campaign’s Give page should open.').toBe(200);
			const main = page.getByRole('main');
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(
				giveHeading('en', campaign.title)
			);
			// It is raising money: the page does not say otherwise.
			await expect(main.getByText(whole(giveWords('en', GIVE.notRaising)))).toHaveCount(0);

			// The amounts on sale, each once and smallest first; or the plain statement that giving
			// is not available, when Qatom lists no donation item or could not be asked. NOTHING IS
			// PRESSED: the run's one unpaid checkout is made elsewhere (site-give.spec.ts).
			const unavailable = main.getByText(whole(giveWords('en', GIVE.notAvailable)));
			await expect(amountButtons(page).first().or(unavailable)).toBeVisible();
			if ((await amountButtons(page).count()) === 0) {
				await expect(unavailable).toBeVisible();
				await waypoint(page, 'published-give-not-available');
				say(
					testInfo,
					'The published test campaign’s Give page says giving is not available (Qatom lists no donation item, or could not be asked).'
				);
				return;
			}
			const offered = await amountsOffered(page);
			await expect(unavailable).toHaveCount(0);
			await waypoint(page, 'published-give-amounts');
			say(
				testInfo,
				`The published test campaign’s Give page offers ${offered.join(', ')} ${UNIT}. None was pressed.`
			);
		});
	});
});

/** Home, Explore and the Give list neither link to the campaign nor name it. */
async function expectOnNoList(
	page: Page,
	siteUrl: string,
	campaign: { title: string; path: string }
): Promise<void> {
	for (const list of ['/', '/explore', '/needs']) {
		await page.goto(`${siteUrl}${list}`);
		await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		await expect(
			page.locator(`a[href^="${campaign.path}"]`),
			`${list} should not link to the test campaign.`
		).toHaveCount(0);
		await expect(
			page.getByText(campaign.title),
			`${list} should not name the test campaign.`
		).toHaveCount(0);
	}
}

// ---------------------------------------------------------------------------
// Signing out. Last, and each in a browser of its own.
// ---------------------------------------------------------------------------

for (const screen of SCREENS) {
	test.describe(`signing out, on a ${screen.name}`, () => {
		test.use(screen.use);
		const wide = screen.name === 'desktop';
		const words = HEADER_WORDS.en;

		test('Sign out ends the session on the Campaign Site', async ({ page, cfg, waypoint }) => {
			await page.goto(`${cfg.siteUrl}/about`);
			if (!wide) await openMenu(page, 'en');
			const header = page.getByRole('banner');
			const signOut = header
				.getByRole('button', { name: words.signOut, exact: true })
				.filter({ visible: true });
			await expect(signOut).toHaveCount(1);
			await waypoint(page, `${screen.name}-before-signing-out`);
			await signOut.click();

			// Back on the same page, with Sign in where Sign out was and no way to the builder
			// in the header.
			const signIn = header
				.getByRole('link', { name: words.signIn, exact: true })
				.filter({ visible: true });
			const signedOut = async () => {
				await expect(page).toHaveURL(`${cfg.siteUrl}/about`);
				if (!wide) await openMenu(page, 'en');
				await expect(signIn).toHaveCount(1);
				await expect(header.getByRole('button', { name: words.signOut, exact: true })).toHaveCount(
					0
				);
				await expect(header.locator(`a[href="${BUILDER_PATH}"]`)).toHaveCount(0);
				await expect(header.getByText(cfg.donor.email)).toHaveCount(0);
			};
			await signedOut();
			await waypoint(page, `${screen.name}-after-signing-out`);

			// And it stays ended: the same browser, asked again, is still signed out.
			await page.reload();
			await signedOut();
		});
	});
}
