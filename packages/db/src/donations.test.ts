// The donation record functions against a real, migrated D1 database. Nothing here reaches
// the network.
import type { CampaignStatus } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getCampaign,
	getDonationTotals,
	getFundingSummary,
	listDonations,
	recordDonation,
	recordFundingTotals,
	type NewDonation
} from './index.ts';
import { campaigns } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const GOAL = 30_000;
const PAYMENT_A = 'a'.repeat(64);
const PAYMENT_B = 'b'.repeat(64);

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	await setCampaign({ status: 'funding', fundingGoal: GOAL });
});
afterEach(() => test.destroy());

async function setCampaign(values: { status?: CampaignStatus; fundingGoal?: number | null }) {
	await test.db.update(campaigns).set(values).where(eq(campaigns.id, CAMPAIGN));
}

let next = 0;
const donation = (values: Partial<NewDonation> = {}): NewDonation => ({
	id: `don_test_${(next += 1)}`,
	campaignId: CAMPAIGN,
	amount: 5000,
	paymentDigest: null,
	receivedAt: '2026-11-15T09:00:00.000Z',
	...values
});

const campaign = async () => (await getCampaign(test.db, CAMPAIGN))!;
const status = async () => (await campaign()).status;
const summary = async () => getFundingSummary(test.db, await campaign());

describe('recordDonation', () => {
	it('writes one row: the campaign, the amount and when it reached us', async () => {
		const result = await recordDonation(
			test.db,
			donation({ id: 'don_first', paymentDigest: PAYMENT_A })
		);

		expect(result).toEqual({ recorded: true, donationId: 'don_first', becameFunded: false });
		expect(await listDonations(test.db, CAMPAIGN)).toEqual([
			{
				id: 'don_first',
				campaignId: CAMPAIGN,
				amount: 5000,
				paymentDigest: PAYMENT_A,
				receivedAt: '2026-11-15T09:00:00.000Z'
			}
		]);
	});

	it('has no column that could hold a donor, a wallet or a transaction id', async () => {
		await recordDonation(test.db, donation({ paymentDigest: PAYMENT_A }));
		const [row] = await listDonations(test.db, CAMPAIGN);

		expect(Object.keys(row!).sort()).toEqual([
			'amount',
			'campaignId',
			'id',
			'paymentDigest',
			'receivedAt'
		]);
	});

	it('counts one payment once, however often it is recorded', async () => {
		const first = await recordDonation(
			test.db,
			donation({ id: 'don_first', paymentDigest: PAYMENT_A })
		);
		const again = await recordDonation(
			test.db,
			donation({ id: 'don_again', paymentDigest: PAYMENT_A })
		);

		expect(first.recorded).toBe(true);
		expect(again).toEqual({ recorded: false, donationId: 'don_first', becameFunded: false });
		expect(await getDonationTotals(test.db, CAMPAIGN)).toMatchObject({
			raised: 5000,
			donations: 1
		});
	});

	it('counts two payments as two donations', async () => {
		await recordDonation(test.db, donation({ paymentDigest: PAYMENT_A }));
		await recordDonation(test.db, donation({ paymentDigest: PAYMENT_B, amount: 10_000 }));

		expect(await getDonationTotals(test.db, CAMPAIGN)).toMatchObject({
			raised: 15_000,
			donations: 2
		});
	});

	it('records every donation that came with no payment digest: none can be told apart', async () => {
		await recordDonation(test.db, donation());
		await recordDonation(test.db, donation());

		expect(await getDonationTotals(test.db, CAMPAIGN)).toMatchObject({
			raised: 10_000,
			donations: 2
		});
	});

	it('moves a funding campaign to funded with the donation that reaches its goal', async () => {
		const first = await recordDonation(test.db, donation({ amount: 25_000 }));
		expect(first.becameFunded).toBe(false);
		expect(await status()).toBe('funding');

		const second = await recordDonation(test.db, donation({ amount: 5000 }));
		expect(second.becameFunded).toBe(true);
		expect(await status()).toBe('funded');

		// Already funded: a later donation is counted and moves nothing.
		const third = await recordDonation(test.db, donation({ amount: 5000 }));
		expect(third).toMatchObject({ recorded: true, becameFunded: false });
		expect(await status()).toBe('funded');
	});

	it('does not move a campaign on a repeat of a payment already counted', async () => {
		await recordDonation(test.db, donation({ amount: 25_000, paymentDigest: PAYMENT_A }));
		await recordDonation(test.db, donation({ amount: 25_000, paymentDigest: PAYMENT_A }));

		expect(await status()).toBe('funding');
	});

	it('never moves a campaign that has no goal', async () => {
		await setCampaign({ fundingGoal: null });
		const result = await recordDonation(test.db, donation({ amount: 900_000 }));

		expect(result.becameFunded).toBe(false);
		expect(await status()).toBe('funding');
	});

	it.each(['draft', 'funded', 'reporting', 'overdue', 'delivered'] as const)(
		'records a donation to a %s campaign and leaves its status alone',
		async (before) => {
			await setCampaign({ status: before });
			const result = await recordDonation(test.db, donation({ amount: GOAL }));

			expect(result).toMatchObject({ recorded: true, becameFunded: false });
			expect(await status()).toBe(before);
		}
	);

	it('refuses an amount that is not a positive whole number, and writes nothing', async () => {
		for (const amount of [0, -5000, 0.5, Number.NaN]) {
			await expect(recordDonation(test.db, donation({ amount }))).rejects.toThrow();
		}
		expect(await listDonations(test.db, CAMPAIGN)).toEqual([]);
	});

	it('refuses a digest that is not a SHA-256, so a transaction id is never stored by mistake', async () => {
		await expect(
			recordDonation(test.db, donation({ paymentDigest: '5f0c7c1e-8a4b-4d2f-9c61-3b7e2a9d4f10' }))
		).rejects.toThrow();
		expect(await listDonations(test.db, CAMPAIGN)).toEqual([]);
	});

	it('refuses a donation to a campaign that does not exist', async () => {
		await expect(recordDonation(test.db, donation({ campaignId: 'cmp_nobody' }))).rejects.toThrow();
	});
});

