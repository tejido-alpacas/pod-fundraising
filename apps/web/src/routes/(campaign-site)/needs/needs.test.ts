// Calls the Give and Explore pages' own loads against a real, migrated database. Nothing here
// reaches the network.
import { campaigns } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { load as explore } from '../explore/+page.server.ts';
import { load as needs } from './+page.server.ts';

let test: TestDatabase;

afterEach(async () => {
	await test.destroy();
});

const campaign = (
	id: string,
	status: (typeof campaigns.$inferInsert)['status'],
	createdAt: string
): typeof campaigns.$inferInsert => ({
	id,
	title: `Title of ${id}`,
	summary: `Summary of ${id}`,
	beneficiary: `the people of ${id}`,
	creatorName: `Creator of ${id}`,
	creatorEmail: `creator-of-${id}@private.example`,
	status,
	cadence: 'weekly',
	logWorkCommodityId: null,
	milestoneHitCommodityId: null,
	createdAt
});

const event = () => ({ locals: { ctx: { db: test.db } } });

async function run(page: 'needs' | 'explore') {
	const data =
		page === 'needs'
			? await needs(event() as unknown as Parameters<typeof needs>[0])
			: await explore(event() as unknown as Parameters<typeof explore>[0]);
	if (!data) throw new Error('the load returned nothing');
	return data.campaigns;
}

describe('the Give and Explore pages', () => {
	it('Give lists only campaigns still raising money; Explore lists every one but drafts', async () => {
		test = await createTestDatabase();
		await test.db
			.insert(campaigns)
			.values([
				campaign('raising', 'funding', '2026-11-01T00:00:00.000Z'),
				campaign('working', 'reporting', '2026-11-02T00:00:00.000Z'),
				campaign('unfinished', 'draft', '2026-11-03T00:00:00.000Z')
			]);

		expect((await run('needs')).map((listed) => listed.id)).toEqual(['raising']);
		expect((await run('explore')).map((listed) => listed.id)).toEqual(['working', 'raising']);
	});

	it('never sends a creator email to the browser', async () => {
		test = await createTestDatabase();
		await test.db
			.insert(campaigns)
			.values([campaign('raising', 'funding', '2026-11-01T00:00:00.000Z')]);

		expect(JSON.stringify(await run('needs'))).not.toContain('@private.example');
	});
});
