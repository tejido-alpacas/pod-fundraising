import { readFileSync } from 'node:fs';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import rootLayout from '../../routes/+layout.svelte?raw';
import { FRAME_STYLES_MARKER, holdFrameStyles } from './design-frame-styles.ts';
import DesignFrame from './DesignFrame.svelte';

// Read from disk: the test runner hands back an empty string for an imported stylesheet.
const frameCss = readFileSync(new URL('./design-frame.css', import.meta.url), 'utf8');
const firstSiteCss = readFileSync(new URL('./tejido.css', import.meta.url), 'utf8');

/*
 * Two stylesheets share the Campaign Site. The root layout loads the first site's on every page.
 * The pages built on the design system (a campaign's pages and /old) sit in a DesignFrame, whose
 * design-frame.css keeps the first site's rules out of them.
 *
 * design-frame.css can only do that for the rules it knows about. The last three tests read the
 * first site's stylesheet and fail when it gains a rule that would reach those pages unnoticed.
 */

// ---------- The frame ----------

describe('DesignFrame', () => {
	it('draws the design system header and footer around the page, in English', () => {
		const page = createRawSnippet(() => ({ render: () => '<p>The page</p>' }));
		const { body } = render(DesignFrame, { props: { children: page } });

		expect(body).toContain('class="tj-screen tj-frame"');
		expect(body).toContain('lang="en"');
		expect(body).toContain('<p>The page</p>');
		expect(body).toContain('Fundraising with proof of delivery');
		expect(body).toContain('All campaigns');
		// The root layout already draws the page's one <main>.
		expect(body).not.toContain('<main');
	});
});

// ---------- Switching the stylesheet on and off ----------

type FakeSheet = { cssRules: unknown[]; disabled: boolean };

/** Puts stand-ins for the browser's stylesheets in place and returns the frame's own one. */
function fakeDocument(): FakeSheet {
	class CSSStyleRule {
		selectorText: string;
		constructor(selectorText: string) {
			this.selectorText = selectorText;
		}
	}
	const frame: FakeSheet = { cssRules: [new CSSStyleRule(FRAME_STYLES_MARKER)], disabled: false };
	const firstSite: FakeSheet = { cssRules: [new CSSStyleRule('body')], disabled: false };
	// A stylesheet from another origin: reading its rules throws.
	const fonts = {
		disabled: false,
		get cssRules(): unknown[] {
			throw new Error('SecurityError');
		}
	};
	vi.stubGlobal('CSSStyleRule', CSSStyleRule);
	vi.stubGlobal('document', { styleSheets: [firstSite, fonts, frame] });
	return frame;
}

const endOfTurn = () => new Promise<void>((resolve) => queueMicrotask(resolve));

describe('holdFrameStyles', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('switches the stylesheet off when the last frame leaves, and on again when one returns', async () => {
		const frame = fakeDocument();

		const release = holdFrameStyles();
		expect(frame.disabled).toBe(false);

		release();
		await endOfTurn();
		expect(frame.disabled).toBe(true);

		const releaseAgain = holdFrameStyles();
		expect(frame.disabled).toBe(false);
		releaseAgain();
		await endOfTurn();
	});

	it('keeps the stylesheet on while moving from one framed page to another', async () => {
		const frame = fakeDocument();

		const releaseFirst = holdFrameStyles();
		// The old frame is destroyed and the new one created in the same turn, in either order.
		releaseFirst();
		const releaseSecond = holdFrameStyles();
		await endOfTurn();
		expect(frame.disabled).toBe(false);

		releaseSecond();
		releaseSecond();
		await endOfTurn();
		expect(frame.disabled).toBe(true);
	});

	it('finds its stylesheet by the marker rule in design-frame.css', () => {
		expect(frameCss).toContain(`${FRAME_STYLES_MARKER} {`);
		expect(frameCss).toContain("@import '@tejido/ui/styles.css' layer(tejido-design);");
	});
});

// ---------- The first site's stylesheet, read as text ----------

type Rule = {
	/** One selector, with single spaces. */
	selector: string;
	/** Every class the selector needs somewhere on the page to match. */
	classes: string[];
	/** Every element name in the selector. */
	elements: string[];
	important: boolean;
};

function rulesOf(css: string, fromSvelteStyle: boolean): Rule[] {
	const rules: Rule[] = [];
	const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
	// Each innermost `selectors { declarations }`. An at-rule's own line never matches, because
	// its braces hold other braces.
	for (const [, prelude = '', block = ''] of text.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		for (const raw of prelude.split(',')) {
			let selector = raw.trim().replace(/\s+/g, ' ');
			if (selector === '' || selector.startsWith('@') || /^(from|to|\d+%)$/.test(selector))
				continue;
			if (fromSvelteStyle) {
				// In a component's <style>, only what is inside :global(...) reaches other components.
				if (!selector.includes(':global(')) continue;
				selector = selector.replace(/:global\(([^()]*)\)/g, '$1');
			}
			const plain = selector.replace(/\[[^\]]*\]/g, '').replace(/::?[a-z-]+(\([^()]*\))?/g, '');
			rules.push({
				selector,
				classes: [...plain.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((match) => match[1] ?? ''),
				elements: plain
					.replace(/\.[A-Za-z_][\w-]*|#[\w-]+/g, ' ')
					.split(/[\s>+~*]+/)
					.filter((name) => /^[a-z][a-z0-9]*$/.test(name)),
				important: block.includes('!important')
			});
		}
	}
	return rules;
}

const layoutStyle = /<style>([\s\S]*?)<\/style>/.exec(rootLayout)?.[1] ?? '';
const firstSiteRules = [...rulesOf(firstSiteCss, false), ...rulesOf(layoutStyle, true)];

// ---------- The pages inside a DesignFrame, read as text ----------

const sources = import.meta.glob<string>('../../**/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
});
const uiSources = import.meta.glob<string>('../../../../../packages/ui/src/*.svelte', {
	query: '?raw',
	import: 'default',
	eager: true
});

