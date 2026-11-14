/**
 * Database commands for the local D1 database. Run them from the repository root:
 *
 *     npm run db:prepare    apply migrations, and seed the fixtures if there are no campaigns
 *     npm run db:migrate    apply migrations only
 *     npm run db:seed       seed the fixtures, if there are no campaigns
 *     npm run db:reset      delete the local database, then migrate and seed
 *     npm run db:seed:sql   print the fixture seed as SQL, for the deployed database
 *
 * `npm run dev` runs `db:prepare` first, so a fresh clone has data to show. The deployed
 * database is migrated by infra/deploy.sh.
 */
import { localStateDirectory } from '@tejido/config/node';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { hasCampaigns, runMigrations, seedFixtures, seedFixturesSql } from './admin.ts';
import type { Database } from './client.ts';
import { openLocalDatabase } from './local.ts';

const COMMANDS = ['prepare', 'migrate', 'seed', 'reset', 'seed-sql'] as const;
type Command = (typeof COMMANDS)[number];

function isCommand(value: string | undefined): value is Command {
	return COMMANDS.includes(value as Command);
}

async function seedIfEmpty(db: Database): Promise<void> {
	if (await hasCampaigns(db)) {
		console.log(
			'Seed skipped: the database already has campaigns. `npm run db:reset` starts over.'
		);
		return;
	}
	await seedFixtures(db);
	console.log('Seeded the fixtures: 1 campaign, 3 parties, 3 milestones, 5 entries, 5 deposits.');
}

async function main(command: Command): Promise<void> {
	// Stop the dev servers first: they hold the same files open.
	const d1Folder = join(localStateDirectory(), 'd1');
	if (command === 'reset') {
		rmSync(d1Folder, { recursive: true, force: true });
		console.log(`Deleted ${d1Folder}`);
	}

	const { db, close } = await openLocalDatabase();
	try {
		if (command === 'seed-sql') {
			// Only the SQL goes to stdout, so it can be redirected to a file.
			console.log(seedFixturesSql(db));
			return;
		}
		await runMigrations(db);
		console.log(`Migrations applied: ${d1Folder}`);
		if (command !== 'migrate') await seedIfEmpty(db);
	} finally {
		await close();
	}
}

const command = process.argv[2];

if (!isCommand(command)) {
	console.error(`Usage: node src/cli.ts <${COMMANDS.join(' | ')}>`);
	process.exitCode = 1;
} else {
	try {
		await main(command);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
