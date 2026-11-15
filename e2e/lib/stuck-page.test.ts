import { describe, expect, it } from 'vitest';
import { describeSeenPage, tidy } from './stuck-page.ts';

describe('describeSeenPage', () => {
	it('names the step, the headings and the buttons', () => {
		const text = describeSeenPage({
			path: '/v4/oidc/login',
			step: 'wallet_load',
			headings: ['Add funds to your wallet'],
			buttons: [
				{ text: 'Skip for now', id: null, disabled: false },
				{ text: 'Pay', id: 'pay-btn', disabled: true }
			]
		});
		expect(text).toBe(
			[
				'The page was /v4/oidc/login, step "wallet_load".',
				'Headings: "Add funds to your wallet".',
				'Buttons: "Skip for now", "Pay #pay-btn (disabled)".'
			].join('\n')
		);
	});

	it('says so when the page names no step and shows nothing to press', () => {
		const text = describeSeenPage({ path: '/somewhere', step: null, headings: [], buttons: [] });
		expect(text).toContain('step not named');
		expect(text).toContain('Headings: none.');
		expect(text).toContain('Buttons: none.');
	});

	it('keeps the log short: long text is cut and a long list is counted', () => {
		expect(tidy(`  two\n  lines  ${'x'.repeat(100)}`)).toHaveLength(60);
		const many = Array.from({ length: 15 }, (_, i) => ({
			text: `b${i}`,
			id: null,
			disabled: false
		}));
		const text = describeSeenPage({ path: '/', step: null, headings: [], buttons: many });
		expect(text).toContain('"b11" and 3 more.');
		expect(text).not.toContain('"b12"');
	});

	it('names a button that has no text', () => {
		const text = describeSeenPage({
			path: '/',
			step: null,
			headings: [],
			buttons: [{ text: '  ', id: 'close', disabled: false }]
		});
		expect(text).toContain('"(no text) #close"');
	});
});
