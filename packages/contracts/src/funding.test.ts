import { describe, expect, it } from 'vitest';
import { campaignSchema, campaignStatusSchema } from './campaign.ts';
import { fixtures } from './fixtures.ts';
import {
	fundingPercent,
	fundingSummary,
	fundingSummarySchema,
	fundingTotalsSchema,
	isGoalMet,
	statusAfterFunding,
	type FundingTotals
} from './funding.ts';
import { AMOUNT_UNITS_PER_USD_TDN } from './money.ts';

const READ_AT = '2026-11-14T09:30:00.000Z';
const totals = (raised: number, donations = 1): FundingTotals => ({
	raised,
	donations,
	readAt: READ_AT
});

describe('a campaign', () => {
	const { campaign } = fixtures;

	it('takes a goal as a positive whole amount, or null when none is set', () => {
		const withGoal = (fundingGoal: unknown) =>
			campaignSchema.safeParse({ ...campaign, fundingGoal }).success;

		expect(withGoal(1)).toBe(true);
		expect(withGoal(12_000_000)).toBe(true);
		expect(withGoal(null)).toBe(true);
		for (const bad of [0, -1, 1.5, '1000', undefined]) {
			expect(withGoal(bad), String(bad)).toBe(false);
		}
	});

	it('takes a donation commodity id as a positive whole number or null, never a hash', () => {
		const withDonationItem = (donationCommodityId: unknown) =>
			campaignSchema.safeParse({ ...campaign, donationCommodityId }).success;

		expect(withDonationItem(3154)).toBe(true);
		expect(withDonationItem(null)).toBe(true);
		for (const bad of [0, -1, 1.5, '3154', '9f2c4e1a7b3d5f60819a2b3c4d5e6f70', undefined]) {
			expect(withDonationItem(bad), String(bad)).toBe(false);
		}
	});
});

describe('the example campaign', () => {
	it('has a goal of 12,000.00 and no donation item yet, so its funding is not known', () => {
		const { campaign } = fixtures;

		expect(campaign.fundingGoal).toBe(12_000 * AMOUNT_UNITS_PER_USD_TDN);
		expect(campaign.donationCommodityId).toBeNull();
		expect(fundingSummary(campaign, null)).toEqual({
			state: 'not_known',
			reason: 'no_donation_item',
			goal: campaign.fundingGoal
		});
	});
});

describe('isGoalMet', () => {
	it('is true once the amount raised reaches the goal, and beyond it', () => {
		expect(isGoalMet(1000, 999)).toBe(false);
		expect(isGoalMet(1000, 1000)).toBe(true);
		expect(isGoalMet(1000, 5000)).toBe(true);
	});

	it('is never true without a goal, whatever was raised', () => {
		expect(isGoalMet(null, 0)).toBe(false);
		expect(isGoalMet(null, 9_000_000)).toBe(false);
	});
});

describe('fundingPercent', () => {
	it('is a whole percentage of the goal, rounded down', () => {
		expect(fundingPercent(1000, 0)).toBe(0);
		expect(fundingPercent(1000, 250)).toBe(25);
		expect(fundingPercent(3000, 1000)).toBe(33);
		expect(fundingPercent(1000, 1000)).toBe(100);
	});

	it('does not read 100 before the goal is reached', () => {
		expect(fundingPercent(1000, 999)).toBe(99);
		expect(fundingPercent(12_000_000, 11_999_999)).toBe(99);
	});

	it('passes 100 when more than the goal was given', () => {
		expect(fundingPercent(1000, 1500)).toBe(150);
	});

	it('refuses a goal of nothing instead of dividing by it', () => {
		expect(() => fundingPercent(0, 100)).toThrow(RangeError);
	});
});

