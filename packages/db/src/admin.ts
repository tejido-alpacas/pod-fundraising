/**
 * Setting a database up: migrations and the fixture seed. Used by the command line in cli.ts
 * and by tests, in Node. The apps do not import this; they expect a database that is already
 * set up.
 */
import { fixtures } from '@tejido/contracts/fixtures';
import { migrate } from 'drizzle-orm/d1/migrator';
import { join } from 'node:path';
import type { Database } from './client.ts';
import { campaigns, deposits, entries, milestones, parties } from './schema.ts';

/** The SQL migrations written by `npm run db:generate`, committed beside this package. */
export const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'drizzle');

/**
 * Brings a local or test database up to the current schema. Safe to run again: applied
 * migrations are skipped. The deployed database is migrated by `wrangler d1 migrations apply`
 * from the same folder (infra/deploy.sh).
 */
export async function runMigrations(db: Database): Promise<void> {
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export async function hasCampaigns(db: Database): Promise<boolean> {
	const [row] = await db.select({ id: campaigns.id }).from(campaigns).limit(1);
	return row !== undefined;
}

/** The fixture inserts, in the order foreign keys need. */
function fixtureInserts(db: Database) {
	return [
		db.insert(campaigns).values(fixtures.campaign),
		db.insert(parties).values(fixtures.parties),
		db.insert(milestones).values(fixtures.milestones),
		db.insert(entries).values(fixtures.entries),
		db.insert(deposits).values(fixtures.deposits)
	] as const;
}

/** Inserts the fixtures from @tejido/contracts. All of them, or none. */
export async function seedFixtures(db: Database): Promise<void> {
	await db.batch(fixtureInserts(db));
}

/**
 * The same seed as plain SQL, for a database this process cannot reach: the deployed one.
 * `npm run db:seed:sql` prints it and `wrangler d1 execute --remote --file` runs it.
 */
export function seedFixturesSql(db: Database): string {
	return fixtureInserts(db)
		.map((insert) => {
			const { sql, params } = insert.toSQL();
			let next = 0;
			return sql.replace(/\?/g, () => literal(params[next++])) + ';';
		})
		.join('\n');
}

function literal(value: unknown): string {
	if (value === null || value === undefined) return 'NULL';
	if (typeof value === 'number' || typeof value === 'bigint') return String(value);
	if (typeof value === 'boolean') return value ? '1' : '0';
	if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
	throw new Error(`Cannot write a ${typeof value} as a SQL literal.`);
}
