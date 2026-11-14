// A donor's whole sign-in round trip on the Campaign Site: /auth/sign-in, then /auth/callback,
// then /auth/sign-out, with one browser's cookies carried between them. The routes' own
// handlers run against the real Qatom sign-in client.
//
// These tests never reach the network: `fetch` is replaced, here in the test file, by a stub
// standing in for Qatom's OIDC provider. ID tokens are signed with a key made for the test.
import { isRedirect, type Cookies } from '@sveltejs/kit';
import { createPersonSignIn } from '@tejido/qatom/person';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDonorSession, unseal } from '#lib/campaign-site/server/session.ts';
import { GET as callback } from './callback/+server.ts';
import { GET as signIn } from './sign-in/+server.ts';
import { POST as signOut } from './sign-out/+server.ts';

const SESSION_SECRET = 'session-secret-session-secret-session';
const API = 'https://pay.stage.qatom.test';
const ISSUER = 'https://issuer.qatom.test';
const CLIENT_ID = 'tejido-sign-in';
const REDIRECT_URI = 'http://localhost:5173/auth/callback';
const SITE = 'http://localhost:5173';

const provider = {
	issuer: ISSUER,
	authorization_endpoint: `${API}/v4/oidc/auth`,
	token_endpoint: `${API}/v4/oidc/token`,
	userinfo_endpoint: `${API}/v4/oidc/me`,
	introspection_endpoint: `${API}/v4/oidc/token/introspection`,
	jwks_uri: `${API}/v4/oidc/jwks`,
	id_token_signing_alg_values_supported: ['RS256'],
	authorization_response_iss_parameter_supported: true
};