describe('fundingSummary', () => {
	it('is not known, for want of a donation item, when the campaign names none', () => {
		expect(fundingSummary({ fundingGoal: 5000, donationCommodityId: null }, null)).toEqual({
			state: 'not_known',
			reason: 'no_donation_item',
			goal: 5000
		});
	});

	it('does not show totals read for an item the campaign no longer names', () => {
		expect(fundingSummary({ fundingGoal: 5000, donationCommodityId: null }, totals(700))).toEqual({
			state: 'not_known',
			reason: 'no_donation_item',
			goal: 5000
		});
	});

	it('is not known, never zero, when the item exists but its ledger was never read', () => {
		const summary = fundingSummary({ fundingGoal: 5000, donationCommodityId: 3154 }, null);

		expect(summary).toEqual({ state: 'not_known', reason: 'never_read', goal: 5000 });
		expect(summary).not.toHaveProperty('raised');
	});

	it('gives the goal, the totals and when they were read', () => {
		expect(
			fundingSummary({ fundingGoal: 5000, donationCommodityId: 3154 }, totals(1200, 3))
		).toEqual({
			state: 'known',
			goal: 5000,
			raised: 1200,
			donations: 3,
			readAt: READ_AT,
			goalMet: false
		});
	});

	it('says the goal is met once it is', () => {
		const summary = fundingSummary({ fundingGoal: 5000, donationCommodityId: 3154 }, totals(5000));
		expect(summary).toMatchObject({ state: 'known', goalMet: true });
	});

	it('invents no goal: with none set, the totals are given and the goal is not met', () => {
		expect(
			fundingSummary({ fundingGoal: null, donationCommodityId: 3154 }, totals(9000, 2))
		).toEqual({
			state: 'known',
			goal: null,
			raised: 9000,
			donations: 2,
			readAt: READ_AT,
			goalMet: false
		});
	});

	it('gives a known zero when the ledger was read and holds no donations', () => {
		expect(
			fundingSummary({ fundingGoal: 5000, donationCommodityId: 3154 }, totals(0, 0))
		).toMatchObject({ state: 'known', raised: 0, donations: 0, goalMet: false });
	});

	it('always satisfies its own schema, and has no field that could name a donor', () => {
		const summaries = [
			fundingSummary({ fundingGoal: null, donationCommodityId: null }, null),
			fundingSummary({ fundingGoal: 5000, donationCommodityId: 3154 }, null),
			fundingSummary({ fundingGoal: 5000, donationCommodityId: 3154 }, totals(1200, 3))
		];
		for (const summary of summaries) {
			expect(fundingSummarySchema.parse(summary)).toEqual(summary);
			for (const key of Object.keys(summary)) {
				expect(['state', 'reason', 'goal', 'raised', 'donations', 'readAt', 'goalMet']).toContain(
					key
				);
			}
		}
	});

	it('drops anything else it is handed, such as a wallet address', () => {
		const withDonor = { ...totals(1200, 3), payingWallet: 'donor.wallets.tejido.example' };

		expect(fundingTotalsSchema.parse(withDonor)).toEqual(totals(1200, 3));
		expect(
			JSON.stringify(fundingSummary({ fundingGoal: 5000, donationCommodityId: 3154 }, withDonor))
		).not.toContain('donor');
	});
});

describe('statusAfterFunding', () => {
	it('moves funding to funded when the goal is met', () => {
		expect(statusAfterFunding('funding', 1000, 1000)).toBe('funded');
		expect(statusAfterFunding('funding', 1000, 2500)).toBe('funded');
	});

	it('leaves funding as it is below the goal, or without a goal', () => {
		expect(statusAfterFunding('funding', 1000, 999)).toBe('funding');
		expect(statusAfterFunding('funding', null, 9_000_000)).toBe('funding');
	});

	it('moves no other status, forwards or backwards, whatever was raised', () => {
		for (const status of campaignStatusSchema.options) {
			if (status === 'funding') continue;
			expect(statusAfterFunding(status, 1000, 5000), status).toBe(status);
			expect(statusAfterFunding(status, 1000, 0), status).toBe(status);
		}
	});
});
