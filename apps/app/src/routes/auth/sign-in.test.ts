// The whole sign-in round trip: /auth/sign-in, then /auth/callback, with one browser's cookies
// carried between them. The routes' own handlers run against the real Qatom sign-in client and
// a real, migrated, seeded local D1.
//
// These tests never reach the network: `fetch` is replaced, here in the test file, by a stub
// standing in for Qatom's OIDC provider. ID tokens are signed with a key made for the test.
import { fixtures } from '@tejido/contracts/fixtures';
import { getParty, readSealedSignInTokens } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createPersonSignIn } from '@tejido/qatom/person';
import { createSign, generateKeyPairSync } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mcpResource, unsealPersonTokens, usablePersonToken } from '#lib/server/person-tokens.ts';
import { readSession, unseal, type Session } from '#lib/server/session.ts';
import { cookieJar, outcome, type CookieJar, type Outcome } from '#lib/server/test-helpers.ts';
import { GET as callback } from './callback/+server.ts';
import { GET as signIn } from './sign-in/+server.ts';
import { POST as signOut } from './sign-out/+server.ts';

const SESSION_SECRET = 'session-secret-session-secret-session';
const API = 'https://pay.stage.qatom.test';
const ISSUER = 'https://issuer.qatom.test';
const CLIENT_ID = 'tejido-sign-in';
const REDIRECT_URI = 'http://localhost:5174/auth/callback';

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

const MCP_URL = 'https://tejido.mcp.qatom.test/mcp';
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;

// What Qatom says about the person who signs in. Not the fixture's wallets, so a test can
// tell whether the party's wallets were replaced.
const AGENT_WALLET = 'agent0001.micro.biz.todaq.net';
const PRIMARY_WALLET = 'primary0001.micro.biz.todaq.net';
const contractorClaims = {
	email: contractor.email,
	email_verified: true,
	twin_hostname: PRIMARY_WALLET,
	agent_twin_hostname: AGENT_WALLET
};
const ACCESS_TOKEN = 'person-access-token-do-not-leak';
const REFRESH_TOKEN = 'person-refresh-token-do-not-leak';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const publicJwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256' };

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function idToken(claims: Record<string, unknown>): string {
	const now = Math.floor(Date.now() / 1000);
	const signed = `${encode({ alg: 'RS256', kid: 'test-key' })}.${encode({
		iss: ISSUER,
		aud: CLIENT_ID,
		sub: 'qatom-user-123',
		iat: now,
		exp: now + 300,
		...claims
	})}`;
	return `${signed}.${createSign('RSA-SHA256').update(signed).sign(privateKey).toString('base64url')}`;
}

let test: TestDatabase;
let browser: CookieJar;
let person: ReturnType<typeof createPersonSignIn>;
/** How the stub provider behaves in this test. */
let qatom: {
	discoveryStatus: number;
	tokenStatus: number;
	/** The claims Qatom puts in the ID token, besides the nonce. */
	claims: Record<string, unknown>;
	userinfo: Record<string, unknown>;
};
let logged: string;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	browser = cookieJar();
	person = createPersonSignIn({
		paymentApiUrl: API,
		clientId: CLIENT_ID,
		clientSecret: 'sign-in-client-secret',
		redirectUri: REDIRECT_URI
	});
	qatom = { discoveryStatus: 200, tokenStatus: 200, claims: contractorClaims, userinfo: {} };
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
				refresh_token: REFRESH_TOKEN,
				token_type: 'Bearer',
				expires_in: 3600,
				id_token: idToken({ ...qatom.claims, nonce })
			});
		}
		if (url === provider.userinfo_endpoint) {
			return json({ sub: 'qatom-user-123', ...qatom.userinfo });
		}
		// The sign-in names the MCP server, so claims missing from the ID token are read here.
		if (url === provider.introspection_endpoint) {
			return json({ active: true, sub: 'qatom-user-123', ...qatom.userinfo });
		}
		return Promise.reject(new Error(`unexpected request to ${url}`));
	});
	// The provider learns the nonce when the browser arrives at its authorization page.
	rememberNonce = (value) => (nonce = value);
});

