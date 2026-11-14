/**
 * Everything the server needs, built once when it starts: the parsed configuration, the
 * database, and the two Qatom clients. Routes reach it as `event.locals.ctx`.
 *
 * This file is the only place in the web app that reads the environment, and the only place
 * the two Qatom identities are given their credentials. Each gets its own, from its own names.
 */
import { evidenceDirectory, loadConfig, type Config } from '@tejido/config';
import { openDatabase, type Database } from '@tejido/db';
import { createMerchantAccount, type MerchantAccount } from '@tejido/qatom/account';
import { createPersonSignIn, type PersonSignIn } from '@tejido/qatom/person';

export interface ServerContext {
	config: Config;
	db: Database;
	/** The folder uploaded evidence is stored in. */
	evidenceDir: string;
	qatom: {
		/** Identity 1: a person, signed in with Qatom. Uses OIDC_*. */
		person: PersonSignIn;
		/** Identity 2: Tejido's merchant account. Uses QATOM_ACCOUNT_*. Never leaves the server. */
		account: MerchantAccount;
	};
}

// Kept on globalThis so a dev-server reload reuses the open database instead of leaking it.
const store = globalThis as typeof globalThis & {
	__tejidoApp?: { context: ServerContext; close(): void };
};

/** Parses configuration and opens everything. Throws ConfigError if a value is missing. */
export function initContext(): ServerContext {
	store.__tejidoApp?.close();

	const config = loadConfig();
	const { db, close } = openDatabase(config.DATABASE_URL);

	const context: ServerContext = {
		config,
		db,
		evidenceDir: evidenceDirectory(config),
		qatom: {
			person: createPersonSignIn({
				paymentApiUrl: config.PAYMENT_API_URL,
				clientId: config.OIDC_CLIENT_ID,
				redirectUri: config.OIDC_REDIRECT_URI
			}),
			account: createMerchantAccount({
				paymentApiUrl: config.PAYMENT_API_URL,
				clientId: config.QATOM_ACCOUNT_CLIENT_ID,
				clientSecret: config.QATOM_ACCOUNT_CLIENT_SECRET
			})
		}
	};

	store.__tejidoApp = { context, close };
	return context;
}

export function getContext(): ServerContext {
	return store.__tejidoApp?.context ?? initContext();
}
