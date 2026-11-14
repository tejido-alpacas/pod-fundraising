/**
 * Database commands for the local D1 database. Run them from the repository root:
 *
 *     npm run db:prepare    apply migrations, and seed the fixtures if there are no campaigns
 *     npm run db:migrate    apply migrations only
 *     npm run db:seed       seed the fixtures, if there are no campaigns
 *     npm run db:reset      delete the local database, then migrate and seed
 *     npm run db:seed:sql   print the fixture seed as SQL, for the deployed database
 *     npm run db:seed:e2e:sql -- --inbox-domain <domain>
 *                           print the end-to-end suite's test campaign as SQL, for the deployed
 *                           database. Add --log-work-commodity-id and --milestone-hit-commodity-id
 *                           once its two catalog items exist. See e2e/README.md.
 *
 * `npm run dev` runs `db:prepare` first, so a fresh clone has data to show. The deployed
 * database is migrated by infra/deploy.sh.
 */
import { localStateDirectory } from '@tejido/config/node';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
	e2eFixtureSql,
	hasCampaigns,
	runMigrations,
	seedFixtures,
	seedFixturesSql
} from './admin.ts';
import type { E2eFixtureInput } from './e2e-fixture.ts';
import type { Database } from './client.ts';
import { openLocalDatabase } from './local.ts';

const COMMANDS = ['prepare', 'migrate', 'seed', 'reset', 'seed-sql', 'e2e-seed-sql'] as const;
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

/** The inputs of `e2e-seed-sql`, from the command line. A commodity id left out is null. */
function e2eFixtureInput(args: string[]): E2eFixtureInput {
	const { values } = parseArgs({
		args,
		options: {
			'inbox-domain': { type: 'string' },
			'log-work-commodity-id': { type: 'string' },
			'milestone-hit-commodity-id': { type: 'string' }
		}
	});
	const inboxDomain = values['inbox-domain'];
	if (!inboxDomain) {
		throw new Error('Give the inbox domain: npm run db:seed:e2e:sql -- --inbox-domain <domain>');
	}
	const id = (name: 'log-work-commodity-id' | 'milestone-hit-commodity-id') => {
		const value = values[name];
		if (value === undefined) return null;
		if (!/^[1-9]\d*$/.test(value)) throw new Error(`--${name} must be a whole number.`);
		return Number(value);
	};
	return {
		inboxDomain,
		logWorkCommodityId: id('log-work-commodity-id'),
		milestoneHitCommodityId: id('milestone-hit-commodity-id')
	};
}

async function main(command: Command, args: string[]): Promise<void> {
	// Stop the dev servers first: they hold the same files open.
	const d1Folder = join(localStateDirectory(), 'd1');
	if (command === 'reset') {
		rmSync(d1Folder, { recursive: true, force: true });
		console.log(`Deleted ${d1Folder}`);
	}

	// Read before the database is opened, so a mistyped option fails at once.
	const e2eInput = command === 'e2e-seed-sql' ? e2eFixtureInput(args) : null;

	const { db, close } = await openLocalDatabase();
	try {
		if (e2eInput) {
			// The local database is only used to write the SQL. Nothing is stored in it.
			console.log(e2eFixtureSql(db, e2eInput));
			return;
		}
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
		await main(command, process.argv.slice(3));
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
}