/** `../old/X.svelte` (as the glob names it, from this folder) to `/src/lib/old/X.svelte`. */
const fromSrc = (path: string, from = '/src/lib/campaign-site/') =>
	new URL(path, `file://${from}`).pathname;

const files = new Map(Object.entries(sources).map(([path, text]) => [fromSrc(path), text]));

const FRAMED = ['/src/routes/(campaign-site)/campaigns/[campaignId]/', '/src/routes/old/'];

/** Every component a framed page draws, found by following imports from the framed routes. */
function framedFiles(): string[] {
	const seen = new Set<string>();
	const queue = [...files.keys()].filter((path) => FRAMED.some((root) => path.startsWith(root)));
	while (queue.length > 0) {
		const path = queue.pop() ?? '';
		if (seen.has(path)) continue;
		seen.add(path);
		const text = files.get(path) ?? '';
		for (const [, target = ''] of text.matchAll(/from\s+'([^']+\.svelte)'/g)) {
			const next = target.startsWith('#lib/')
				? `/src/lib/${target.slice('#lib/'.length)}`
				: fromSrc(target, path.slice(0, path.lastIndexOf('/') + 1));
			if (files.has(next)) queue.push(next);
		}
	}
	return [...seen];
}

function classesIn(svelte: string): string[] {
	const markup = svelte.replace(/<(script|style)[\s\S]*?<\/\1>/g, '');
	const names: string[] = [];
	for (const [, value = ''] of markup.matchAll(/\bclass="([^"]*)"/g)) {
		names.push(...value.replace(/\{[^}]*\}/g, ' ').split(/\s+/));
	}
	for (const [, expression = ''] of markup.matchAll(/\bclass=\{([^}]*)\}/g)) {
		for (const [, literal = ''] of expression.matchAll(/'([^']*)'/g)) {
			names.push(...literal.split(/\s+/));
		}
	}
	for (const [, name = ''] of markup.matchAll(/\bclass:([A-Za-z_][\w-]*)/g)) names.push(name);
	return names.filter((name) => name !== '');
}

const framed = framedFiles();
const ourClasses = new Set([
	...framed.flatMap((path) => classesIn(files.get(path) ?? '')),
	...Object.values(uiSources).flatMap(classesIn)
]);

// ---------- What design-frame.css deals with ----------

/** The root layout's own column, which every framed page sits inside. */
const AROUND_THE_FRAME = ['wrap', 'column'];
/** Rules that need only that column, and that design-frame.css undoes by name. */
const UNDONE_BY_NAME = ['.wrap', '.column', '.column h1', '.column h2'];
/** Rules that name no element at all. */
const UNDONE_EVERYWHERE = [':root', '*', ':focus-visible'];
/** The only `!important` design-frame.css answers with its own. */
const IMPORTANT_ANSWERED = ['*', 'textarea', "input[type='text']", 'select'];

/** The elements listed in design-frame.css's `:is(...)` groups, plus the page itself. */
const undoneElements = new Set([
	'html',
	'body',
	...[...frameCss.matchAll(/:is\(([^()]*)\)/g)].flatMap(([, list = '']) =>
		list.split(',').map((name) => name.trim().replace(/\[.*$/, ''))
	)
]);

const reachesFramedPages = (rule: Rule) =>
	rule.classes.every((name) => ourClasses.has(name) || AROUND_THE_FRAME.includes(name));

describe("the first site's stylesheet and the pages built on the design system", () => {
	it('reads both sides', () => {
		expect(firstSiteRules.length).toBeGreaterThan(100);
		expect(framed.length).toBeGreaterThan(20);
		expect(ourClasses.has('tj-page')).toBe(true);
		expect(undoneElements.has('h1') && undoneElements.has('textarea')).toBe(true);
	});

	it('has no class name in common', () => {
		// A first-site rule such as `.top { ... }` would also style a <div class="top"> on a framed
		// page. If this fails, rename the class in the framed page: its own <style> is scoped to it.
		const clashes = firstSiteRules
			.filter((rule) => rule.classes.length > 0 && reachesFramedPages(rule))
			.map((rule) => rule.selector)
			.filter((selector) => !UNDONE_BY_NAME.includes(selector));
		expect([...new Set(clashes)]).toEqual([]);
	});

	it('styles no bare element that design-frame.css does not undo', () => {
		// A first-site rule such as `table { ... }` styles every table on the site. If this fails,
		// add the element to the first `:is(...)` list in design-frame.css.
		const missed = firstSiteRules
			.filter((rule) => rule.classes.length === 0)
			.filter((rule) =>
				rule.elements.length === 0
					? !UNDONE_EVERYWHERE.includes(rule.selector)
					: rule.elements.some((name) => !undoneElements.has(name))
			)
			.map((rule) => rule.selector);
		expect([...new Set(missed)]).toEqual([]);
	});

	it('marks nothing !important that design-frame.css does not answer', () => {
		// `!important` beats everything design-frame.css does with `revert-layer`. If this fails,
		// state the design system's value again, with `!important`, at the end of design-frame.css.
		const unanswered = firstSiteRules
			.filter((rule) => rule.important && reachesFramedPages(rule))
			.map((rule) => rule.selector)
			.filter((selector) => !IMPORTANT_ANSWERED.includes(selector));
		expect([...new Set(unanswered)]).toEqual([]);
	});
});
