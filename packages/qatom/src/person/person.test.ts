// These tests never reach the network: `fetch` is replaced, here in the test file, by a stub
// standing in for Qatom's OIDC provider. ID tokens are signed with a key made for the test.
import { exportJWK, generateKeyPair, SignJWT, type JWK } from 'jose';
import { createHash } from 'node:crypto';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { QatomHttpError, QatomSignInError, type SignInFailure } from '../errors.ts';
import { createPersonSignIn, type PendingSignIn } from './index.ts';

const API = 'https://pay.stage.qatom.ai';
const ISSUER = 'https://pay.stage.m.todaq.net'; // not the host we ask: as Qatom really answers
const CLIENT_ID = 'tejido-sign-in';
// Characters that must be form-encoded before base64, to prove they are.
const CLIENT_SECRET = 'sign-in+secret:/=';
const REDIRECT_URI = 'http://localhost:5173/auth/callback';

const discoveryDocument = {
	issuer: ISSUER,
	authorization_endpoint: `${API}/v4/oidc/auth`,
	token_endpoint: `${API}/v4/oidc/token`,
	userinfo_endpoint: `${API}/v4/oidc/me`,
	jwks_uri: `${API}/v4/oidc/jwks`,
	id_token_signing_alg_values_supported: ['RS256'],
	authorization_response_iss_parameter_supported: true
};

const walletClaims = {
	email: 'Site@CoralRidgeBuilders.example',
	email_verified: true,
	twin_hostname: 'primary0001.micro.biz.todaq.net',
	agent_twin_hostname: 'agent0001.micro.biz.todaq.net'
};

let privateKey: Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];
let publicJwk: JWK;

interface Recorded {
	method: string;
	url: string;
	headers: Record<string, string>;
	body: string | undefined;
}
let requests: Recorded[];
let tokenAnswer: { status: number; json: unknown };
let userinfoAnswer: unknown;

beforeAll(async () => {
	const pair = await generateKeyPair('RS256');
	privateKey = pair.privateKey;
	publicJwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' };
});

beforeEach(() => {
	requests = [];
	tokenAnswer = { status: 500, json: {} };
	userinfoAnswer = {};
	vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}) => {
		const url = String(input);
		requests.push({
			method: init.method ?? 'GET',
			url,
			headers: init.headers as Record<string, string>,
			body: init.body as string | undefined
		});
		const json = (body: unknown, status = 200) =>
			Promise.resolve(new Response(JSON.stringify(body), { status }));

		if (url.endsWith('/.well-known/openid-configuration')) return json(discoveryDocument);
		if (url === discoveryDocument.jwks_uri) return json({ keys: [publicJwk] });
		if (url === discoveryDocument.token_endpoint) return json(tokenAnswer.json, tokenAnswer.status);
		if (url === discoveryDocument.userinfo_endpoint) return json(userinfoAnswer);
		return Promise.reject(new Error(`unexpected request to ${url}`));
	});
});

afterEach(() => vi.unstubAllGlobals());

const signIn = () =>
	createPersonSignIn({
		paymentApiUrl: API,
		clientId: CLIENT_ID,
		clientSecret: CLIENT_SECRET,
		redirectUri: REDIRECT_URI
	});

async function idToken(claims: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
	return new SignJWT({ ...claims })
		.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
		.setIssuer((overrides.iss as string) ?? ISSUER)
		.setAudience((overrides.aud as string) ?? CLIENT_ID)
		.setSubject((overrides.sub as string) ?? 'user-123')
		.setIssuedAt()
		.setExpirationTime((overrides.exp as string) ?? '5m')
		.sign(privateKey);
}

function callback(pending: PendingSignIn, params: Record<string, string> = {}) {
	const url = new URL(REDIRECT_URI);
	url.search = new URLSearchParams({
		code: 'auth-code',
		state: pending.state,
		iss: ISSUER,
		...params
	}).toString();
	return url;
}

async function failureOf(run: Promise<unknown>): Promise<SignInFailure | string> {
	const error = await run.catch((caught: unknown) => caught);
	return error instanceof QatomSignInError
		? error.failure
		: `not a sign-in error: ${String(error)}`;
}

