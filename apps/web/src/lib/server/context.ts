/**
 * Everything the server needs, built once when it starts: the parsed configuration, the database, and the
 * two Qatom clients. Routes reach it as `event.locals.ctx`.
 *
 * This file is the only place in the web app that reads the Worker's environment, and the only
 * place the two Qatom identities are given their credentials. Each gets its own, from its own
 * names.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { parseConfig, type Config } from '@tejido/config';
import { openDatabase, type Database } from '@tejido/db';
import { createMerchantAccount, type MerchantAccount } from '@tejido/qatom/account';
import { createPersonSignIn, type PersonSignIn } from '@tejido/qatom/person';
import { env } from 'cloudflare:workers';

/**
 * What Cloudflare hands the Worker as `env`: the bindings declared in wrangler.jsonc,
 * and the configuration values as strings (Worker secrets when deployed, `.env` locally).
 */
export interface WorkerEnv extends Record<string, unknown> {
	/** Our D1 database. The Campaign Site and the App share it. */
	DB: D1Database;
}

export interface ServerContext {
	config: Config;
	db: Database;
	qatom: {
		/** Identity 1: a person, signed in with Qatom. Uses OIDC_*. */
		person: PersonSignIn;
		/** Identity 2: Tejido's merchant account. Uses QATOM_ACCOUNT_*. Never leaves the server. */
		account: MerchantAccount;
	};
}

let context: ServerContext | undefined;

/**
 * Parses configuration and builds everything. Throws ConfigError if a value is missing.
 * Runs once per Worker instance: bindings and configuration do not change while one lives,
 * and the merchant account caches its own token.
 */
export function initContext(): ServerContext {
	const config = parseConfig(env);

	context = {
		config,
		db: openDatabase(env.DB),
		qatom: {
			person: createPersonSignIn({
				paymentApiUrl: config.PAYMENT_API_URL,
				clientId: config.OIDC_CLIENT_ID,
				clientSecret: config.OIDC_CLIENT_SECRET,
				redirectUri: config.OIDC_REDIRECT_URI
			}),
			account: createMerchantAccount({
				paymentApiUrl: config.PAYMENT_API_URL,
				clientId: config.QATOM_ACCOUNT_CLIENT_ID,
				clientSecret: config.QATOM_ACCOUNT_CLIENT_SECRET
			})
		}
	};
	return context;
}

export function getContext(): ServerContext {
	return context ?? initContext();
}
