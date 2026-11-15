import { describe, expect, it } from 'vitest';
import { beginning, unfinished, whole, within } from './site-words.ts';

describe('unfinished', () => {
	it('finds the name of a translation shown instead of words', () => {
		expect(unfinished('Así funciona x_how1_t Da dinero')).toBe('x_how1_t');
		expect(unfinished('status_funded')).toBe('status_funded');
		expect(unfinished('Explore nav_needs How it works')).toBe('nav_needs');
		expect(unfinished('signin_problem_title · Tejido')).toBe('signin_problem_title');
	});

	it('finds a blank the site left unfilled, and a value that was not there', () => {
		expect(unfinished('{n} results')).toBe('{n}');
		expect(unfinished('Organised by {name}')).toBe('{name}');
		expect(unfinished('For: undefined')).toBe('undefined');
		expect(unfinished('Due [object Object]')).toBe('[object Object]');
	});

	it('finds nothing in real words, in any of the four languages', () => {
		for (const text of [
			'3 results',
			'Tejido is nonpartisan.',
			"Qu'est-ce qu'un hachage de preuve ?",
			'¿Quién guarda el dinero?',
			'Situação: Arrecadando',
			'Automated test campaign (not a real fundraiser)',
			'e2e-smoke · ref-20261115 · Track C · Backend · C3',
			'Search by name, place or organiser',
			'Start a campaign'
		]) {
			expect(unfinished(text), text).toBeNull();
		}
	});
});

describe('whole, within and beginning', () => {
	it('take a typed apostrophe and a typographic one as the same', () => {
		expect(whole("Autres façons d'aider").test('Autres façons d’aider')).toBe(true);
		expect(within("jusqu'à la livraison").test('suivi jusqu’à la livraison.')).toBe(true);
	});

	it('whole allows space around the words and nothing else', () => {
		expect(whole('Explore').test('  Explore\n')).toBe(true);
		expect(whole('Explore').test('Explorer')).toBe(false);
		expect(whole('Are there fees?').test('Are there feesX')).toBe(false);
	});

	it('beginning matches only at the start', () => {
		expect(beginning('Français').test('Français FR')).toBe(true);
		expect(beginning('Français').test('Langue: Français')).toBe(false);
	});
});
