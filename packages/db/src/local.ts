/**
 * The local D1 database both dev servers use, opened from Node for the commands in cli.ts.
 * Wrangler keeps it under ./data at the repository root; see `localStateDirectory`.
 */
import type { D1Database } from '@cloudflare/workers-types';
import { localStateDirectory } from '@tejido/config/node';
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { openDatabase, type Database } from './client.ts';

/** What packages/db/wrangler.jsonc binds. */
export interface LocalBindings {
	DB: D1Database;
}

export interface LocalDatabase {
	db: Database;
	close(): Promise<void>;
}

export async function openLocalDatabase(): Promise<LocalDatabase> {
	const proxy = await getPlatformProxy<LocalBindings>({
		configPath: join(import.meta.dirname, '..', 'wrangler.jsonc'),
		persist: { path: localStateDirectory() },
		envFiles: []
	});
	return { db: openDatabase(proxy.env.DB), close: () => proxy.dispose() };
}
