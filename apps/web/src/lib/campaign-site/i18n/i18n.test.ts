import { describe, expect, it } from 'vitest';
import { LANGS, privacyItems, resolveLang, STRINGS, t } from './index.ts';

describe('the four languages', () => {
	it('has every string in all four, none of them empty', () => {
		for (const [key, row] of Object.entries(STRINGS)) {
			expect(row, key).toHaveLength(LANGS.length);
			for (const text of row) expect(text.trim(), key).not.toBe('');
		}
	});

	it('shows each language from its own column', () => {
		expect(t('es', 'x_nav_explore')).toBe('Explorar');
		expect(t('en', 'x_nav_explore')).toBe('Explore');
		expect(t('fr', 'x_nav_explore')).toBe('Explorer');
		expect(t('pt', 'x_nav_explore')).toBe('Explorar');
	});

	it('has the same privacy points in every language', () => {
		const english = privacyItems('en');
		expect(english.length).toBeGreaterThan(0);
		for (const lang of LANGS) {
			const items = privacyItems(lang);
			expect(items, lang).toHaveLength(english.length);
			for (const item of items) expect(item.trim(), lang).not.toBe('');
		}
	});

	it('fills placeholders and leaves unknown ones as they are', () => {
		expect(t('en', 'card_milestones', { c: 1, n: 3 })).toBe('1 of 3 milestones confirmed');
		expect(t('en', 'card_milestones', { c: 1 })).toBe('1 of {n} milestones confirmed');
	});
});

describe('choosing the language', () => {
	it('keeps a saved choice over what the browser asks for', () => {
		expect(resolveLang('fr', 'en-US,en;q=0.9')).toBe('fr');
	});

	it('takes the first of our four the browser asks for', () => {
		expect(resolveLang(undefined, 'de-DE,pt-BR;q=0.8,en;q=0.5')).toBe('pt');
	});

	it('ignores a saved value that is not one of ours', () => {
		expect(resolveLang('de', 'en-CA')).toBe('en');
	});

	it('opens in Spanish when nothing matches, as the first site did', () => {
		expect(resolveLang(undefined, null)).toBe('es');
		expect(resolveLang(undefined, 'de,ja')).toBe('es');
	});
});
