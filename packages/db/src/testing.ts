/**
 * A real, migrated database in a temporary folder, for tests. Tests use a file rather than
 * an in-memory database so they exercise exactly what runs in development and production.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runMigrations, seedFixtures } from './admin.ts';
import { openDatabase, type Database } from './client.ts';

export interface TestDatabase {
	db: Database;
	/** The temporary folder holding the database file. */
	dir: string;
	/** Closes the database and deletes the folder. Call it in `afterEach`. */
	destroy(): void;
}

export async function createTestDatabase(options: { seed?: boolean } = {}): Promise<TestDatabase> {
	const dir = mkdtempSync(join(tmpdir(), 'tejido-test-'));
	const { db, close } = openDatabase(`file:${join(dir, 'test.db')}`);

	await runMigrations(db);
	if (options.seed) await seedFixtures(db);

	return {
		db,
		dir,
		destroy() {
			close();
			rmSync(dir, { recursive: true, force: true });
		}
	};
}
