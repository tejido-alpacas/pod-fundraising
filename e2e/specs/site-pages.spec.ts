/**
 * The Campaign Site's own pages, as a visitor who is not signed in: the home page, Explore,
 * Give and About in each of the four languages, the language buttons, and where "Sign in"
 * leads. Reads only: the one thing kept is the language choice, in this browser's cookie.
 */
import { expect, test, until } from '../lib/harness.ts';
import { assertQatomPage } from '../lib/safety.ts';

test.use({ storageState: { cookies: [], origins: [] } });

type Lang = 'es' | 'en' | 'fr' | 'pt';
type Words = Record<Lang, string>;

/**
 * Each page's title and main heading in the four languages, as the first Tejido site worded
 * them. They are written out here, not read from the site's code, so a page that shows the
 * wrong language (or none) fails.
 */
const PAGES: { name: string; path: string; title: Words; heading: Words }[] = [
	{
		name: 'home',
		path: '/',
		title: {
			es: 'tejido · La red que nos une.',
			en: 'tejido · Our social fabric.',
			fr: 'tejido · Le tissu qui nous unit.',
			pt: 'tejido · A rede que nos une.'
		},
		heading: {
			es: 'Comunidades latinas que se ayudan, en todas las direcciones.',
			en: 'Latin communities helping each other, in every direction.',
			fr: 'Des communautés latines qui s’entraident, dans toutes les directions.',
			pt: 'Comunidades latinas se ajudando, em todas as direções.'
		}
	},
	{
		name: 'explore',
		path: '/explore',
		title: {
			es: 'Explorar · tejido',
			en: 'Explore · tejido',
			fr: 'Explorer · tejido',
			pt: 'Explorar · tejido'
		},
		heading: { es: 'Explorar', en: 'Explore', fr: 'Explorer', pt: 'Explorar' }
	},
	{
		name: 'give',
		path: '/needs',
		title: {
			es: 'Necesidades abiertas · tejido',
			en: 'Open needs · tejido',
			fr: 'Besoins ouverts · tejido',
			pt: 'Necessidades abertas · tejido'
		},
		heading: { es: 'Dar', en: 'Give', fr: 'Donner', pt: 'Doar' }
	},
	{
		name: 'about',
		path: '/about',
		title: {
			es: 'Cómo funciona Tejido · tejido',
			en: 'How Tejido works · tejido',
			fr: 'Comment fonctionne Tejido · tejido',
			pt: 'Como o Tejido funciona · tejido'
		},
		heading: {
			es: 'Cómo funciona Tejido',
			en: 'How Tejido works',
			fr: 'Comment fonctionne Tejido',
			pt: 'Como o Tejido funciona'
		}
	}
];
const LANGS: Lang[] = ['es', 'en', 'fr', 'pt'];

/** A typed apostrophe and a typographic one are the same word to a reader. */
const sameWords = (text: string) =>
	new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[’']/g, "[’']")}$`);

for (const lang of LANGS) {
	test(`home, Explore, Give and About in ${lang}`, async ({ page, cfg, waypoint }) => {
		for (const { name, path, title, heading } of PAGES) {
			// What the language buttons do: remember the choice, then show the page again.
			await page.goto(`${cfg.siteUrl}/lang?to=${lang}&back=${encodeURIComponent(path)}`);
			await expect(page.locator('html')).toHaveAttribute('lang', lang);
			await expect(page).toHaveTitle(title[lang]);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(sameWords(heading[lang]));
			await waypoint(page, `${name}-${lang}`);
		}
	});
}

test('the page opens in Spanish for a browser that asks for none of the four languages', async ({
	browser,
	cfg
}) => {
	const context = await browser.newContext({ locale: 'de-DE' });
	const page = await context.newPage();
	try {
		await page.goto(`${cfg.siteUrl}/`);
		await expect(page.locator('html')).toHaveAttribute('lang', 'es');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			'Comunidades latinas que se ayudan, en todas las direcciones.'
		);
	} finally {
		await context.close();
	}
});

