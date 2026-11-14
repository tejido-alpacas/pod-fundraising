/**
 * Qatom identity 1 of 2: A PERSON, SIGNED IN WITH QATOM.
 *
 * The OpenID Connect authorization-code flow with PKCE, against Qatom's provider at
 * {PAYMENT_API_URL}/v4/oidc. It uses the sign-in client registration (OIDC_CLIENT_ID,
 * OIDC_REDIRECT_URI). That is a public client: there is no secret, and the merchant
 * account's credentials are never used here.
 *
 * A sign-in returns the person's email and their two wallet hostnames:
 *   - `agent_twin_hostname`, their AGENT wallet. Deposits are paid from it.
 *   - `twin_hostname`, their PRIMARY wallet. Refunds are sent to it, and only to it.
 * They come back under those meanings, as two different types, so they cannot be swapped.
 */
import {
	agentWalletHostnameSchema,
	emailSchema,
	primaryWalletHostnameSchema,
	type AgentWalletHostname,
	type PrimaryWalletHostname
} from '@tejido/contracts';
import { createLocalJWKSet, jwtVerify, type JSONWebKeySet, type JWTPayload } from 'jose';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { QatomResponseError, QatomSignInError } from '../errors.ts';
import { apiUrl, DEFAULT_TIMEOUT_MS, send } from '../http.ts';

export const SIGN_IN_SCOPES = 'openid profile email twin';

export interface PersonSignInConfig {
	/** PAYMENT_API_URL */
	paymentApiUrl: string;
	/** OIDC_CLIENT_ID. The sign-in client registration, never the merchant account's client ID. */
	clientId: string;
	/** OIDC_CLIENT_SECRET. That registration's own secret, never the merchant account's. */
	clientSecret: string;
	/** OIDC_REDIRECT_URI. Must match the registration exactly. */
	redirectUri: string;
}

/**
 * What must survive between sending the browser to Qatom and its return. Keep it on the
 * server side of the browser: an encrypted, httpOnly cookie. It is single use.
 */
export interface PendingSignIn {
	state: string;
	nonce: string;
	codeVerifier: string;
	resource?: string;
}

declare const personToken: unique symbol;
/**
 * An access token that acts as one person. It is a distinct type so it cannot be handed to
 * anything expecting other credentials; the merchant account module accepts no token at all.
 */
export type PersonAccessToken = string & { readonly [personToken]: true };

export interface SignedInPerson {
	/** Qatom's stable identifier for the person. */
	sub: string;
	email: string;
	/** The `agent_twin_hostname` claim. Deposits are paid FROM this wallet. */
	agentWalletHostname: AgentWalletHostname;
	/** The `twin_hostname` claim. Refunds are sent TO this wallet. */
	primaryWalletHostname: PrimaryWalletHostname;
	/** Never send these to the browser or write them to a log. */
	tokens: {
		accessToken: PersonAccessToken;
		refreshToken: string | null;
		/** Milliseconds since the epoch, or null if Qatom did not say. */
		expiresAtMs: number | null;
	};
}

export interface PersonSignIn {
	/**
	 * Starts a sign-in. Redirect the browser to `authorizationUrl` and keep `pending`.
	 * `resource` (RFC 8707) asks for an access token bound to one server, such as the MCP server.
	 */
	begin(options?: { resource?: string }): Promise<{
		authorizationUrl: string;
		pending: PendingSignIn;
	}>;
	/**
	 * Finishes a sign-in. `callbackUrl` is the full URL Qatom sent the browser back to.
	 * Throws QatomSignInError when the answer cannot be trusted or is incomplete.
	 */
	complete(callbackUrl: URL, pending: PendingSignIn): Promise<SignedInPerson>;
}

const discoverySchema = z.object({
	issuer: z.string().min(1),
	authorization_endpoint: z.url(),
	token_endpoint: z.url(),
	jwks_uri: z.url(),
	userinfo_endpoint: z.url().optional(),
	id_token_signing_alg_values_supported: z.array(z.string()).optional(),
	authorization_response_iss_parameter_supported: z.boolean().optional()
});
type Discovery = z.infer<typeof discoverySchema>;

