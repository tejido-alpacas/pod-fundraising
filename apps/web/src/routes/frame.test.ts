// Draws the Campaign Site's frame (the root layout) on the server, as a signed-in person and as
// a signed-out visitor sees it. Nothing here reaches the network.
import { LANGS, t } from '#lib/campaign-site/i18n/index.ts';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { describe, expect, it, vi } from 'vitest';
import Layout from './+layout.svelte';

// The frame asks SvelteKit which page it is on. Outside a running app there is none, so the
// test says: the About page.
vi.mock('$app/state', () => ({
	page: { url: new URL('http://localhost/about'), route: { id: '/(campaign-site)/about' } }
}));
vi.mock('$app/navigation', () => ({ afterNavigate: () => {} }));

const children = createRawSnippet(() => ({ render: () => '<p>the page</p>' }));

function frame(lang: (typeof LANGS)[number], donorEmail: string | null): string {
	return render(Layout, { props: { data: { lang, donorEmail }, params: {}, children } }).body;
}

/** Every link to the campaign builder in the frame, as the HTML of its opening tag and label. */
function startLinks(body: string): string[] {
	return body.match(/<a[^>]*href="\/campaigns\/new"[^>]*>[^<]*<\/a>/g) ?? [];
}

describe('the "Start a campaign" button in the frame', () => {
	it.each(LANGS)('is drawn for a signed-in person, in the bar and in the menu (%s)', (lang) => {
		const links = startLinks(frame(lang, 'donor@example.test'));

		expect(links).toHaveLength(2);
		const [inBar, inMenu] = links;
		// The first site's button classes, and the label in the visitor's language.
		expect(inBar).toMatch(/class="btn btn-blue btn-sm acct-start[ "]/);
		expect(inMenu).toMatch(/class="btn btn-blue mnav-start[ "]/);
		for (const link of links) expect(link).toContain(`>${t(lang, 'start_campaign')}</a>`);
	});

	it.each(LANGS)('is not drawn for a signed-out visitor (%s)', (lang) => {
		const body = frame(lang, null);

		expect(startLinks(body)).toEqual([]);
		expect(body).not.toContain('/campaigns/new');
		expect(body).not.toContain(t(lang, 'start_campaign'));
		// Nor the marks that rearrange a signed-in person's header.
		expect(body).not.toMatch(/class="top[^"]*(signed-in|start-in-bar)/);
	});

	it('keeps the bar for the languages with room, and the menu for French', () => {
		const header = (lang: (typeof LANGS)[number]) =>
			frame(lang, 'donor@example.test').match(/<header class="([^"]*)"/)?.[1] ?? '';

		for (const lang of ['es', 'en', 'pt'] as const) {
			expect(header(lang)).toContain('signed-in');
			expect(header(lang)).toContain('start-in-bar');
		}
		expect(header('fr')).toContain('signed-in');
		expect(header('fr')).not.toContain('start-in-bar');
	});
});
