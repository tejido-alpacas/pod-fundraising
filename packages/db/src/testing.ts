/**
 * A real, migrated D1 database for tests, run locally by Wrangler and kept in memory. Tests
 * use D1 itself rather than a stand-in so they exercise what runs in production. Nothing
 * here reaches the network.
 */
import { join } from 'node:path';
import { getPlatformProxy } from 'wrangler';
import { runMigrations, seedFixtures } from './admin.ts';
import { openDatabase, type Database } from './client.ts';
import type { LocalBindings } from './local.ts';

export interface TestDatabase {
	db: Database;
	/** Stops the local D1 and discards its data. Call it in `afterEach`. */
	destroy(): Promise<void>;
}

export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
	const proxy = await getPlatformProxy<LocalBindings>({
		configPath: join(import.meta.dirname, '..', 'wrangler.jsonc'),
		persist: false,
		envFiles: []
	});
	const db = openDatabase(proxy.env.DB);

	await runMigrations(db);
	if (options.seed) await seedFixtures(db);

	return { db, destroy: () => proxy.dispose() };
}
