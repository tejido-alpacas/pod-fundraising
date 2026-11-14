import type { D1Database } from '@cloudflare/workers-types';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema.ts';

export type Database = DrizzleD1Database<typeof schema>;

/**
 * What a query needs. D1 has no interactive transactions, so this is always the database;
 * writes that must land together go in one `db.batch([...])`, which D1 runs as a transaction.
 */
export type Executor = Database;

/**
 * Wraps a D1 binding (`env.DB`) for Drizzle. There is nothing to close.
 * D1 enforces foreign keys on every query.
 */
export function openDatabase(d1: D1Database): Database {
	return drizzle(d1, { schema });
}