test('the language buttons change the language and keep the page', async ({
	page,
	cfg,
	waypoint
}) => {
	await page.goto(`${cfg.siteUrl}/about`);
	// The suite's browser asks for English.
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	const buttons = page.getByRole('contentinfo').getByRole('group', { name: 'Language' });
	await expect(buttons.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await buttons.getByRole('button', { name: 'FR', exact: true }).click();
	await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
	await expect(page).toHaveURL(`${cfg.siteUrl}/about`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Comment fonctionne Tejido');
	await expect(
		page
			.getByRole('contentinfo')
			.getByRole('group', { name: 'Langue' })
			.getByRole('button', { name: 'FR', exact: true })
	).toHaveAttribute('aria-pressed', 'true');
	await waypoint(page, 'about-after-choosing-french');

	// The choice is remembered on the next page.
	await page.goto(`${cfg.siteUrl}/explore`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('Explorer');
});

test('the home page leads to Give, Explore, About and Start a campaign', async ({
	page,
	cfg,
	waypoint
}) => {
	await page.goto(`${cfg.siteUrl}/`);
	const main = page.getByRole('main');
	for (const [name, path] of [
		[/^Give now/, '/needs'],
		[/^Explore/, '/explore'],
		[/^Find where to help/, '/explore'],
		[/^Open needs/, '/needs'],
		[/^How it works/, '/about'],
		[/^Start a campaign/, '/campaigns/new']
	] as const) {
		await expect(main.getByRole('link', { name }).first()).toHaveAttribute('href', path);
	}
	await waypoint(page, 'home');

	await main.getByRole('link', { name: /^Start a campaign/ }).click();
	await expect(page).toHaveURL(`${cfg.siteUrl}/campaigns/new`);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('What is the project?');
});

test('Explore and Give list campaigns, or say plainly that there are none', async ({
	page,
	cfg,
	waypoint
}) => {
	const cards = page.getByRole('main').locator('a[href^="/campaigns/"]');

	await page.goto(`${cfg.siteUrl}/explore`);
	await expect(
		cards.first().or(page.getByRole('heading', { name: 'There are no campaigns to follow yet.' }))
	).toBeVisible();
	await waypoint(page, 'explore');
	const listed = await cards.count();

	await page.goto(`${cfg.siteUrl}/needs`);
	await expect(
		cards.first().or(page.getByRole('heading', { name: 'No campaign is raising money right now.' }))
	).toBeVisible();
	await expect(page.getByRole('heading', { name: 'More ways to help' })).toBeVisible();
	await waypoint(page, 'give');

	// A listed campaign opens its own page, with the three tabs a donor reads.
	test.skip(listed === 0, 'No campaign is listed on Explore yet, so there is none to open.');
	await page.goto(`${cfg.siteUrl}/explore`);
	const address = await cards.first().getAttribute('href');
	await cards.first().click();
	await expect(page).toHaveURL(`${cfg.siteUrl}${address ?? ''}`);
	await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
	await expect(page.getByRole('heading', { name: 'What has happened' })).toBeVisible();
	await waypoint(page, 'campaign-from-explore');
});

test('a campaign that does not exist says so', async ({ page, cfg, waypoint }) => {
	const response = await page.goto(`${cfg.siteUrl}/campaigns/no-such-campaign-e2e`);
	expect(response?.status()).toBe(404);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText('We could not find that page');
	await waypoint(page, 'not-found');
});

test('Sign in takes a donor to Qatom’s own sign-in page', async ({
	page,
	cfg,
	waypoint
}, testInfo) => {
	await page.goto(`${cfg.siteUrl}/about`);
	// On a phone the link is inside the menu.
	if (testInfo.project.name === 'phone') {
		await expect(async () => {
			const menu = page.getByRole('button', { name: 'Menu', exact: true });
			if ((await menu.getAttribute('aria-expanded')) !== 'true') await menu.click();
			await expect(page.locator('#mnav')).toBeVisible({ timeout: 1500 });
		}).toPass({ timeout: 30_000 });
	}
	const signIn = page.getByRole('link', { name: 'Sign in', exact: true }).filter({ visible: true });
	await expect(signIn).toHaveAttribute('href', '/auth/sign-in?return_to=%2Fabout');
	await signIn.click();

	// Qatom asks for an email address. Nothing is typed: no code is asked for, ever, here.
	// `until`, not a Playwright wait: a sign-in address must never reach the log.
	const email = page.locator('#email-input');
	await until('Qatom’s sign-in page to ask for an email address', 45_000, async () =>
		(await email.isVisible()) ? true : null
	);
	assertQatomPage(page.url(), cfg);
	await waypoint(page, 'donor-sign-in-at-qatom');
});
