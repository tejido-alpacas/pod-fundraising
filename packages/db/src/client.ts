import { createClient } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import * as schema from './schema.ts';

export type Database = LibSQLDatabase<typeof schema>;

/** What a query needs: the database itself, or the transaction passed to `db.transaction`. */
export type Executor = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

export interface DatabaseHandle {
	db: Database;
	close(): void;
}

/**
 * Opens the SQLite database file at `url`, creating its folder if needed.
 *
 * `url` is the DATABASE_URL from @tejido/config: an absolute `file:` URL. A relative path is
 * refused here because it would mean a different file depending on where the process started.
 * Foreign keys are enforced on every connection.
 */
export function openDatabase(url: string): DatabaseHandle {
	const path = url.startsWith('file:') ? url.slice('file:'.length) : '';
	if (!isAbsolute(path)) {
		throw new Error(
			'openDatabase needs an absolute file: URL. Pass DATABASE_URL from @tejido/config.'
		);
	}
	mkdirSync(dirname(path), { recursive: true });

	const client = createClient({ url });
	return { db: drizzle(client, { schema }), close: () => client.close() };
}
