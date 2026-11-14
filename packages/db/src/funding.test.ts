// The funding record functions against a real, migrated D1 database. Nothing here reaches the
// network.
import type { CampaignStatus, FundingTotals } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getCampaign, getFundingSummary, recordFundingTotals } from './index.ts';
import { campaignFunding, campaigns } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const GOAL = 5000;
const DONATION_ITEM = 3154;

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test.destroy());

const totals = (raised: number, donations: number, readAt: string): FundingTotals => ({
	raised,
	donations,
	readAt
});

async function setCampaign(values: {
	status?: CampaignStatus;
	fundingGoal?: number | null;
	donationCommodityId?: number | null;
}) {
	await test.db.update(campaigns).set(values).where(eq(campaigns.id, CAMPAIGN));
}

const campaign = async () => (await getCampaign(test.db, CAMPAIGN))!;
const summary = async () => getFundingSummary(test.db, await campaign());
const stored = () => test.db.select().from(campaignFunding);

describe('getFundingSummary', () => {
	it('is not known for the seeded campaign: it has a goal but no donation item', async () => {
		expect(await summary()).toEqual({
			state: 'not_known',
			reason: 'no_donation_item',
			goal: fixtures.campaign.fundingGoal
		});
	});

	it('is not known, never zero, when the item exists but nothing has been read', async () => {
		await setCampaign({ donationCommodityId: DONATION_ITEM, fundingGoal: GOAL });

		expect(await summary()).toEqual({ state: 'not_known', reason: 'never_read', goal: GOAL });
	});

	it('invents no goal for a campaign stored without one', async () => {
		await setCampaign({ donationCommodityId: DONATION_ITEM, fundingGoal: null });
		await recordFundingTotals(test.db, CAMPAIGN, totals(9000, 2, '2026-11-14T09:00:00.000Z'));

		expect(await summary()).toEqual({
			state: 'known',
			goal: null,
			raised: 9000,
			donations: 2,
			readAt: '2026-11-14T09:00:00.000Z',
			goalMet: false
		});
	});
});

describe('recordFundingTotals', () => {
	beforeEach(async () => {
		await setCampaign({ status: 'funding', fundingGoal: GOAL, donationCommodityId: DONATION_ITEM });
	});

	it('stores the totals of a first read', async () => {
		const result = await recordFundingTotals(
			test.db,
			CAMPAIGN,
			totals(1200, 3, '2026-11-14T09:00:00.000Z')
		);

		expect(result).toEqual({ becameFunded: false });
		expect(await stored()).toEqual([
			{ campaignId: CAMPAIGN, raised: 1200, donations: 3, readAt: '2026-11-14T09:00:00.000Z' }
		]);
		expect(await summary()).toEqual({
			state: 'known',
			goal: GOAL,
			raised: 1200,
			donations: 3,
			readAt: '2026-11-14T09:00:00.000Z',
			goalMet: false
		});
		expect((await campaign()).status).toBe('funding');
	});

	it('replaces them on the next read, keeping one row per campaign', async () => {
		await recordFundingTotals(test.db, CAMPAIGN, totals(1200, 3, '2026-11-14T09:00:00.000Z'));
		await recordFundingTotals(test.db, CAMPAIGN, totals(1200, 3, '2026-11-14T09:00:00.000Z'));
		await recordFundingTotals(test.db, CAMPAIGN, totals(2000, 4, '2026-11-14T10:00:00.000Z'));

		expect(await stored()).toEqual([
			{ campaignId: CAMPAIGN, raised: 2000, donations: 4, readAt: '2026-11-14T10:00:00.000Z' }
		]);
	});

	it('moves funding to funded when the goal is reached, once', async () => {
		const first = await recordFundingTotals(
			test.db,
			CAMPAIGN,
			totals(GOAL, 5, '2026-11-14T09:00:00.000Z')
		);
		expect(first).toEqual({ becameFunded: true });
		expect((await campaign()).status).toBe('funded');
		expect(await summary()).toMatchObject({ state: 'known', goalMet: true });

		const second = await recordFundingTotals(
			test.db,
			CAMPAIGN,
			totals(GOAL + 500, 6, '2026-11-14T10:00:00.000Z')
		);
		expect(second).toEqual({ becameFunded: false });
		expect((await campaign()).status).toBe('funded');
	});

	it('changes nothing else on the campaign when it becomes funded', async () => {
		const before = await campaign();
		await recordFundingTotals(test.db, CAMPAIGN, totals(GOAL, 5, '2026-11-14T09:00:00.000Z'));

		expect(await campaign()).toEqual({ ...before, status: 'funded' });
	});

	it('never moves a status backwards when a later read is below the goal', async () => {
		await recordFundingTotals(test.db, CAMPAIGN, totals(GOAL, 5, '2026-11-14T09:00:00.000Z'));
		await recordFundingTotals(test.db, CAMPAIGN, totals(100, 1, '2026-11-14T10:00:00.000Z'));

		expect((await campaign()).status).toBe('funded');
		// The totals are what the ledger said; only the status is one-way.
		expect(await summary()).toMatchObject({ raised: 100, goalMet: false });
	});

	it('moves no status but funding, however much was raised', async () => {
		for (const status of ['draft', 'funded', 'reporting', 'overdue', 'delivered'] as const) {
			await setCampaign({ status });
			const result = await recordFundingTotals(
				test.db,
				CAMPAIGN,
				totals(GOAL * 10, 9, '2026-11-14T09:00:00.000Z')
			);

			expect(result, status).toEqual({ becameFunded: false });
			expect((await campaign()).status, status).toBe(status);
		}
	});

	it('never moves a campaign that has no goal', async () => {
		await setCampaign({ fundingGoal: null });
		const result = await recordFundingTotals(
			test.db,
			CAMPAIGN,
			totals(9_000_000, 9, '2026-11-14T09:00:00.000Z')
		);

		expect(result).toEqual({ becameFunded: false });
		expect((await campaign()).status).toBe('funding');
	});

	it('stores nothing, and moves nothing, for totals that are not whole amounts', async () => {
		await expect(
			recordFundingTotals(test.db, CAMPAIGN, totals(5000.5, 1, '2026-11-14T09:00:00.000Z'))
		).rejects.toThrow();
		await expect(
			recordFundingTotals(test.db, CAMPAIGN, totals(-1, 1, '2026-11-14T09:00:00.000Z'))
		).rejects.toThrow();

		expect(await stored()).toEqual([]);
		expect((await campaign()).status).toBe('funding');
	});

	it('refuses totals for a campaign that does not exist', async () => {
		await expect(
			recordFundingTotals(test.db, 'no-such-campaign', totals(100, 1, '2026-11-14T09:00:00.000Z'))
		).rejects.toThrow();
		expect(await stored()).toEqual([]);
	});
});

describe('a campaign stored before funding existed', () => {
	it('reads as not known, with no goal', async () => {
		// What the migration leaves on a row that was already there: both new columns empty.
		await test.db.insert(campaigns).values({
			id: 'older',
			title: 'An older campaign',
			summary: '',
			beneficiary: '',
			creatorName: 'Someone',
			creatorEmail: 'someone@older.example',
			status: 'funding',
			cadence: 'weekly',
			createdAt: '2026-01-01T00:00:00.000Z'
		});
		const older = (await getCampaign(test.db, 'older'))!;

		expect(older).toMatchObject({ fundingGoal: null, donationCommodityId: null });
		expect(await getFundingSummary(test.db, older)).toEqual({
			state: 'not_known',
			reason: 'no_donation_item',
			goal: null
		});
	});
});
