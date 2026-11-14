/**
 * @tejido/db: Tejido's own database. SQLite, through Drizzle.
 *
 * Server-only. Open it once with the DATABASE_URL from @tejido/config:
 *
 *     const { db } = openDatabase(config.DATABASE_URL);
 *
 * Setting a database up (migrations, seed) is in `@tejido/db/admin` and the commands in
 * cli.ts. A temporary database for tests is in `@tejido/db/testing`.
 */
export { openDatabase, type Database, type DatabaseHandle, type Executor } from './client.ts';
export * as schema from './schema.ts';
export { campaigns, deposits, entries, milestones, parties } from './schema.ts';
export * from './records.ts';