let rememberNonce: (nonce: string) => void;

afterEach(async () => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	await test.destroy();
});

/** The part of `event` these handlers use. One shape serves all three routes. */
type RouteEvent = Parameters<typeof signIn>[0] &
	Parameters<typeof callback>[0] &
	Parameters<typeof signOut>[0];

const refresher = () => ({ person, resource: mcpResource(MCP_URL) });

function event(url: string) {
	const locals = {
		ctx: { config: { SESSION_SECRET, QATOM_MCP_URL: MCP_URL }, db: test.db, qatom: { person } },
		session: readSession(browser, SESSION_SECRET)
	};
	// A whole RequestEvent cannot be built outside SvelteKit; the handlers use only these parts.
	return { url: new URL(url), cookies: browser, locals } as unknown as RouteEvent;
}

/** Opens /auth/sign-in and follows the browser to Qatom's authorization page. */
async function start(query: string): Promise<{ result: Outcome; state: string }> {
	const result = await outcome(() => signIn(event(`http://localhost:5174/auth/sign-in${query}`)));
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

const session = () => readSession(browser, SESSION_SECRET);
const wallets = async (partyId: string) => {
	const party = await getParty(test.db, partyId);
	return { agent: party?.agentWalletHostname, primary: party?.primaryWalletHostname };
};
const fixtureWallets = {
	agent: contractor.agentWalletHostname,
	primary: contractor.primaryWalletHostname
};

/** A sign-in that failed changed nothing: no session, and the party's wallets as they were. */
async function expectNothingChanged() {
	expect(session()).toBeNull();
	expect(await wallets(contractor.id)).toEqual(fixtureWallets);
	expect(await readSealedSignInTokens(test.db, contractor.id)).toBeUndefined();
}

describe('signing in from an invite', () => {
	it('links both wallets to the party, each under its own meaning, and signs the person in', async () => {
		const { result, state } = await start(`?party=${contractor.id}`);
		expect(result).toMatchObject({ kind: 'redirect', status: 302 });

		expect(await comeBack(state)).toEqual({ kind: 'redirect', status: 303, location: '/' });

		// agent_twin_hostname is the agent wallet; twin_hostname is the primary wallet.
		expect(await wallets(contractor.id)).toEqual({ agent: AGENT_WALLET, primary: PRIMARY_WALLET });
		expect(session()).toEqual({
			sub: 'qatom-user-123',
			email: contractor.email,
			partyId: contractor.id
		});
		// Nobody else's wallets moved.
		expect(await wallets(supplier.id)).toEqual({
			agent: supplier.agentWalletHostname,
			primary: supplier.primaryWalletHostname
		});
	});

	it('keeps the tokens out of the browser and out of the log', async () => {
		const { state } = await start(`?party=${contractor.id}`);
		await comeBack(state);

		// The session holds exactly who signed in, and nothing else.
		expect(Object.keys(session() ?? {}).sort()).toEqual(['email', 'partyId', 'sub']);
		for (const value of browser.held.values()) {
			const readable = Buffer.from(value, 'base64url').toString('latin1');
			expect(value + readable).not.toContain(ACCESS_TOKEN);
			expect(value + readable).not.toContain(REFRESH_TOKEN);
		}
		expect(logged).toBe('');
	});

	it('keeps the tokens for the agent chat, sealed, in the database row of that party', async () => {
		const { state } = await start(`?party=${contractor.id}`);
		await comeBack(state);

		const row = await readSealedSignInTokens(test.db, contractor.id);
		// What is stored cannot be read without the key.
		const stored = JSON.stringify(row);
		const readable = Buffer.from(row?.sealedTokens ?? '', 'base64url').toString('latin1');
		expect(stored + readable).not.toContain(ACCESS_TOKEN);
		expect(stored + readable).not.toContain(REFRESH_TOKEN);
		// It is not a session cookie, and a session cookie is not it.
		expect(unseal(row?.sealedTokens, SESSION_SECRET, 'session')).toBeNull();
		expect(unsealPersonTokens(browser.held.get('tejido_session'), SESSION_SECRET)).toBeNull();
		// With the key, the server gets back exactly what Qatom issued.
		expect(unsealPersonTokens(row?.sealedTokens, SESSION_SECRET)).toMatchObject({
			accessToken: ACCESS_TOKEN,
			refreshToken: REFRESH_TOKEN
		});
		// Nobody else has any.
		expect(await readSealedSignInTokens(test.db, supplier.id)).toBeUndefined();
	});

	it('goes on to the page asked for, on this site only', async () => {
		const first = await start(`?party=${contractor.id}&return_to=/chat`);
		expect(await comeBack(first.state)).toMatchObject({ location: '/chat' });

		const second = await start(`?party=${contractor.id}&return_to=//elsewhere.example/x`);
		expect(await comeBack(second.state)).toMatchObject({ location: '/' });
	});

	it('takes the party from the sealed cookie, never from the address Qatom sends back', async () => {
		const { state } = await start(`?party=${contractor.id}`);

		await comeBack(state, { code: 'auth-code', party: supplier.id });

		expect(session()?.partyId).toBe(contractor.id);
		expect((await wallets(supplier.id)).agent).toBe(supplier.agentWalletHostname);
	});

	it('hides the sign-in in progress from the browser', async () => {
		const { state } = await start(`?party=${contractor.id}`);

		const cookie = browser.held.get('tejido_sign_in') ?? '';
		expect(Buffer.from(cookie, 'base64url').toString('latin1')).not.toContain(state);
		// It cannot pass as a session either.
		expect(unseal<Session>(cookie, SESSION_SECRET, 'session')).toBeNull();
	});

	it('signs a person in without linking anything when there was no invite', async () => {
		const { state } = await start('');

		expect(await comeBack(state)).toMatchObject({ kind: 'redirect', location: '/' });

		expect(session()).toEqual({ sub: 'qatom-user-123', email: contractor.email, partyId: null });
		expect(await wallets(contractor.id)).toEqual(fixtureWallets);
		// No invite, no party, so no tokens are kept for anyone.
		expect(await readSealedSignInTokens(test.db, contractor.id)).toBeUndefined();
	});
});

describe('a sign-in that does not finish', () => {
	it('stops before Qatom when the invite is not one of ours', async () => {
		const { result } = await start('?party=pty-nobody');

		expect(result).toEqual({
			kind: 'redirect',
			status: 303,
			location: '/auth/problem?reason=unknown_invite'
		});
		expect(browser.held.size).toBe(0);
	});

	it('explains when Qatom cannot be reached to start', async () => {
		qatom.discoveryStatus = 503;

		const { result } = await start(`?party=${contractor.id}`);

		expect(result).toMatchObject({
			location: `/auth/problem?reason=qatom_unavailable&party=${contractor.id}`
		});
		expect(browser.held.size).toBe(0);
	});

	it('refuses an invite sent to a different email address, and links nothing', async () => {
		qatom.claims = { ...contractorClaims, email: supplier.email };
		const { state } = await start(`?party=${contractor.id}`);

		expect(await comeBack(state)).toEqual({
			kind: 'redirect',
			status: 303,
			location: `/auth/problem?reason=wrong_email&party=${contractor.id}`
		});
		await expectNothingChanged();
	});

	it('explains when Qatom does not return the wallets (missing_claims)', async () => {
		qatom.claims = { email: contractor.email, email_verified: true };
		const { state } = await start(`?party=${contractor.id}`);

		expect(await comeBack(state)).toMatchObject({
			location: `/auth/problem?reason=missing_wallets&party=${contractor.id}`
		});
		await expectNothingChanged();
	});

	it('refuses when only one of the two wallets comes back', async () => {
		qatom.claims = { ...contractorClaims, twin_hostname: undefined };
		const { state } = await start(`?party=${contractor.id}`);

		expect(await comeBack(state)).toMatchObject({
			location: `/auth/problem?reason=missing_wallets&party=${contractor.id}`
		});
		await expectNothingChanged();
	});

	it('explains when Qatom has not verified the email address', async () => {
		qatom.claims = { ...contractorClaims, email_verified: false };
		const { state } = await start(`?party=${contractor.id}`);

		expect(await comeBack(state)).toMatchObject({
			location: `/auth/problem?reason=email_unverified&party=${contractor.id}`
		});
		await expectNothingChanged();
	});

	it('explains when the person cancels at Qatom', async () => {
		const { state } = await start(`?party=${contractor.id}`);

		expect(await comeBack(state, { error: 'access_denied' })).toMatchObject({
			location: `/auth/problem?reason=refused&party=${contractor.id}`
		});
		await expectNothingChanged();
	});

	it('does not accept an answer for a sign-in it did not start', async () => {
		await start(`?party=${contractor.id}`);

		expect(await comeBack('someone-elses-state')).toMatchObject({
			location: `/auth/problem?reason=not_trusted&party=${contractor.id}`
		});
		await expectNothingChanged();
	});

	it('explains when Qatom fails while finishing, without logging anything secret', async () => {
		qatom.tokenStatus = 500;
		const { state } = await start(`?party=${contractor.id}`);

		expect(await comeBack(state)).toMatchObject({
			location: `/auth/problem?reason=qatom_unavailable&party=${contractor.id}`
		});
		await expectNothingChanged();
		expect(logged).toContain('person.token');
		expect(logged).not.toContain('auth-code');
	});

	it('refuses a callback from a browser that never started a sign-in', async () => {
		expect(await comeBack('any-state')).toEqual({
			kind: 'redirect',
			status: 303,
			location: '/auth/problem?reason=expired'
		});
		await expectNothingChanged();
	});

	it('can be finished once only', async () => {
		const { state } = await start(`?party=${contractor.id}`);
		await comeBack(state);
		browser.held.delete('tejido_session');

		expect(await comeBack(state)).toMatchObject({ location: '/auth/problem?reason=expired' });
		expect(session()).toBeNull();
	});
});

describe('signing out', () => {
	it('forgets the session and returns to the home page', async () => {
		const { state } = await start(`?party=${contractor.id}`);
		await comeBack(state);
		expect(session()).not.toBeNull();

		const result = await outcome(() => signOut(event('http://localhost:5174/auth/sign-out')));

		expect(result).toEqual({ kind: 'redirect', status: 303, location: '/' });
		expect(session()).toBeNull();
	});

	it('asks Qatom for a token the MCP server accepts, and for long-lived access', async () => {
		const { result } = await start(`?party=${contractor.id}`);
		if (result.kind !== 'redirect') throw new Error('expected a redirect to Qatom');
		const asked = new URL(result.location).searchParams;

		// The MCP server is named by its origin; Qatom compares origins.
		expect(asked.get('resource')).toBe('https://tejido.mcp.qatom.test');
		expect(asked.get('scope')).toBe('openid profile email twin offline_access');
		expect(asked.get('prompt')).toBe('consent');
	});

	it('deletes the tokens kept for the agent chat, so the agent can no longer act for them', async () => {
		const { state } = await start(`?party=${contractor.id}`);
		await comeBack(state);
		expect(
			await usablePersonToken(test.db, SESSION_SECRET, contractor.id, refresher())
		).toMatchObject({
			ok: true
		});

		await outcome(() => signOut(event('http://localhost:5174/auth/sign-out')));

		expect(await readSealedSignInTokens(test.db, contractor.id)).toBeUndefined();
		expect(await usablePersonToken(test.db, SESSION_SECRET, contractor.id, refresher())).toEqual({
			ok: false,
			reason: 'none'
		});
	});

	it('works for someone who is not signed in', async () => {
		const result = await outcome(() => signOut(event('http://localhost:5174/auth/sign-out')));

		expect(result).toEqual({ kind: 'redirect', status: 303, location: '/' });
	});
});
