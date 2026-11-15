/**
 * The Give page (/give/<campaign>) for a donor reading in Spanish, English, French or
 * Portuguese, at phone and desktop size. `site-give.spec.ts` walks it in English.
 *
 * Two campaigns are read. The suite's own test campaign is a draft and is always there: its
 * Give page says it is not raising money, in the donor's language, and offers no amount. A
 * campaign that is raising money, when the site lists one: its Give page offers the same
 * amounts in every language, each button worded in that language, or says in that language
 * that giving is not available. That second part is skipped, saying why, when no campaign is
 * raising money.
 *
 * Reads only: no amount is pressed, so no checkout is made at Qatom. The one thing kept is the
 * language choice, in this browser's cookie.
 */
import type { Page } from '@playwright/test';
import { expect, test } from '../lib/harness.ts';
import {
	GIVE,
	UNIT,
	amountButtons,
	amountsOffered,
	campaignIdOf,
	campaignsRaisingMoney,
	giveHeading,
	giveWords,
	openIn,
	unfinishedGiveWords,
	say
} from '../lib/give-page.ts';
import {
	FRAME,
	LANGS,
	AT,
	escaped,
	expectNothingUnfinished,
	whole,
	within,
	type Lang,
	type Row
} from '../lib/site-words.ts';

// A press waits fifteen seconds for its target, not the whole test's two minutes.
test.use({ storageState: { cookies: [], origins: [] }, actionTimeout: 15_000 });

/** The campaign's title, read from its Give page in English: "Give to <title>". */
async function titleOf(page: Page, siteUrl: string, id: string): Promise<string> {
	await openIn(page, siteUrl, 'en', `/give/${id}`);
	const heading = (await page.getByRole('heading', { level: 1 }).innerText()).trim();
	expect(heading, 'The Give page’s heading in English.').toMatch(/^Give to \S/);
	return heading.replace(/^Give to /, '');
}

/** What every Give page shows in the donor's language, whatever the campaign's state. */
async function expectGivePageIn(page: Page, lang: Lang, id: string, title: string): Promise<void> {
	const say = (row: Row) => row[AT[lang]];
	const main = page.getByRole('main');

	await expect(page.locator('html')).toHaveAttribute('lang', lang);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(whole(giveHeading(lang, title)));
	await expect(page).toHaveTitle(whole(`${giveHeading(lang, title)} · tejido`));
	// Under the heading: who organises it, in this language.
	await expect(main).toContainText(
		new RegExp(escaped(say(GIVE.organisedBy)).replace('\\{name\\}', '\\S'))
	);

	// The way back, in this language, to this campaign's own page.
	await expect(main.getByRole('link', { name: within(say(GIVE.back)) })).toHaveAttribute(
		'href',
		`/campaigns/${id}`
	);

	// Everything around the page is in this language too.
	await expect(
		page
			.getByRole('navigation', { name: whole(say(FRAME.mainNavigation)) })
			.getByRole('link', { name: whole(say(FRAME.explore)) })
	).toHaveAttribute('href', '/explore');
	await expect(page.getByRole('contentinfo')).toContainText(within(say(FRAME.footerLine)));

	// Words everywhere, never the name of a translation or an unfilled blank.
	await expectNothingUnfinished(page);
	expect(
		unfinishedGiveWords(await main.innerText()),
		'The Give page shows the name of a translation instead of words.'
	).toBeNull();
}

for (const lang of LANGS) {
	test(`in ${lang}, the Give page of a campaign that is not raising money says so and offers no amount`, async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		// The test campaign is a draft: it is not raising money.
		const id = cfg.campaignId;
		const title = await titleOf(page, cfg.siteUrl, id);

		const response = await openIn(page, cfg.siteUrl, lang, `/give/${id}`);
		expect(response?.status(), 'The Give page should open.').toBe(200);
		await expectGivePageIn(page, lang, id, title);

		const main = page.getByRole('main');
		await expect(main.getByText(whole(giveWords(lang, GIVE.notRaising)))).toBeVisible();
		// No amount, no form, no button of any kind: nothing here can start a checkout.
		await expect(main.getByRole('button')).toHaveCount(0);
		await expect(main.locator('form')).toHaveCount(0);
		await expect(
			main.getByRole('heading', { name: whole(giveWords(lang, GIVE.choose)) })
		).toHaveCount(0);
		await expect(main.getByText(whole(giveWords(lang, GIVE.payOnQatom)))).toHaveCount(0);
		// Nothing was asked, so no problem is reported.
		await expect(main.getByRole('alert')).toHaveCount(0);
		// One picture per language of this small page, at each size.
		await waypoint(page, `give-not-raising-${lang}`);

		// The way back leads to the campaign's own page.
		await main.getByRole('link', { name: within(giveWords(lang, GIVE.back)) }).click();
		await expect(page).toHaveURL(`${cfg.siteUrl}/campaigns/${id}`);
		say(testInfo, `In ${lang}: "${giveHeading(lang, title)}", not raising money, no button.`);
	});
}

