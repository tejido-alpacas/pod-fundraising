// The list of tables a campaign owns must be complete and in a safe order. These tests read
// the schema itself, so a table added later that points at a campaign FAILS HERE until it is
// added to CAMPAIGN_OWNED_TABLES in test-campaigns.ts. Nothing here reaches the network.
import { is } from 'drizzle-orm';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema.ts';
import { CAMPAIGN_OWNED_TABLES, deleteCampaignAndAllOfItsOwn, E2E_CAMPAIGN_ID } from './index.ts';
import type { Database } from './client.ts';

/** Every table in the schema, and the tables each one points at with a foreign key. */
const tables = Object.values(schema).filter((value): value is SQLiteTable =>
	is(value, SQLiteTable)
);
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

		await expect(deleteCampaignAndAllOfItsOwn(untouchable, E2E_CAMPAIGN_ID)).rejects.toThrow(
			'The fixed test campaign is never deleted.'
		);
	});
});