describe('getDonationTotals', () => {
	it('is null, not zero, for a campaign with no recorded donation', async () => {
		expect(await getDonationTotals(test.db, CAMPAIGN)).toBeNull();
	});

	it('gives the sum, the count and when the newest donation reached us', async () => {
		await recordDonation(test.db, donation({ receivedAt: '2026-11-15T09:00:00.000Z' }));
		await recordDonation(
			test.db,
			donation({ amount: 25_000, receivedAt: '2026-11-15T10:30:00.000Z' })
		);

		expect(await getDonationTotals(test.db, CAMPAIGN)).toEqual({
			raised: 30_000,
			donations: 2,
			readAt: '2026-11-15T10:30:00.000Z'
		});
	});
});

describe('getFundingSummary, with recorded donations', () => {
	it('is unchanged for a campaign with none: not known, for want of a donation item', async () => {
		expect(await summary()).toEqual({
			state: 'not_known',
			reason: 'no_donation_item',
			goal: GOAL
		});
	});

	it('gives what the recorded donations add up to, though the campaign has no item of its own', async () => {
		await recordDonation(test.db, donation({ amount: 10_000 }));
		await recordDonation(test.db, donation({ amount: 5000 }));

		expect(await summary()).toEqual({
			state: 'known',
			goal: GOAL,
			raised: 15_000,
			donations: 2,
			readAt: '2026-11-15T09:00:00.000Z',
			goalMet: false
		});
	});

	it('says the goal is met once the recorded donations reach it', async () => {
		await recordDonation(test.db, donation({ amount: GOAL }));

		expect(await summary()).toMatchObject({ state: 'known', raised: GOAL, goalMet: true });
	});

	it('uses the recorded donations, not the totals of a ledger read, when a campaign has both', async () => {
		await recordFundingTotals(test.db, CAMPAIGN, {
			raised: 700,
			donations: 9,
			readAt: '2026-11-14T09:00:00.000Z'
		});
		await recordDonation(test.db, donation({ amount: 5000 }));

		expect(await summary()).toMatchObject({ state: 'known', raised: 5000, donations: 1 });
	});
});
