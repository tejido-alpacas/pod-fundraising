// Calls the home page's own load against a real, migrated database. Nothing here reaches
// the network.
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, milestones } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { and, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { load } from './+page.server.ts';

let test: TestDatabase;

// The day after the newest seeded entry. "Overdue" is counted from the day the page is built.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-11-14T12:00:00.000Z') });
});
afterEach(async () => {
	vi.useRealTimers();
	await test.destroy();
});

async function home() {
	const event = { locals: { ctx: { db: test.db } } };
	const data = await load(event as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('the load returned nothing');
	return data;
}

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
	logWorkCommodityId: 4242,
	milestoneHitCommodityId: 4343,
	createdAt
});

describe('the home page', () => {
	it('says there are no campaigns when the database is empty', async () => {
		test = await createTestDatabase();
		expect((await home()).campaigns).toEqual([]);
	});

	it('lists the seeded campaign with what a donor may see, and its milestone count', async () => {
		test = await createTestDatabase({ seed: true });
		const { campaigns: listed } = await home();

		expect(listed).toEqual([
			{
				id: fixtures.campaign.id,
				title: fixtures.campaign.title,
				summary: fixtures.campaign.summary,
				beneficiary: fixtures.campaign.beneficiary,
				creatorName: fixtures.campaign.creatorName,
				status: fixtures.campaign.status,
				milestones: {
					total: fixtures.milestones.length,
					confirmed: fixtures.milestones.filter((milestone) =>
						milestone.state.startsWith('confirmed')
					).length
				},
				delivery: [
					{
						id: 'm1-foundation',
						position: 1,
						title: 'Foundation and floor slab',
						status: 'confirmed',
						overdueDays: 0
					},
					{
						id: 'm2-walls',
						position: 2,
						title: 'Walls up to roof height',
						status: 'in-progress',
						overdueDays: 0
					},
					{
						id: 'm3-books-delivered',
						position: 3,
						title: 'Books delivered',
						status: 'claimed',
						overdueDays: 0
					}
				],
				path: `/campaigns/${fixtures.campaign.id}`
			}
		]);
		// The fixtures have one confirmed milestone of three; a count of zero would prove nothing.
		expect(listed[0]?.milestones).toEqual({ total: 3, confirmed: 1 });
	});

	it('counts a milestone the creator confirmed as confirmed', async () => {
		test = await createTestDatabase({ seed: true });
		const open = fixtures.milestones.find((milestone) => milestone.state === 'open');
		if (!open) throw new Error('the fixtures have no open milestone');
		await test.db
			.update(milestones)
			.set({ state: 'confirmed_creator' })
			.where(and(eq(milestones.campaignId, fixtures.campaign.id), eq(milestones.id, open.id)));

		expect((await home()).campaigns[0]?.milestones.confirmed).toBe(2);
	});

	it('marks what is late from the due date, and never a confirmed milestone', async () => {
		test = await createTestDatabase({ seed: true });
		vi.setSystemTime(new Date('2026-11-28T08:00:00.000Z'));

		const [listed] = (await home()).campaigns;
		expect(listed?.delivery.map((milestone) => milestone.overdueDays)).toEqual([0, 1, 8]);
	});

	it('leaves drafts out and lists every other status, newest first', async () => {
		test = await createTestDatabase();
		await test.db
			.insert(campaigns)
			.values([
				campaign('oldest-funding', 'funding', '2026-01-01T00:00:00.000Z'),
				campaign('a-draft', 'draft', '2026-02-01T00:00:00.000Z'),
				campaign('funded', 'funded', '2026-03-01T00:00:00.000Z'),
				campaign('reporting', 'reporting', '2026-04-01T00:00:00.000Z'),
				campaign('overdue', 'overdue', '2026-05-01T00:00:00.000Z'),
				campaign('newest-delivered', 'delivered', '2026-06-01T00:00:00.000Z')
			]);

		const { campaigns: listed } = await home();

		expect(listed.map((entry) => entry.id)).toEqual([
			'newest-delivered',
			'overdue',
			'reporting',
			'funded',
			'oldest-funding'
		]);
		expect(JSON.stringify(listed)).not.toContain('a-draft');
		// A campaign with no milestones yet is listed, with a count of none.
		expect(listed[0]?.milestones).toEqual({ total: 0, confirmed: 0 });
	});

	it('sends no email address, reporter code, wallet or commodity id', async () => {
		test = await createTestDatabase({ seed: true });
		await test.db
			.insert(campaigns)
			.values([
				campaign('second', 'funding', '2026-12-01T00:00:00.000Z'),
				campaign('hidden-draft', 'draft', '2026-12-02T00:00:00.000Z')
			]);

		const data = await home();
		const sent = JSON.stringify(data);

		expect(data.campaigns).toHaveLength(2);
		expect(sent).not.toContain('@');
		expect(sent).not.toContain(fixtures.campaign.creatorEmail);
		expect(sent).not.toContain('hidden-draft');
		for (const party of fixtures.parties) {
			expect(sent).not.toContain(party.reporterCode);
			expect(sent).not.toContain(party.email);
		}
		expect(sent).not.toMatch(/rc_|wallets\.|4242|4343/);
		for (const listed of data.campaigns) {
			expect(Object.keys(listed).sort()).toEqual(
				[
					'beneficiary',
					'creatorName',
					'delivery',
					'id',
					'milestones',
					'path',
					'status',
					'summary',
					'title'
				].sort()
			);
		}
	});
});