const tokenResponseSchema = z.object({
	access_token: z.string().min(1),
	id_token: z.string().min(1),
	refresh_token: z.string().min(1).optional(),
	expires_in: z.number().optional()
});

const jwksSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())) });

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/**
 * `client_secret_basic` (RFC 6749 section 2.3.1): the ID and the secret are each
 * form-urlencoded, joined with a colon, then base64-encoded.
 */
function clientAuthorization(
	config: Pick<PersonSignInConfig, 'clientId' | 'clientSecret'>
): string {
	const encode = (value: string) => new URLSearchParams({ v: value }).toString().slice(2);
	const pair = `${encode(config.clientId)}:${encode(config.clientSecret)}`;
	return `Basic ${Buffer.from(pair).toString('base64')}`;
}

export function createPersonSignIn(config: PersonSignInConfig): PersonSignIn {
	let discovery: Promise<Discovery> | null = null;

	/**
	 * Qatom serves the discovery document at {PAYMENT_API_URL}/v4/oidc/.well-known/...,
	 * but the `issuer` inside it is a bare origin, and not always the host we asked. So the
	 * issuer is taken from the document, fetched over TLS from the configured origin, and
	 * every `iss` we later receive is checked against that value.
	 */
	function discover(): Promise<Discovery> {
		discovery ??= send({
			operation: 'person.discovery',
			method: 'GET',
			url: apiUrl(config.paymentApiUrl, '/v4/oidc/.well-known/openid-configuration'),
			timeoutMs: DEFAULT_TIMEOUT_MS
		})
			.then((body) => {
				const parsed = discoverySchema.safeParse(body);
				if (!parsed.success) {
					throw new QatomResponseError('person.discovery', 'the discovery document is incomplete');
				}
				return parsed.data;
			})
			.catch((error: unknown) => {
				discovery = null; // do not remember a failure
				throw error;
			});
		return discovery;
	}

	async function verifyIdToken(
		idToken: string,
		provider: Discovery,
		nonce: string
	): Promise<JWTPayload> {
		const jwks = jwksSchema.safeParse(
			await send({
				operation: 'person.jwks',
				method: 'GET',
				url: provider.jwks_uri,
				timeoutMs: DEFAULT_TIMEOUT_MS
			})
		);
		if (!jwks.success) throw new QatomResponseError('person.jwks', 'the key set has no keys');

		// Asymmetric algorithms only: never `none`, never one keyed by a shared secret.
		const algorithms = (provider.id_token_signing_alg_values_supported ?? ['RS256']).filter((alg) =>
			/^(RS|PS|ES)\d{3}$|^EdDSA$/.test(alg)
		);

		let payload: JWTPayload;
		try {
			({ payload } = await jwtVerify(idToken, createLocalJWKSet(jwks.data as JSONWebKeySet), {
				issuer: provider.issuer,
				audience: config.clientId,
				algorithms,
				clockTolerance: 60,
				requiredClaims: ['sub', 'exp', 'iat']
			}));
		} catch {
			throw new QatomSignInError('invalid_id_token', 'The ID token from Qatom did not verify.');
		}
		if (payload.nonce !== nonce) {
			throw new QatomSignInError('invalid_id_token', 'The ID token belongs to another sign-in.');
		}
		return payload;
	}

	return {
		async begin(options = {}) {
			const provider = await discover();
			const pending: PendingSignIn = {
				state: base64url(randomBytes(24)),
				nonce: base64url(randomBytes(24)),
				codeVerifier: base64url(randomBytes(32)),
				...(options.resource ? { resource: options.resource } : {})
			};

			const url = new URL(provider.authorization_endpoint);
			url.search = new URLSearchParams({
				response_type: 'code',
				client_id: config.clientId,
				redirect_uri: config.redirectUri,
				scope: SIGN_IN_SCOPES,
				state: pending.state,
				nonce: pending.nonce,
				code_challenge: base64url(createHash('sha256').update(pending.codeVerifier).digest()),
				code_challenge_method: 'S256',
				...(pending.resource ? { resource: pending.resource } : {})
			}).toString();

			return { authorizationUrl: url.toString(), pending };
		},

		async complete(callbackUrl, pending) {
			const provider = await discover();
			const params = callbackUrl.searchParams;

			// State first: nothing else in an unsolicited callback deserves a look.
			if (params.get('state') !== pending.state) {
				throw new QatomSignInError('state_mismatch', 'This sign-in did not start here.');
			}
			const refused = params.get('error');
			if (refused) {
				throw new QatomSignInError('authorization_refused', 'Qatom did not sign in.', refused);
			}
			const iss = params.get('iss');
			if (
				(iss !== null || provider.authorization_response_iss_parameter_supported) &&
				iss !== provider.issuer
			) {
				throw new QatomSignInError('issuer_mismatch', 'The answer came from another issuer.');
			}
			const code = params.get('code');
			if (!code) throw new QatomSignInError('missing_code', 'Qatom returned no code.');

			// A confidential client (Qatom's default for a registration): the sign-in client's
			// own ID and secret go in the Authorization header, as `client_secret_basic`, and
			// PKCE still binds the code to this browser's sign-in.
			const tokens = tokenResponseSchema.safeParse(
				await send({
					operation: 'person.token',
					method: 'POST',
					url: provider.token_endpoint,
					headers: { authorization: clientAuthorization(config) },
					form: {
						grant_type: 'authorization_code',
						code,
						redirect_uri: config.redirectUri,
						code_verifier: pending.codeVerifier,
						...(pending.resource ? { resource: pending.resource } : {})
					},
					timeoutMs: DEFAULT_TIMEOUT_MS
				})
			);
			if (!tokens.success) {
				throw new QatomResponseError('person.token', 'access_token or id_token is missing');
			}

			const idClaims = await verifyIdToken(tokens.data.id_token, provider, pending.nonce);
			let claims: Record<string, unknown> = idClaims;

			// A provider may leave scope claims out of the ID token and serve them from userinfo.
			const wanted = ['email', 'twin_hostname', 'agent_twin_hostname'];
			if (wanted.some((name) => claims[name] === undefined) && provider.userinfo_endpoint) {
				const userinfo = await send({
					operation: 'person.userinfo',
					method: 'GET',
					url: provider.userinfo_endpoint,
					headers: { authorization: `Bearer ${tokens.data.access_token}` },
					timeoutMs: DEFAULT_TIMEOUT_MS
				});
				if (typeof userinfo !== 'object' || userinfo === null) {
					throw new QatomResponseError('person.userinfo', 'the body is not an object');
				}
				if ((userinfo as Record<string, unknown>).sub !== idClaims.sub) {
					throw new QatomSignInError('invalid_id_token', 'Userinfo is for another person.');
				}
				claims = { ...userinfo, ...idClaims };
			}

			if (claims.email_verified === false) {
				throw new QatomSignInError('email_unverified', 'Qatom has not verified this email.');
			}
			const email = emailSchema.safeParse(claims.email);
			const primary = primaryWalletHostnameSchema.safeParse(claims.twin_hostname);
			const agent = agentWalletHostnameSchema.safeParse(claims.agent_twin_hostname);
			if (!email.success || !primary.success || !agent.success) {
				throw new QatomSignInError(
					'missing_claims',
					'The sign-in did not return an email, twin_hostname and agent_twin_hostname. ' +
						'Check that the sign-in client is allowed the `twin` scope.'
				);
			}

			return {
				sub: String(idClaims.sub),
				email: email.data,
				agentWalletHostname: agent.data,
				primaryWalletHostname: primary.data,
				tokens: {
					accessToken: tokens.data.access_token as PersonAccessToken,
					refreshToken: tokens.data.refresh_token ?? null,
					expiresAtMs:
						tokens.data.expires_in === undefined ? null : Date.now() + tokens.data.expires_in * 1000
				}
			};
		}
	};
}
