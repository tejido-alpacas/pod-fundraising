/**
 * The test campaign's pages (overview, milestones, one milestone, the delivery report) for a
 * donor reading in Spanish, French or Portuguese. `site-walk.spec.ts` walks them in English.
 *
 * What is checked is what holds in every language: each page opens, it is marked as being in
 * the donor's language, everything around it (the header or tab bar, the footer) is in that
 * language, its main heading is there, and nothing shows the name of a translation instead of
 * words.
 *
 * NOT checked, because it is not so today: that the campaign pages' own words are in the
 * donor's language. The site has translations for its frame and for home, Explore, Give and
 * About only. A campaign's pages ("Milestones", "What has happened", "The original goal") are
 * written in English alone, so there is no translation for them to fall back from. Each test
 * says so in the report. When those pages are translated, their headings belong here.
 *
 * Reads only. The one thing kept is the language choice, in this browser's cookie.
 */
import { expect, test } from '../lib/harness.ts';
import {
	AT,
	FRAME,
	expectNothingUnfinished,
	whole,
	within,
	type Lang,
	type Row
} from '../lib/site-words.ts';

// A press or a typed word waits fifteen seconds for its target, not the whole test's two minutes.
test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

const OTHER_LANGS: Lang[] = ['es', 'fr', 'pt'];

for (const lang of OTHER_LANGS) {
	test(`the test campaign’s pages open for a donor reading in ${lang}`, async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		testInfo.annotations.push({
			type: 'not checked',
			description:
				'The words of the campaign pages themselves: they are in English in every language today. ' +
				'Only the header, tab bar and footer around them are translated, and those are checked.'
		});
		const say = (row: Row) => row[AT[lang]];
		const base = `/campaigns/${cfg.campaignId}`;
		const heading = page.getByRole('heading', { level: 1 });

		/** What every one of these pages must show, whatever it is about. */
		const expectInLanguage = async () => {
			await expect(page.locator('html')).toHaveAttribute('lang', lang);
			await expect(heading).toBeVisible();
			await expect(heading).toHaveText(/\S/);
			await expect(page).toHaveTitle(/\S · Tejido$/);
			// The header's links on a desktop, the tab bar on a phone: named in this language.
			await expect(
				page
					.getByRole('navigation', { name: whole(say(FRAME.mainNavigation)) })
					.getByRole('link', { name: whole(say(FRAME.explore)) })
			).toHaveAttribute('href', '/explore');
			await expect(page.getByRole('contentinfo')).toContainText(within(say(FRAME.footerLine)));
			await expect(page.getByRole('contentinfo')).toContainText(within(say(FRAME.nonpartisan)));
			await expectNothingUnfinished(page);
		};

		// The overview, with the campaign's own three tabs.
		const overview = await page.goto(
			`${cfg.siteUrl}/lang?to=${lang}&back=${encodeURIComponent(base)}`
		);
		expect(overview?.status(), 'The overview should open.').toBe(200);
		await expect(page).toHaveURL(`${cfg.siteUrl}${base}`);
		await expectInLanguage();
		const title = (await heading.innerText()).trim();
		const main = page.getByRole('main');
		for (const path of [base, `${base}/milestones`, `${base}/report`]) {
			await expect(main.locator(`a[href="${path}"]`).first()).toBeVisible();
		}
		// One picture for each language, of the overview: four more pictures of English pages would add
		// seconds to every run and show nothing the English walk's pictures do not.
		await waypoint(page, `overview-${lang}`);

		// The milestones, each with a page of its own.
		const milestones = await page.goto(`${cfg.siteUrl}${base}/milestones`);
		expect(milestones?.status(), 'The milestones should open.').toBe(200);
		await expectInLanguage();
		await expect(page).toHaveTitle(within(title));
		const links = main.locator(`a[href^="${base}/milestones/"]`);
		await expect(links.first()).toBeVisible();

		// One milestone.
		const address = await links.first().getAttribute('href');
		const milestone = await page.goto(`${cfg.siteUrl}${address ?? ''}`);
		expect(milestone?.status(), 'A milestone should open.').toBe(200);
		await expectInLanguage();
		await expect(page).toHaveTitle(within(title));

		// The delivery report: its main heading is the campaign's own title.
		const report = await page.goto(`${cfg.siteUrl}${base}/report`);
		expect(report?.status(), 'The delivery report should open.').toBe(200);
		await expectInLanguage();
		await expect(heading).toHaveText(whole(title));
	});
}
