// The list of tables a campaign owns must be complete and in a safe order. These tests read
// the schema itself, so a table added later that points at a campaign FAILS HERE until it is
// added to CAMPAIGN_OWNED_TABLES in test-campaigns.ts. Nothing here reaches the network.
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { fixtures } from '@tejido/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as schema from './schema.ts';
import { CAMPAIGN_OWNED_TABLES, deleteCampaignAndAllOfItsOwn, E2E_CAMPAIGN_ID } from './index.ts';
import type { Database } from './client.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

/** Every table in the schema, and the tables each one points at with a foreign key. */
const tables: SQLiteTable[] = [];
for (const value of Object.values(schema)) {
	if (is(value, SQLiteTable)) tables.push(value);
}
const nameOf = (table: SQLiteTable) => getTableConfig(table).name;
const pointsAt = new Map(
	tables.map((table) => [
		nameOf(table),
		new Set(getTableConfig(table).foreignKeys.map((key) => nameOf(key.reference().foreignTable)))
	])
);

/** Every table that reaches `campaigns` by following foreign keys, and `campaigns` itself. */
function tablesHangingOffCampaigns(): Set<string> {
	const found = new Set(['campaigns']);
	for (let grew = true; grew;) {
		grew = false;
		for (const [name, parents] of pointsAt) {
			if (found.has(name) || ![...parents].some((parent) => found.has(parent))) continue;
			found.add(name);
			grew = true;
		}
	}
	return found;
}

const listed = CAMPAIGN_OWNED_TABLES.map(({ table }) => nameOf(table));

describe('the tables deleted with a campaign', () => {
	it('the schema walk sees the tables and foreign keys it should', () => {
		// If these fail, the walk itself is broken and the tests below prove nothing.
		expect(tables.length).toBeGreaterThanOrEqual(15);
		expect(pointsAt.get('parties')).toEqual(new Set(['campaigns']));
		expect(pointsAt.get('entries')).toEqual(new Set(['milestones', 'parties']));
		expect(pointsAt.get('refund_attempts')).toEqual(new Set(['refunds', 'deposits']));
		expect(pointsAt.get('evidence_files')).toEqual(new Set(['parties']));
	});

	it('are every table that points at a campaign, directly or through another table', () => {
		// A NEW TABLE THAT HANGS OFF A CAMPAIGN FAILS HERE. Add it to CAMPAIGN_OWNED_TABLES,
		// before the tables it points at, with the rule for which rows are one campaign's.
		expect([...listed].sort()).toEqual([...tablesHangingOffCampaigns()].sort());
	});

	it('names each table once, and the campaign itself last', () => {
		expect(new Set(listed).size).toBe(listed.length);
		expect(listed.at(-1)).toBe('campaigns');
	});

	it('deletes a table before every table it points at', () => {
		for (const [at, name] of listed.entries()) {
			for (const parent of pointsAt.get(name) ?? []) {
				if (parent === name) continue;
				expect(listed.indexOf(parent), `${name} must be deleted before ${parent}`).toBeGreaterThan(
					at
				);
			}
		}
	});

	it('leaves no table in the schema out of the walk unless it has nothing to do with a campaign', () => {
		const outside = tables.map(nameOf).filter((name) => !tablesHangingOffCampaigns().has(name));
		// Today every table hangs off a campaign. A table that truly does not may be listed here.
		expect(outside).toEqual([]);
	});
});

