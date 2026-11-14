/**
 * Setting a database up: migrations and the fixture seed. Used by the command line in cli.ts
 * and by tests. The web app does not import this; it expects a database that is already set up.
 */
import { fixtures } from '@tejido/contracts/fixtures';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { join } from 'node:path';
import type { Database } from './client.ts';
import { campaigns, deposits, entries, milestones, parties } from './schema.ts';

/** The SQL migrations written by `npm run db:generate`, committed beside this package. */
export const MIGRATIONS_FOLDER = join(import.meta.dirname, '..', 'drizzle');

/** Brings the database up to the current schema. Safe to run again: applied migrations are skipped. */
export async function runMigrations(db: Database): Promise<void> {
	await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
}

export async function hasCampaigns(db: Database): Promise<boolean> {
	const [row] = await db.select({ id: campaigns.id }).from(campaigns).limit(1);
	return row !== undefined;
}

/** Inserts the fixtures from @tejido/contracts. All of them, or none. */
export async function seedFixtures(db: Database): Promise<void> {
	await db.transaction(async (tx) => {
		await tx.insert(campaigns).values(fixtures.campaign);
		await tx.insert(parties).values(fixtures.parties);
		await tx.insert(milestones).values(fixtures.milestones);
		await tx.insert(entries).values(fixtures.entries);
		await tx.insert(deposits).values(fixtures.deposits);
	});
}
