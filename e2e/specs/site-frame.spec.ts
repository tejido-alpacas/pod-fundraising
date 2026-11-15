/**
 * The Campaign Site's frame, as a visitor who is not signed in: the header and its language
 * menu on a desktop, the tab bar and the menu on a phone, and the footer's links. In each of
 * the four languages, and then used: the language is changed and the pages are reached.
 *
 * Reads only. The one thing kept is the language choice, in this browser's cookie.
 * `site-pages.spec.ts` checks the footer's language buttons and where "Sign in" leads; this
 * does not repeat them.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import {
	AT,
	FRAME,
	LANG_NAMES,
	LANGS,
	beginning,
	expectNothingUnfinished,
	whole,
	within,
	type Row
} from '../lib/site-words.ts';

// A press or a typed word waits fifteen seconds for its target, not the whole test's two minutes.
test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

/** The phone-sized project has the tab bar and the menu; the desktop-sized one has the header's links. */
const onPhone = (project: string) => project === 'phone';

/**
 * Opens the phone's menu. Tried again for a moment: a button pressed before the page has
 * finished loading its script does nothing.
 */
async function openMenu(page: Page): Promise<void> {
	await expect(async () => {
		const button = page.getByRole('button', { name: 'Menu', exact: true });
		if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
		await expect(page.getByRole('navigation', { name: 'Menu', exact: true })).toBeVisible({
			timeout: 1500
		});
	}).toPass({ timeout: 30_000 });
}

test('the header, the tab bar and the footer name the pages in each language', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	for (const lang of LANGS) {
		const say = (row: Row) => row[AT[lang]];
		await page.goto(`${cfg.siteUrl}/lang?to=${lang}&back=%2Fabout`);
		await expect(page.locator('html')).toHaveAttribute('lang', lang);

		const pages = page.getByRole('navigation', { name: whole(say(FRAME.mainNavigation)) });
		if (onPhone(testInfo.project.name)) {
			// The tab bar along the bottom: four tabs, and the one for this page is marked.
			const tabs = pages.getByRole('link');
			await expect(tabs).toHaveText(
				[FRAME.tabHome, FRAME.explore, FRAME.tabGive, FRAME.tabAbout].map((row) => whole(say(row)))
			);
			for (const [index, path] of ['/', '/explore', '/needs', '/about'].entries()) {
				await expect(tabs.nth(index)).toHaveAttribute('href', path);
			}
			await expect(tabs.nth(3)).toHaveAttribute('aria-current', 'page');
			await expect(page.getByRole('button', { name: whole(say(FRAME.menu)) })).toHaveAttribute(
				'aria-expanded',
				'false'
			);
		} else {
			// The header: its links, the language menu's button, "Sign in" and "Give now".
			const header = page.getByRole('banner');
			for (const [row, path] of [
				[FRAME.explore, '/explore'],
				[FRAME.openNeeds, '/needs'],
				[FRAME.howItWorks, '/about']
			] as const) {
				await expect(pages.getByRole('link', { name: whole(say(row)) })).toHaveAttribute(
					'href',
					path
				);
			}
			await expect(pages.getByRole('link', { name: whole(say(FRAME.howItWorks)) })).toHaveAttribute(
				'aria-current',
				'page'
			);
			await expect(
				header.getByRole('button', {
					name: `${say(FRAME.language)}: ${say(LANG_NAMES)}`,
					exact: true
				})
			).toHaveAttribute('aria-expanded', 'false');
			await expect(header.getByRole('link', { name: whole(say(FRAME.signIn)) })).toBeVisible();
			await expect(header.getByRole('link', { name: whole(say(FRAME.giveNow)) })).toHaveAttribute(
				'href',
				'/needs'
			);
		}

		// On every screen: the way past the header for a keyboard, and the footer.
		await expect(page.getByRole('link', { name: whole(say(FRAME.skip)) })).toHaveAttribute(
			'href',
			'#main'
		);
		const footer = page.getByRole('contentinfo');
		await expect(
			footer.getByRole('navigation', { name: whole(say(FRAME.footerMore)) }).getByRole('link')
		).toHaveText([
			whole(say(FRAME.explore)),
			whole(say(FRAME.openNeeds)),
			whole(say(FRAME.howItWorks)),
			whole('tejido.org')
		]);
		await expect(footer).toContainText(within(say(FRAME.footerLine)));
		await expect(footer).toContainText(within(say(FRAME.nonpartisan)));
		await expectNothingUnfinished(page);
	}
	await waypoint(page, 'frame-in-portuguese');
});

