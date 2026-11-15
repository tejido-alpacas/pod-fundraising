import { describe, expect, it } from 'vitest';
import { describeSeenPage, safePath, scrub, tidy, type SeenPage } from './stuck-page.ts';

const page = (over: Partial<SeenPage>): SeenPage => ({
	host: 'app.tejido.net',
	path: '/',
	step: null,
	title: '',
	headings: [],
	buttons: [],
	alerts: [],
	opening: '',
	...over
});

describe('describeSeenPage', () => {
	it('names the page, its step, the headings, the buttons, the errors and the first words', () => {
		const text = describeSeenPage(
			page({
				host: 'pay.m.todaq.net',
				path: '/v4/oidc/login',
				step: 'wallet_load',
				title: 'Sign in',
				headings: ['Add funds to your wallet'],
				buttons: [
					{ text: 'Skip for now', id: null, disabled: false },
					{ text: 'Pay', id: 'pay-btn', disabled: true }
				],
				alerts: ['Something went wrong.'],
				opening: 'Add funds to your wallet\nChoose an amount'
			})
		);
		expect(text).toBe(
			[
				'The page was pay.m.todaq.net/v4/oidc/login, step "wallet_load", titled "Sign in".',
				'Headings: "Add funds to your wallet".',
				'Buttons: "Skip for now", "Pay #pay-btn (disabled)".',
				'Errors and notices: "Something went wrong.".',
				'It began: "Add funds to your wallet Choose an amount".'
			].join('\n')
		);
	});

	it('says so when the page shows nothing', () => {
		const text = describeSeenPage(page({ path: '/somewhere' }));
		expect(text).toContain('The page was app.tejido.net/somewhere.');
		expect(text).toContain('Headings: none.');
		expect(text).toContain('Buttons: none.');
		expect(text).toContain('Errors and notices: none.');
		expect(text).toContain('It began: with no visible words.');
	});

	it('keeps the log short: long text is cut and a long list is counted', () => {
		expect(tidy(`  two\n  lines  ${'x '.repeat(100)}`)).toHaveLength(60);
		const many = Array.from({ length: 15 }, (_, i) => ({
			text: `b${i}`,
			id: null,
			disabled: false
		}));
		const text = describeSeenPage(page({ buttons: many, opening: 'word '.repeat(200) }));
		expect(text).toContain('"b11" and 3 more.');
		expect(text).not.toContain('"b12"');
		expect(text.split('\n').at(-1)?.length).toBeLessThan(340);
	});

	it('names a button that has no text', () => {
		const text = describeSeenPage(
			page({ buttons: [{ text: '  ', id: 'close', disabled: false }] })
		);
		expect(text).toContain('"(no text) #close"');
	});

	it('puts no email address, code or token in the log, wherever the page showed it', () => {
		const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcDEF123';
		const text = describeSeenPage(
			page({
				path: `/auth/${token}`,
				step: token,
				title: 'Signed in as someone@example.com',
				headings: ['We sent a code to someone@example.com'],
				buttons: [{ text: 'Use 123456', id: token, disabled: false }],
				alerts: [`Your code is 123 456. Session ${token}`],
				opening: `someone@example.com 654321 ${token}`
			})
		);
		expect(text).not.toContain('someone@example.com');
		expect(text).not.toContain('123456');
		expect(text).not.toContain('123 456');
		expect(text).not.toContain('654321');
		expect(text).not.toContain('eyJ');
		expect(text).toContain('The page was app.tejido.net/auth/…');
	});
});

describe('scrub', () => {
	it('leaves ordinary words, ids, dates and amounts as they are', () => {
		for (const plain of [
			'Automated test campaign (not a real fundraiser)',
			'Submitted at 06:34 on 15 Nov 2026',
			'2026-11-15',
			'A filing deposit of 0.10',
			'e2e-contractor',
			'Uploaded. Donors can see it.',
			'internationalisation-and-localisation'
		]) {
			expect(scrub(plain)).toBe(plain);
		}
	});

	it('takes out email addresses, six digits, and long values', () => {
		expect(scrub('Signed in with the Qatom account e2e-contractor@e2e.m.todaq.net.')).toBe(
			'Signed in with the Qatom account (an email address).'
		);
		expect(scrub('Code 482913 sent')).toBe('Code (digits) sent');
		expect(scrub('Code 482-913 sent')).toBe('Code (digits) sent');
		expect(scrub('sha 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')).toBe(
			'sha (a long value)'
		);
		expect(scrub('tejido_session=AbCdEfGhIjKlMnOpQrStUvWxYz')).toBe('(a long value)');
	});
});

describe('safePath', () => {
	it('keeps ids and slugs, and replaces a segment that could be a secret', () => {
		expect(safePath('/campaigns/e2e-smoke/milestones/m1')).toBe(
			'/campaigns/e2e-smoke/milestones/m1'
		);
		expect(safePath('/invite/e2e-contractor')).toBe('/invite/e2e-contractor');
		expect(safePath('/r/0123456789abcdef0123456789abcdef')).toBe('/r/…');
	});
});