describe('starting a sign-in', () => {
	it('discovers the provider under {PAYMENT_API_URL}/v4/oidc', async () => {
		await signIn().begin();
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe(`${API}/v4/oidc/.well-known/openid-configuration`);
	});

	it('sends the browser to Qatom asking for openid, profile, email and twin, with PKCE', async () => {
		const { authorizationUrl, pending } = await signIn().begin();
		const url = new URL(authorizationUrl);
		const params = Object.fromEntries(url.searchParams);

		expect(url.origin + url.pathname).toBe(`${API}/v4/oidc/auth`);
		expect(params).toEqual({
			response_type: 'code',
			client_id: CLIENT_ID,
			redirect_uri: REDIRECT_URI,
			scope: 'openid profile email twin',
			state: pending.state,
			nonce: pending.nonce,
			code_challenge: createHash('sha256').update(pending.codeVerifier).digest('base64url'),
			code_challenge_method: 'S256'
		});
		expect(pending.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	it('uses fresh values every time', async () => {
		const person = signIn();
		const [first, second] = [await person.begin(), await person.begin()];

		expect(first.pending.state).not.toBe(second.pending.state);
		expect(first.pending.nonce).not.toBe(second.pending.nonce);
		expect(first.pending.codeVerifier).not.toBe(second.pending.codeVerifier);
		expect(requests).toHaveLength(1); // discovery is fetched once
	});

	it('can ask for a token bound to one resource, such as the MCP server', async () => {
		const { authorizationUrl, pending } = await signIn().begin({ resource: 'https://mcp.test/x' });
		expect(new URL(authorizationUrl).searchParams.get('resource')).toBe('https://mcp.test/x');
		expect(pending.resource).toBe('https://mcp.test/x');
	});
});

describe('finishing a sign-in', () => {
	it('exchanges the code as a public client and returns the email and both wallets', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		tokenAnswer = {
			status: 200,
			json: {
				access_token: 'person-access-token',
				refresh_token: 'person-refresh-token',
				token_type: 'Bearer',
				expires_in: 3600,
				id_token: await idToken({ ...walletClaims, nonce: pending.nonce })
			}
		};

		const signedIn = await person.complete(callback(pending), pending);

		expect(signedIn).toMatchObject({
			sub: 'user-123',
			email: 'site@coralridgebuilders.example',
			primaryWalletHostname: 'primary0001.micro.biz.todaq.net', // twin_hostname
			agentWalletHostname: 'agent0001.micro.biz.todaq.net', // agent_twin_hostname
			tokens: { accessToken: 'person-access-token', refreshToken: 'person-refresh-token' }
		});

		const exchange = requests.find((request) => request.url === discoveryDocument.token_endpoint);
		expect(exchange?.method).toBe('POST');
		// The sign-in client authenticates with its own ID and secret, form-encoded then base64.
		expect(exchange?.headers).toEqual({
			accept: 'application/json',
			authorization: `Basic ${Buffer.from(`${CLIENT_ID}:sign-in%2Bsecret%3A%2F%3D`).toString('base64')}`,
			'content-type': 'application/x-www-form-urlencoded'
		});
		expect(Object.fromEntries(new URLSearchParams(exchange?.body))).toEqual({
			grant_type: 'authorization_code',
			code: 'auth-code',
			redirect_uri: REDIRECT_URI,
			code_verifier: pending.codeVerifier
		});
		// The ID token carried every claim, so userinfo was not needed.
		expect(requests.some((request) => request.url === discoveryDocument.userinfo_endpoint)).toBe(
			false
		);
	});

	it('reads the claims from userinfo when the ID token leaves them out', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		tokenAnswer = {
			status: 200,
			json: {
				access_token: 'person-access-token',
				id_token: await idToken({ nonce: pending.nonce })
			}
		};
		userinfoAnswer = { sub: 'user-123', ...walletClaims };

		const signedIn = await person.complete(callback(pending), pending);

		expect(signedIn.email).toBe('site@coralridgebuilders.example');
		expect(signedIn.agentWalletHostname).toBe('agent0001.micro.biz.todaq.net');
		const userinfo = requests.find(
			(request) => request.url === discoveryDocument.userinfo_endpoint
		);
		expect(userinfo?.headers.authorization).toBe('Bearer person-access-token');
	});

	it('refuses userinfo that is about someone else', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		tokenAnswer = {
			status: 200,
			json: { access_token: 'a', id_token: await idToken({ nonce: pending.nonce }) }
		};
		userinfoAnswer = { sub: 'someone-else', ...walletClaims };

		expect(await failureOf(person.complete(callback(pending), pending))).toBe('invalid_id_token');
	});

	it('refuses a callback whose state it did not issue, before asking Qatom anything', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		const before = requests.length;

		expect(await failureOf(person.complete(callback(pending, { state: 'forged' }), pending))).toBe(
			'state_mismatch'
		);
		expect(requests).toHaveLength(before);
	});

	it('reports a refusal at Qatom with its reason', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		const error = await person
			.complete(callback(pending, { error: 'access_denied' }), pending)
			.catch((caught: unknown) => caught);

		expect(error).toMatchObject({ failure: 'authorization_refused', code: 'access_denied' });
	});

	it('refuses an answer from another issuer, or one that does not name its issuer', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		const withoutIss = callback(pending);
		withoutIss.searchParams.delete('iss');

		expect(
			await failureOf(person.complete(callback(pending, { iss: 'https://evil.test' }), pending))
		).toBe('issuer_mismatch');
		expect(await failureOf(person.complete(withoutIss, pending))).toBe('issuer_mismatch');
	});

	it('refuses a callback without a code', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		const url = callback(pending);
		url.searchParams.delete('code');

		expect(await failureOf(person.complete(url, pending))).toBe('missing_code');
	});

	it.each([
		['signed for another client', { aud: 'another-client' }],
		['from another issuer', { iss: 'https://evil.test' }],
		['already expired', { exp: '-10m' }]
	])('refuses an ID token %s', async (_name, overrides) => {
		const person = signIn();
		const { pending } = await person.begin();
		tokenAnswer = {
			status: 200,
			json: {
				access_token: 'a',
				id_token: await idToken({ ...walletClaims, nonce: pending.nonce }, overrides)
			}
		};

		expect(await failureOf(person.complete(callback(pending), pending))).toBe('invalid_id_token');
	});

	it('refuses an ID token minted for a different sign-in', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		tokenAnswer = {
			status: 200,
			json: { access_token: 'a', id_token: await idToken({ ...walletClaims, nonce: 'other' }) }
		};

		expect(await failureOf(person.complete(callback(pending), pending))).toBe('invalid_id_token');
	});

	it('refuses an ID token signed with a key Qatom does not publish', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		const stranger = await generateKeyPair('RS256');
		const forged = await new SignJWT({ ...walletClaims, nonce: pending.nonce })
			.setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
			.setIssuer(ISSUER)
			.setAudience(CLIENT_ID)
			.setSubject('user-123')
			.setIssuedAt()
			.setExpirationTime('5m')
			.sign(stranger.privateKey);
		tokenAnswer = { status: 200, json: { access_token: 'a', id_token: forged } };

		expect(await failureOf(person.complete(callback(pending), pending))).toBe('invalid_id_token');
	});

	it('refuses an unsigned ID token', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
		const unsigned = `${encode({ alg: 'none' })}.${encode({
			...walletClaims,
			nonce: pending.nonce,
			iss: ISSUER,
			aud: CLIENT_ID,
			sub: 'user-123',
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 300
		})}.`;
		tokenAnswer = { status: 200, json: { access_token: 'a', id_token: unsigned } };

		expect(await failureOf(person.complete(callback(pending), pending))).toBe('invalid_id_token');
	});

	it('refuses a sign-in without both wallet hostnames, which the twin scope provides', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		const { agent_twin_hostname: _removed, ...withoutAgent } = walletClaims;
		tokenAnswer = {
			status: 200,
			json: {
				access_token: 'a',
				id_token: await idToken({ ...withoutAgent, nonce: pending.nonce })
			}
		};
		userinfoAnswer = { sub: 'user-123', ...withoutAgent };

		expect(await failureOf(person.complete(callback(pending), pending))).toBe('missing_claims');
	});

	it('refuses an email Qatom has not verified', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		tokenAnswer = {
			status: 200,
			json: {
				access_token: 'a',
				id_token: await idToken({ ...walletClaims, email_verified: false, nonce: pending.nonce })
			}
		};

		expect(await failureOf(person.complete(callback(pending), pending))).toBe('email_unverified');
	});

	it('carries the status and OAuth error code when the code exchange is refused', async () => {
		const person = signIn();
		const { pending } = await person.begin();
		tokenAnswer = {
			status: 400,
			json: { error: 'invalid_grant', error_description: 'grant request is invalid' }
		};
		const error = await person
			.complete(callback(pending), pending)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(QatomHttpError);
		expect(error).toMatchObject({
			operation: 'person.token',
			status: 400,
			code: 'invalid_grant',
			detail: 'grant request is invalid'
		});
		expect(String(error)).not.toContain(pending.codeVerifier);
	});
});