const DONOR_EMAIL = 'donor@example.test';
const donorClaims = {
	email: DONOR_EMAIL,
	email_verified: true,
	twin_hostname: 'primary0001.micro.biz.todaq.net',
	agent_twin_hostname: 'agent0001.micro.biz.todaq.net'
};
const ACCESS_TOKEN = 'person-access-token-do-not-leak';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' };

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function idToken(claims: Record<string, unknown>): string {
	const now = Math.floor(Date.now() / 1000);
	const signed = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({
		iss: ISSUER,
		aud: CLIENT_ID,
		sub: 'qatom-donor-123',
		iat: now,
		exp: now + 300,
		...claims
	})}`;
	return `${signed}.${createSign('RSA-SHA256').update(signed).sign(privateKey).toString('base64url')}`;
}

/** One browser's cookies, across several requests. */
function cookieJar() {
	const held = new Map<string, string>();
	const jar: Pick<Cookies, 'get' | 'set' | 'delete'> = {
		get: (name) => held.get(name),
		set: (name, value) => void held.set(name, value),
		delete: (name) => void held.delete(name)
	};
	return { held, jar: jar as Cookies };
}

type Outcome = { kind: 'redirect'; status: number; location: string } | { kind: 'other' };

/** Calls a handler and reports where it sent the browser. */
async function outcome(run: () => Response | Promise<Response>): Promise<Outcome> {
	try {
		await run();
	} catch (thrown) {
		if (isRedirect(thrown)) {
			return { kind: 'redirect', status: thrown.status, location: thrown.location };
		}
		throw thrown;
	}
	return { kind: 'other' };
}

let browser: ReturnType<typeof cookieJar>;
let person: ReturnType<typeof createPersonSignIn>;
let qatom: { discoveryStatus: number; tokenStatus: number; claims: Record<string, unknown> };
let rememberNonce: (nonce: string) => void;
let logged: string;

beforeEach(() => {
	browser = cookieJar();
	person = createPersonSignIn({
		paymentApiUrl: API,
		clientId: CLIENT_ID,
		clientSecret: 'sign-in-client-secret',
		redirectUri: REDIRECT_URI
	});
	qatom = { discoveryStatus: 200, tokenStatus: 200, claims: donorClaims };
	logged = '';
	vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
		logged += `${parts.map(String).join(' ')}\n`;
	});

	let nonce = '';
	vi.stubGlobal('fetch', (input: string | URL) => {
		const url = String(input);
		const json = (body: unknown, status = 200) =>
			Promise.resolve(new Response(JSON.stringify(body), { status }));

		if (url.endsWith('/.well-known/openid-configuration')) {
			return json(provider, qatom.discoveryStatus);
		}
		if (url === provider.jwks_uri) return json({ keys: [publicJwk] });
		if (url === provider.token_endpoint) {
			if (qatom.tokenStatus !== 200) return json({ error: 'server_error' }, qatom.tokenStatus);
			return json({
				access_token: ACCESS_TOKEN,
				token_type: 'Bearer',
				expires_in: 3600,
				id_token: idToken({ ...qatom.claims, nonce })
			});
		}
		if (url === provider.userinfo_endpoint) return json({ sub: 'qatom-donor-123' });
		return Promise.reject(new Error(`unexpected request to ${url}`));
	});
	rememberNonce = (value) => (nonce = value);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

type RouteEvent = Parameters<typeof signIn>[0] &
	Parameters<typeof callback>[0] &
	Parameters<typeof signOut>[0];

function event(url: string) {
	const locals = {
		ctx: { config: { SESSION_SECRET }, qatom: { person } },
		session: readDonorSession(browser.jar, SESSION_SECRET)
	};
	// A whole RequestEvent cannot be built outside SvelteKit; the handlers use only these parts.
	return { url: new URL(url), cookies: browser.jar, locals } as unknown as RouteEvent;
}

/** Opens /auth/sign-in and follows the browser to Qatom's authorization page. */
async function start(query = ''): Promise<{ result: Outcome; state: string }> {
	const result = await outcome(() => signIn(event(`${SITE}/auth/sign-in${query}`)));
	if (result.kind !== 'redirect' || !result.location.startsWith(provider.authorization_endpoint)) {
		return { result, state: '' };
	}
	const asked = new URL(result.location).searchParams;
	rememberNonce(asked.get('nonce') ?? '');
	return { result, state: asked.get('state') ?? '' };
}

/** Qatom sends the browser back to /auth/callback. */
function comeBack(state: string, params: Record<string, string> = { code: 'auth-code' }) {
	const query = new URLSearchParams({ state, iss: ISSUER, ...params });
	return outcome(() => callback(event(`${REDIRECT_URI}?${query.toString()}`)));
}

const session = () => readDonorSession(browser.jar, SESSION_SECRET);

describe('a donor signing in with Qatom', () => {
	it('goes to Qatom, at the Campaign Site’s own callback, and asks for nothing long-lived', async () => {
		const { result } = await start();

		expect(result).toMatchObject({ kind: 'redirect', status: 302 });
		const asked = new URL(result.kind === 'redirect' ? result.location : '').searchParams;
		expect(asked.get('redirect_uri')).toBe(REDIRECT_URI);
		expect(asked.get('scope')).not.toContain('offline_access');
		expect(asked.get('resource')).toBeNull();
	});

	it('comes back signed in, holding only who the donor is', async () => {
		const { state } = await start();

		expect(await comeBack(state)).toEqual({ kind: 'redirect', status: 303, location: '/' });
		expect(session()).toEqual({ sub: 'qatom-donor-123', email: DONOR_EMAIL });
	});

	it('keeps the token out of the browser and out of the log', async () => {
		const { state } = await start();
		await comeBack(state);

		for (const value of browser.held.values()) {
			const readable = Buffer.from(value, 'base64url').toString('latin1');
			expect(value + readable).not.toContain(ACCESS_TOKEN);
		}
		expect(logged).toBe('');
	});

	it('returns to the page the donor was on, on this site only', async () => {
		const first = await start(`?return_to=${encodeURIComponent('/campaigns/library-wing')}`);
		expect(await comeBack(first.state)).toMatchObject({ location: '/campaigns/library-wing' });

		for (const elsewhere of ['//elsewhere.example/x', 'https://elsewhere.example', '/\\x']) {
			const next = await start(`?return_to=${encodeURIComponent(elsewhere)}`);
			expect(await comeBack(next.state)).toMatchObject({ location: '/' });
		}
	});

	it('uses its own cookies, which the App’s session cannot pass for', async () => {
		const { state } = await start();
		await comeBack(state);

		expect([...browser.held.keys()]).toEqual(['tejido_donor_session']);
		const cookie = browser.held.get('tejido_donor_session');
		// Sealed for the donor session, so it is not readable as the App's session.
		expect(unseal(cookie, SESSION_SECRET, 'session')).toBeNull();
	});
});

describe('a sign-in that does not finish', () => {
	it('explains when Qatom cannot be reached to start', async () => {
		qatom.discoveryStatus = 503;

		const { result } = await start();

		expect(result).toEqual({ kind: 'redirect', status: 303, location: '/auth/problem' });
		expect(browser.held.size).toBe(0);
	});

	it('refuses a callback from a browser that never started a sign-in', async () => {
		expect(await comeBack('any-state')).toEqual({
			kind: 'redirect',
			status: 303,
			location: '/auth/problem'
		});
		expect(session()).toBeNull();
	});

	it('does not accept an answer for a sign-in it did not start', async () => {
		await start();

		expect(await comeBack('someone-elses-state')).toMatchObject({ location: '/auth/problem' });
		expect(session()).toBeNull();
	});

	it('explains when the donor cancels at Qatom', async () => {
		const { state } = await start();

		expect(await comeBack(state, { error: 'access_denied' })).toMatchObject({
			location: '/auth/problem'
		});
		expect(session()).toBeNull();
	});

	it('explains when Qatom fails while finishing, without logging anything secret', async () => {
		qatom.tokenStatus = 500;
		const { state } = await start();

		expect(await comeBack(state)).toMatchObject({ location: '/auth/problem' });
		expect(session()).toBeNull();
		expect(logged).not.toContain('auth-code');
	});

	it('can be finished once only', async () => {
		const { state } = await start();
		await comeBack(state);
		browser.held.delete('tejido_donor_session');

		expect(await comeBack(state)).toMatchObject({ location: '/auth/problem' });
		expect(session()).toBeNull();
	});
});

describe('signing out', () => {
	it('forgets the donor on this browser and returns to the page they were on', async () => {
		const { state } = await start();
		await comeBack(state);
		expect(session()).not.toBeNull();

		const result = await outcome(() =>
			signOut(event(`${SITE}/auth/sign-out?return_to=${encodeURIComponent('/explore')}`))
		);

		expect(result).toEqual({ kind: 'redirect', status: 303, location: '/explore' });
		expect(session()).toBeNull();
	});
});