test('the language is changed from the top of the page, and the page stays', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	// The suite's browser asks for English.
	await page.goto(`${cfg.siteUrl}/explore`);
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	const header = page.getByRole('banner');

	if (onPhone(testInfo.project.name)) {
		// On a phone the languages are in the menu, by their own names.
		await openMenu(page);
		const choices = page
			.getByRole('navigation', { name: 'Menu', exact: true })
			.getByRole('group', { name: 'Language', exact: true })
			.getByRole('button');
		await expect(choices).toHaveText(LANG_NAMES.map((name) => whole(name)));
		for (const [index, lang] of LANGS.entries()) {
			await expect(choices.nth(index)).toHaveAttribute('aria-pressed', String(lang === 'en'));
		}
		await waypoint(page, 'phone-menu-open');
		await choices.nth(AT.pt).click();
	} else {
		// On a desktop they are in the header's language menu.
		const button = header.getByRole('button', { name: 'Language: English', exact: true });
		const choice = (name: string) => header.getByRole('button', { name: beginning(name) });
		await expect(async () => {
			if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click();
			await expect(choice('Português')).toBeVisible({ timeout: 1500 });
		}).toPass({ timeout: 30_000 });
		for (const [index, lang] of LANGS.entries()) {
			const option = choice(LANG_NAMES[index] ?? '');
			await expect(option).toBeVisible();
			await expect(option).toHaveAttribute('aria-pressed', String(lang === 'en'));
		}
		await waypoint(page, 'language-menu-open');
		// Escape closes it; it opens again.
		await page.keyboard.press('Escape');
		await expect(button).toHaveAttribute('aria-expanded', 'false');
		await button.click();
		await expect(button).toHaveAttribute('aria-expanded', 'true');
		await choice('Português').click();
	}

	// The same page, now in Portuguese, and the choice shows as made.
	await expect(page.locator('html')).toHaveAttribute('lang', 'pt');
	await expect(page).toHaveURL(`${cfg.siteUrl}/explore`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explorar');
	if (onPhone(testInfo.project.name)) {
		await expect(page.getByRole('button', { name: 'Menu', exact: true })).toHaveAttribute(
			'aria-expanded',
			'false'
		);
	} else {
		await expect(
			header.getByRole('button', { name: 'Idioma: Português', exact: true })
		).toBeVisible();
	}
});

test('the pages are reached from the header, or from the tab bar and the menu on a phone', async ({
	page,
	cfg
}, testInfo) => {
	const pages = page.getByRole('navigation', { name: 'Main navigation', exact: true });
	const heading = page.getByRole('heading', { level: 1 });

	if (!onPhone(testInfo.project.name)) {
		await page.goto(`${cfg.siteUrl}/`);
		for (const [name, path, title] of [
			['Explore', '/explore', 'Explore'],
			['Open needs', '/needs', 'Give'],
			['How it works', '/about', 'How Tejido works']
		] as const) {
			const link = pages.getByRole('link', { name, exact: true });
			await link.click();
			await expect(page).toHaveURL(`${cfg.siteUrl}${path}`);
			await expect(heading).toHaveText(title);
			await expect(link).toHaveAttribute('aria-current', 'page');
		}
		const header = page.getByRole('banner');
		await header.getByRole('link', { name: 'Give now', exact: true }).click();
		await expect(page).toHaveURL(`${cfg.siteUrl}/needs`);
		// The name at the top left leads home.
		await header.getByRole('link', { name: 'tejido', exact: true }).click();
		await expect(page).toHaveURL(`${cfg.siteUrl}/`);
		await expect(heading).toHaveText('Latin communities helping each other, in every direction.');
		return;
	}

	// The tab bar: each tab opens its page and is then the marked one.
	await page.goto(`${cfg.siteUrl}/about`);
	const tab = (name: string) => pages.getByRole('link', { name, exact: true });
	for (const [name, path, title] of [
		['Home', '/', 'Latin communities helping each other, in every direction.'],
		['Explore', '/explore', 'Explore'],
		['Give', '/needs', 'Give'],
		['About', '/about', 'How Tejido works']
	] as const) {
		await tab(name).click();
		await expect(page).toHaveURL(`${cfg.siteUrl}${path}`);
		await expect(heading).toHaveText(title);
		await expect(tab(name)).toHaveAttribute('aria-current', 'page');
		await expect(pages.locator('[aria-current="page"]')).toHaveCount(1);
	}
	// A campaign's own pages count as Home.
	await page.goto(`${cfg.siteUrl}/campaigns/${cfg.campaignId}`);
	await expect(tab('Home')).toHaveAttribute('aria-current', 'page');

	// The menu: the same three pages as the header has on a desktop, and the sign-in.
	await page.goto(`${cfg.siteUrl}/explore`);
	await openMenu(page);
	const menu = page.getByRole('navigation', { name: 'Menu', exact: true });
	for (const [name, path] of [
		['Explore', '/explore'],
		['Open needs', '/needs'],
		['How it works', '/about']
	] as const) {
		await expect(menu.getByRole('link', { name, exact: true })).toHaveAttribute('href', path);
	}
	await expect(menu.getByRole('link', { name: 'Explore', exact: true })).toHaveAttribute(
		'aria-current',
		'page'
	);
	await expect(menu.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();

	// Escape closes it. A link in it opens its page and closes it too.
	const button = page.getByRole('button', { name: 'Menu', exact: true });
	await page.keyboard.press('Escape');
	await expect(button).toHaveAttribute('aria-expanded', 'false');
	await expect(menu).toBeHidden();
	await openMenu(page);
	await menu.getByRole('link', { name: 'How it works', exact: true }).click();
	await expect(page).toHaveURL(`${cfg.siteUrl}/about`);
	await expect(heading).toHaveText('How Tejido works');
	await expect(button).toHaveAttribute('aria-expanded', 'false');
});
