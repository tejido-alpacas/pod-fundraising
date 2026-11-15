/**
 * The Campaign Site's header for a visitor who is NOT signed in: it never offers "Start a
 * campaign", in any of the four languages, in the bar or in the menu. (The button is for a
 * signed-in person: site-signed-in.spec.ts checks where they see it.) Reads only.
 */
import { expect, test } from '../lib/harness.ts';
import { HEADER_WORDS, LANGS, menu, openIn, openMenu, startLinks } from '../lib/site-header.ts';

test.use({ storageState: { cookies: [], origins: [] } });

for (const lang of LANGS) {
	test(`the header offers a signed-out visitor no "Start a campaign" button, in ${lang}`, async ({
		page,
		cfg,
		waypoint
	}, testInfo) => {
		const words = HEADER_WORDS[lang];
		await openIn(page, cfg, lang, '/about');

		// On a phone the header's links are inside the menu: open it, so the picture shows them.
		if (testInfo.project.name === 'phone') await openMenu(page, lang);
		// The header is there and is the signed-out one: it offers Sign in, in this language.
		await expect(
			page
				.getByRole('banner')
				.getByRole('link', { name: words.signIn, exact: true })
				.filter({ visible: true })
		).toHaveCount(1);

		// No link to the builder anywhere in the header, shown or hidden, under any name.
		await expect(startLinks(page)).toHaveCount(0);
		await expect(page.getByRole('banner').getByText(words.start)).toHaveCount(0);
		await expect(menu(page).getByText(words.start)).toHaveCount(0);
		await waypoint(page, `header-signed-out-${lang}`);
	});
}