for (const lang of LANGS) {
	test(`in ${lang}, the Give page of a campaign raising money offers its amounts, or says giving is not available`, async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		const [address] = await campaignsRaisingMoney(page, cfg.siteUrl);
		test.skip(
			address === undefined,
			'No campaign is raising money on the site now, so there is no open Give page to read.'
		);
		const id = campaignIdOf(address ?? '');
		const title = await titleOf(page, cfg.siteUrl, id);

		// In English first: what is on sale now. Nothing is pressed.
		const main = page.getByRole('main');
		await expect(
			amountButtons(page, 'en')
				.first()
				.or(main.getByText(whole(giveWords('en', GIVE.notAvailable))))
		).toBeVisible();
		const inEnglish = await amountsOffered(page, 'en');

		const response = await openIn(page, cfg.siteUrl, lang, `/give/${id}`);
		expect(response?.status(), 'The Give page should open.').toBe(200);
		await expectGivePageIn(page, lang, id, title);
		await expect(main.getByText(whole(giveWords(lang, GIVE.notRaising)))).toHaveCount(0);
		await expect(main.getByRole('alert')).toHaveCount(0);

		await expect(
			amountButtons(page, lang)
				.first()
				.or(main.getByText(whole(giveWords(lang, GIVE.notAvailable))))
		).toBeVisible();
		const offered = await amountsOffered(page, lang);

		if (offered.length === 0) {
			// Giving is not available: said in this language, and nothing to press.
			await expect(main.getByText(whole(giveWords(lang, GIVE.notAvailable)))).toBeVisible();
			await expect(main.getByRole('button')).toHaveCount(0);
			await waypoint(page, `give-not-available-${lang}`);
			say(
				testInfo,
				`In ${lang}: giving is not available (Qatom lists no donation item, or could not be asked).`
			);
			expect(
				inEnglish,
				'A moment earlier, in English, the same page offered amounts. Qatom may have stopped answering between the two reads.'
			).toEqual([]);
			return;
		}

		// The amounts: every button in the page is one, worded in this language, with the unit.
		await expect(
			main.getByRole('heading', { name: whole(giveWords(lang, GIVE.choose)) })
		).toBeVisible();
		await expect(main.getByRole('button')).toHaveCount(offered.length);
		for (const amount of offered) {
			await expect(
				main.getByRole('button', {
					name: whole(
						giveWords(lang, GIVE.amount).replace('{amount}', amount).replace('{unit}', UNIT)
					)
				})
			).toHaveCount(1);
		}
		// One plain form that posts to this page: it works without scripts.
		await expect(main.locator('form')).toHaveCount(1);
		await expect(main.locator('form')).toHaveAttribute('method', /^post$/i);
		// The three notes: where the paying happens, what to do after, and what is not kept.
		for (const note of [GIVE.payOnQatom, GIVE.afterPaying, GIVE.keptPrivate]) {
			await expect(main.getByText(whole(giveWords(lang, note)))).toBeVisible();
		}
		// For after paying in the other window: a link back to the campaign.
		await expect(
			main.getByRole('link', { name: whole(giveWords(lang, GIVE.paid)) })
		).toHaveAttribute('href', `/campaigns/${id}`);
		// No problem was met, so the line about a new window that goes with one is not shown.
		await expect(main.getByText(whole(giveWords(lang, GIVE.problemWindow)))).toHaveCount(0);
		// The form opens Qatom's checkout in a new window, and this page stays.
		await expect(main.locator('form')).toHaveAttribute('target', '_blank');
		await expect(main.getByText(whole(giveWords(lang, GIVE.notAvailable)))).toHaveCount(0);
		await waypoint(page, `give-amounts-${lang}`);

		expect(offered, `The amounts in ${lang} should be the ones offered in English.`).toEqual(
			inEnglish
		);
		say(testInfo, `In ${lang}: amounts on sale ${offered.join(', ')} ${UNIT}.`);
	});
}
