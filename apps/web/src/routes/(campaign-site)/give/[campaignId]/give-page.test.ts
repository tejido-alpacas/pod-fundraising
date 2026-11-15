// Draws the Give page on the server, as a donor's browser first receives it, with no scripts
// run. Nothing here reaches the network.
import { LANGS, t } from '#lib/campaign-site/i18n/index.ts';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import Page from './+page.svelte';

type Lang = (typeof LANGS)[number];
type Problem = 'closed' | 'gone' | 'unavailable';

const campaign = {
	id: 'library-wing',
	title: 'Rebuild the library wing',
	beneficiary: 'The pupils',
	creatorName: 'The association',
	path: '/campaigns/library-wing'
};

function page(
	lang: Lang,
	options: {
		open?: boolean;
		amounts?: { value: number; shown: string }[] | null;
		problem?: Problem;
	} = {}
): string {
	const data = {
		lang,
		donorEmail: null,
		campaign,
		open: options.open ?? true,
		funding: { goal: '12000.00', raised: '30.00', donations: 2 },
		amounts:
			options.amounts === undefined
				? [
						{ value: 1000, shown: '1.00' },
						{ value: 10_000, shown: '10.00' }
					]
				: options.amounts
	};
	const form = options.problem ? { problem: options.problem } : null;
	return render(Page, { props: { data, form, params: { campaignId: campaign.id } } }).body;
}

/** The opening tag of the one form on the page, or null when there is none. */
const formTag = (body: string) => /<form[^>]*>/.exec(body)?.[0] ?? null;

describe('the Give page, as drawn', () => {
	it('opens Qatom in a new window from a plain form, with no handle back to this page', () => {
		const tag = formTag(page('en'));

		expect(tag).toContain('method="POST"');
		expect(tag).toContain('target="_blank"');
		expect(tag).toContain('rel="noopener"');
		// A plain form post to this same address: it works with scripts turned off.
		expect(tag).not.toContain('action=');
	});

	it('has one button for each amount, each carrying its amount', () => {
		const body = page('en');

		expect(body.match(/<button[^>]*name="amount"[^>]*>/g)).toHaveLength(2);
		expect(body).toMatch(/<button[^>]*name="amount"[^>]*value="1000"/);
		expect(body).toMatch(/<button[^>]*name="amount"[^>]*value="10000"/);
		expect(body).toContain('Give 1.00 USD-TDN');
	});

	it.each(LANGS)(
		'says before the press that payment opens in a new window and this page stays (%s)',
		(lang) => {
			const body = page(lang);

			expect(body).toContain(t(lang, 'give_lead'));
			expect(body).toContain(t(lang, 'give_after'));
		}
	);

	it.each(LANGS)('gives a plain link to the campaign for after paying (%s)', (lang) => {
		const body = page(lang);
		const link = /<a[^>]*href="\/campaigns\/library-wing"[^>]*>([^<]*)<\/a>/.exec(body);

		expect(link?.[1]).toBe(t(lang, 'give_paid'));
	});

	it('says the new window opens on Qatom, in words, in English', () => {
		expect(t('en', 'give_lead')).toMatch(/new window/);
		expect(t('en', 'give_lead')).toMatch(/Qatom/);
		expect(t('en', 'give_after')).toMatch(/come back here/);
	});

	it.each(['closed', 'gone', 'unavailable'] as const)(
		'reads on its own when a refusal (%s) is drawn in the new window',
		(problem) => {
			const body = page('en', { problem });

			// Which campaign, what went wrong, that nothing was charged, and what to do with the window.
			expect(body).toContain('Give to Rebuild the library wing');
			expect(body).toContain(t('en', `give_problem_${problem}`));
			expect(body).toMatch(/Nothing was charged/);
			expect(body).toContain(t('en', 'give_problem_window'));
			// And a way on: the amounts again, and the campaign.
			expect(formTag(body)).not.toBeNull();
			expect(body).toContain('href="/campaigns/library-wing"');
		}
	);

	it('does not mention a window when nothing was refused', () => {
		expect(page('en')).not.toContain(t('en', 'give_problem_window'));
	});

	it('draws no form when the campaign is closed or Qatom could not be asked', () => {
		expect(formTag(page('en', { open: false, amounts: [] }))).toBeNull();
		expect(formTag(page('en', { amounts: null }))).toBeNull();
		expect(formTag(page('en', { amounts: [] }))).toBeNull();
	});
});
