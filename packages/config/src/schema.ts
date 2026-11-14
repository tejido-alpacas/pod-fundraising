import { z } from 'zod';

/** The value `.env.example` ships for every name that has no safe example. */
export const PLACEHOLDER = 'replace-me';

/** A required value: present, not blank, and no longer the placeholder from `.env.example`. */
function required() {
	return z.string({ error: 'is not set' }).refine((value) => value !== PLACEHOLDER, {
		error: 'still has the placeholder value from .env.example',
		abort: true
	});
}

function httpUrl() {
	return required().refine(isHttpUrl, { error: 'must be an http or https URL' });
}

function isHttpUrl(value: string): boolean {
	const url = URL.parse(value);
	return url !== null && (url.protocol === 'https:' || url.protocol === 'http:');
}

/** True for `https://host` and `https://host/`, false once there is a path, query or fragment. */
function isOriginOnly(value: string): boolean {
	const url = URL.parse(value);
	return (
		url !== null &&
		(url.protocol === 'https:' || url.protocol === 'http:') &&
		url.pathname === '/' &&
		url.search === '' &&
		url.hash === '' &&
		url.username === '' &&
		url.password === ''
	);
}

/**
 * Every configuration value the system reads. There is exactly one of these schemas, and it is
 * parsed once at startup. Nothing here has a default: a missing value stops the process.
 *
 * The names are the environment variable names, so `.env`, the README table and the code agree.
 */
export const configSchema = z
	.object({
		// --- Tejido's own data ---
		// The database (D1) and the evidence store (R2) are Cloudflare bindings, not values.

		/** Encrypts session cookies. */
		SESSION_SECRET: required().min(32, { error: 'must be at least 32 characters' }),

		/**
		 * The value Qatom sends in the check-in header. Qatom requires a header value to be
		 * printable ASCII with no leading or trailing space, so spaces are refused outright.
		 */
		CHECKIN_SHARED_SECRET: required().regex(/^[\x21-\x7e]{32,4096}$/, {
			error: 'must be 32 or more printable characters with no spaces'
		}),

		// --- Qatom, shared ---

		/** Origin of the Qatom payment API. Stored without a trailing slash. */
		PAYMENT_API_URL: required()
			.refine(isOriginOnly, {
				error:
					'must be an origin with no path, such as https://pay.stage.m.todaq.net (leave out /v4)'
			})
			.transform((value) => new URL(value).origin),

		/** Tejido's managed MCP server on Qatom. */
		QATOM_MCP_URL: httpUrl(),

		// --- Qatom identity 1: a person, signed in with Qatom ---

		/** The sign-in client registration. Not the merchant account. */
		OIDC_CLIENT_ID: required(),
		/** The sign-in client's own secret. Sent only to Qatom's token endpoint. Server-side only. */
		OIDC_CLIENT_SECRET: required(),
		OIDC_REDIRECT_URI: httpUrl(),

		// --- Qatom identity 2: Tejido's merchant account ---

		/** The merchant account's own credentials. Server-side only. Not the sign-in client. */
		QATOM_ACCOUNT_CLIENT_ID: required(),
		QATOM_ACCOUNT_CLIENT_SECRET: required(),

		// --- Anthropic ---

		ANTHROPIC_API_KEY: required()
	})
	.check((ctx) => {
		// Both are called "client ID". Using one for the other is the easiest mistake to make here.
		if (ctx.value.OIDC_CLIENT_ID === ctx.value.QATOM_ACCOUNT_CLIENT_ID) {
			ctx.issues.push({
				code: 'custom',
				path: ['QATOM_ACCOUNT_CLIENT_ID'],
				input: undefined,
				message:
					'must not be the same as OIDC_CLIENT_ID: the sign-in client and the merchant account are two separate credentials'
			});
		}
		if (ctx.value.OIDC_CLIENT_SECRET === ctx.value.QATOM_ACCOUNT_CLIENT_SECRET) {
			ctx.issues.push({
				code: 'custom',
				path: ['QATOM_ACCOUNT_CLIENT_SECRET'],
				input: undefined,
				message:
					'must not be the same as OIDC_CLIENT_SECRET: the sign-in client and the merchant account are two separate credentials'
			});
		}
	});

export type Config = z.infer<typeof configSchema>;
export type ConfigName = keyof Config;

export const CONFIG_NAMES = Object.keys(configSchema.shape) as ConfigName[];
