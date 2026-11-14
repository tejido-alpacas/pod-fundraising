/**
 * Database commands. Run them from the repository root:
 *
 *     npm run db:prepare    apply migrations, and seed the fixtures if there are no campaigns
 *     npm run db:migrate    apply migrations only
 *     npm run db:seed       seed the fixtures, if there are no campaigns
 *     npm run db:reset      delete the database file, then migrate and seed
 *
 * `npm run dev` runs `db:prepare` first, so a fresh clone has data to show.
 */
import { ConfigError, databaseFilePath, loadConfig } from '@tejido/config';
import { rmSync } from 'node:fs';
import { hasCampaigns, runMigrations, seedFixtures } from './admin.ts';
import { openDatabase, type Database } from './client.ts';

const COMMANDS = ['prepare', 'migrate', 'seed', 'reset'] as const;
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
	const config = loadConfig();
	const file = databaseFilePath(config);

	if (command === 'reset') {
		for (const suffix of ['', '-wal', '-shm', '-journal']) rmSync(file + suffix, { force: true });
		console.log(`Deleted ${file}`);
	}

	const { db, close } = openDatabase(config.DATABASE_URL);
	try {
		await runMigrations(db);
		console.log(`Migrations applied: ${file}`);
		if (command !== 'migrate') await seedIfEmpty(db);
	} finally {
		close();
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
		// A configuration problem is the reader's to fix: show the message, not a stack trace.
		console.error(error instanceof ConfigError ? `\n${error.message}\n` : error);
		process.exitCode = 1;
	}
}