describe('deleteCampaignAndAllOfItsOwn', () => {
	const DOMAIN = 'tests.example';
	let test: TestDatabase;

	beforeEach(async () => {
		test = await createTestDatabase({ seed: true });
	});
	afterEach(() => test?.destroy());

	/** Every row of every table, as text: two equal snapshots mean nothing at all changed. */
	async function snapshot(): Promise<string[]> {
		const all: string[] = [];
		for (const table of tables) {
			const rows = await test.db.select().from(table);
			all.push(...rows.map((row) => `${nameOf(table)} ${JSON.stringify(row)}`));
		}
		return all.sort();
	}

	/** A campaign with a creator, two people and a milestone. */
	async function make(id: string, creatorEmail: string, emails: [string, string]) {
		await test.db.insert(schema.campaigns).values({ ...fixtures.campaign, id, creatorEmail });
		for (const [index, email] of emails.entries()) {
			await test.db.insert(schema.parties).values({
				...fixtures.parties[0]!,
				id: `${id}-p${index}`,
				campaignId: id,
				email,
				reporterCode: `code-${id}-${index}`
			});
		}
		await test.db.insert(schema.milestones).values({
			...fixtures.milestones[0]!,
			campaignId: id,
			ownerPartyId: `${id}-p0`,
			confirmerPartyId: `${id}-p1`
		});
	}

	const refusal = 'Only a campaign whose creator and every person are test people is ever deleted.';

	it('refuses the fixed test campaign before it asks the database anything', async () => {
		// A database that fails the test if it is touched at all.
		const untouchable = new Proxy(
			{},
			{
				get: () => {
					throw new Error('The database was used.');
				}
			}
		) as Database;

		await expect(
			deleteCampaignAndAllOfItsOwn(untouchable, E2E_CAMPAIGN_ID, DOMAIN)
		).rejects.toThrow('The fixed test campaign is never deleted.');
	});

	it('refuses the fixed test campaign even when everybody on it is a test person', async () => {
		await make(E2E_CAMPAIGN_ID, `creator@${DOMAIN}`, [`a@${DOMAIN}`, `b@${DOMAIN}`]);
		const before = await snapshot();

		await expect(deleteCampaignAndAllOfItsOwn(test.db, E2E_CAMPAIGN_ID, DOMAIN)).rejects.toThrow(
			'The fixed test campaign is never deleted.'
		);
		expect(await snapshot()).toEqual(before);
	});

	it('refuses a real campaign handed straight to it, and leaves it whole', async () => {
		const before = await snapshot();

		await expect(
			deleteCampaignAndAllOfItsOwn(test.db, fixtures.campaign.id, DOMAIN)
		).rejects.toThrow(refusal);
		expect(await snapshot()).toEqual(before);
	});

	it('refuses a test campaign with one real person on it', async () => {
		await make('mixed', `creator@${DOMAIN}`, [`a@${DOMAIN}`, 'rosa@example.com']);
		const before = await snapshot();

		await expect(deleteCampaignAndAllOfItsOwn(test.db, 'mixed', DOMAIN)).rejects.toThrow(refusal);
		expect(await snapshot()).toEqual(before);
	});

	it('refuses a campaign whose creator is real, or only looks like a test person', async () => {
		const creators = [
			'rosa@example.com',
			`creator@not${DOMAIN}`,
			`creator@mail.${DOMAIN}`,
			`creator@${DOMAIN}.example.com`,
			`rosa@example.com@${DOMAIN}`
		];
		for (const [index, creator] of creators.entries()) {
			await make(`c${index}`, creator, [`a@${DOMAIN}`, `b@${DOMAIN}`]);
		}
		const before = await snapshot();

		for (const index of creators.keys()) {
			await expect(deleteCampaignAndAllOfItsOwn(test.db, `c${index}`, DOMAIN)).rejects.toThrow(
				refusal
			);
		}
		expect(await snapshot()).toEqual(before);
	});

	it('refuses to work with a domain that is not one', async () => {
		await make('own', `creator@${DOMAIN}`, [`a@${DOMAIN}`, `b@${DOMAIN}`]);
		for (const notADomain of ['', 'com', '%', `@${DOMAIN}`]) {
			await expect(deleteCampaignAndAllOfItsOwn(test.db, 'own', notADomain)).rejects.toThrow(
				'The test inbox domain is not a domain.'
			);
		}
	});

	it('deletes a campaign whose creator and people are all at the test domain, in any letter case', async () => {
		const before = await snapshot();
		await make('own', `Creator@${DOMAIN.toUpperCase()}`, [`a@${DOMAIN}`, `B@Tests.Example`]);

		expect(await deleteCampaignAndAllOfItsOwn(test.db, 'own', DOMAIN)).toEqual({
			deleted: true,
			evidenceRowsDeleted: 0,
			evidenceRowsHandedOver: 0
		});
		expect(await snapshot()).toEqual(before);
		expect(await deleteCampaignAndAllOfItsOwn(test.db, 'own', DOMAIN)).toEqual({
			deleted: false,
			why: 'not_found'
		});
	});
});
