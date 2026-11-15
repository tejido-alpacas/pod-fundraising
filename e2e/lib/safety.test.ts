import { describe, expect, it } from 'vitest';
import { parseE2eConfig } from './config.ts';
import {
	assertQatomCheckoutPage,
	assertQatomPage,
	assertSafeToRun,
	onOrigin,
	SafetyError
} from './safety.ts';

const base = {
	E2E_QATOM_HOST: 'pay.m.todaq.net',
	E2E_INBOX_QUEUE_URL: 'https://sqs.ca-central-1.amazonaws.com/123456789012/e2e-inbox',
	E2E_INBOX_REGION: 'ca-central-1',
	E2E_INBOX_DOMAIN: 'e2e.m.todaq.net',
	E2E_CAMPAIGN_ID: 'e2e-smoke',
	E2E_CONTRACTOR_PARTY_ID: 'e2e-contractor',
	E2E_CONFIRMER_PARTY_ID: 'e2e-confirmer'
};

describe('assertSafeToRun', () => {
	it('allows the live site, paid or not', () => {
		expect(() => assertSafeToRun(parseE2eConfig(base))).not.toThrow();
		expect(() => assertSafeToRun(parseE2eConfig({ ...base, E2E_PAID: 'true' }))).not.toThrow();
	});

	it('refuses a paid run that was also told not to sign in', () => {
		expect(() =>
			assertSafeToRun(parseE2eConfig({ ...base, E2E_PAID: 'true', E2E_SKIP_SIGN_IN: 'true' }))
		).toThrow(/cannot skip the sign-in/);
		expect(() =>
			assertSafeToRun(parseE2eConfig({ ...base, E2E_SKIP_SIGN_IN: 'true' }))
		).not.toThrow();
	});

	it('refuses any other host unless it is allowed on purpose', () => {
		const elsewhere = { ...base, E2E_APP_URL: 'https://app.tejido.example' };
		expect(() => assertSafeToRun(parseE2eConfig(elsewhere))).toThrow(SafetyError);
		expect(() =>
			assertSafeToRun(parseE2eConfig({ ...base, E2E_SITE_URL: 'http://localhost:5173' }))
		).toThrow(/E2E_ALLOW_OTHER_HOSTS/);
		expect(() =>
			assertSafeToRun(parseE2eConfig({ ...elsewhere, E2E_ALLOW_OTHER_HOSTS: 'true' }))
		).not.toThrow();
	});

	it('never allows a paid run anywhere but the live site', () => {
		const config = parseE2eConfig({
			...base,
			E2E_APP_URL: 'http://localhost:5174',
			E2E_ALLOW_OTHER_HOSTS: 'true',
			E2E_PAID: 'true'
		});
		expect(() => assertSafeToRun(config)).toThrow(/E2E_PAID/);
	});
});

describe('assertQatomPage', () => {
	const config = { qatomHost: 'pay.m.todaq.net' };

	it('allows Qatom over HTTPS', () => {
		expect(() =>
			assertQatomPage('https://pay.m.todaq.net/v4/oidc/login?step=email_code', config)
		).not.toThrow();
	});

	it('refuses another host, a look-alike, plain HTTP and nonsense', () => {
		for (const url of [
			'https://app.tejido.net/auth/problem',
			'https://pay.m.todaq.net.example.org/v4/oidc/login',
			'http://pay.m.todaq.net/v4/oidc/login',
			'about:blank',
			''
		]) {
			expect(() => assertQatomPage(url, config)).toThrow(SafetyError);
		}
	});

	it('names the host only, never the rest of the address', () => {
		expect(() =>
			assertQatomPage('https://elsewhere.example/login?interaction_uid=abc&email=x', config)
		).toThrow(/^The sign-in is on elsewhere\.example, not on https:\/\/pay\.m\.todaq\.net\. /);
		try {
			assertQatomPage('https://elsewhere.example/login?interaction_uid=abc', config);
		} catch (error) {
			expect(String(error)).not.toContain('interaction_uid');
		}
	});
});

describe('onOrigin', () => {
	it('compares origins exactly', () => {
		expect(onOrigin('https://app.tejido.net/auth/callback?code=1', 'https://app.tejido.net')).toBe(
			true
		);
		expect(onOrigin('https://tejido.net/', 'https://app.tejido.net')).toBe(false);
		expect(onOrigin('about:blank', 'https://app.tejido.net')).toBe(false);
	});
});

describe('assertQatomCheckoutPage', () => {
	it('allows one of Qatom’s checkout pages over HTTPS', () => {
		expect(() =>
			assertQatomCheckoutPage('https://checkout.m.todaq.net/checkout/abc123')
		).not.toThrow();
	});

	it('refuses any other host, path or scheme, naming the host and never the rest', () => {
		for (const url of [
			'https://pay.m.todaq.net/checkout/payable-part-9f86d081',
			'https://checkout.m.todaq.net/elsewhere/payable-part-9f86d081',
			'http://checkout.m.todaq.net/checkout/payable-part-9f86d081',
			'https://checkout.m.todaq.net.example.org/checkout/payable-part-9f86d081',
			'not an address'
		]) {
			let message = '';
			try {
				assertQatomCheckoutPage(url);
			} catch (error) {
				expect(error).toBeInstanceOf(SafetyError);
				message = (error as Error).message;
			}
			expect(message).toContain('not on one of Qatom');
			expect(message).not.toContain('payable-part');
		}
	});
});
