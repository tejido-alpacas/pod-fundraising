// Where sign-in sends a person afterwards: only ever a path on the App itself.
import { describe, expect, it } from 'vitest';
import { safeReturnTo, signInPath } from './return-to.ts';

const APP = 'https://app.tejido.net';

describe('the address a person returns to after signing in', () => {
	it.each([
		'/',
		'/chat',
		'/reminder',
		'/reminder?milestone=m2-walls',
		'/chat?milestone=m2-walls&x=%2F%2Fother.example',
		'/fix?entry=ent-1#files'
	])('keeps a path on the App: %s', (path) => {
		expect(safeReturnTo(path, APP)).toBe(path);
	});

	it.each([
		['nothing', null],
		['an empty value', ''],
		['a full address on another site', 'https://other.example/reminder'],
		['an address with no scheme', '//other.example/reminder'],
		['a backslash a browser reads as a slash', '/\\other.example'],
		['a backslash further in', '/reminder\\..\\x'],
		['a tab a browser drops, leaving two slashes', '/\t/other.example'],
		['a line break a browser drops', '/\n/other.example'],
		['a carriage return', '/\r/other.example'],
		['a space', '/ /other.example'],
		['a path that does not start at the root', 'reminder'],
		['a script address', 'javascript:alert(1)'],
		['a sign-in name before another site', '/@other.example/../..//other.example\\'],
		['our own full address, which is still not a path', `${APP}/reminder`]
	])('goes home instead of following %s', (_, value) => {
		expect(safeReturnTo(value, APP)).toBe('/');
	});

	it('never answers with anything but a path on the App, whatever it is given', () => {
		const tries = ['/..//other.example', '/./%2F/other.example', '/%5Cother.example', '/a//b'];
		for (const value of tries) {
			const answer = safeReturnTo(value, APP);
			expect(answer.startsWith('/')).toBe(true);
			expect(answer.startsWith('//')).toBe(false);
			expect(new URL(answer, APP).origin).toBe(APP);
		}
	});
});

describe('the address that starts a sign-in', () => {
	it('carries the page to come back to, and the invited party when there is one', () => {
		expect(signInPath('/reminder?milestone=m2-walls')).toBe(
			'/auth/sign-in?return_to=%2Freminder%3Fmilestone%3Dm2-walls'
		);
		expect(signInPath('/reminder', 'contractor')).toBe(
			'/auth/sign-in?party=contractor&return_to=%2Freminder'
		);
	});
});
