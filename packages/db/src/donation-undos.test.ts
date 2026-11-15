// The donation-undo bookkeeping against a real, migrated D1 database. Nothing here reaches
// the network, and nothing here sends anything.
import { fixtures } from '@tejido/contracts/fixtures';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	claimDonationUndo,
	getDonationTotals,
	getDonationUndo,
	listDonations,
	listDonationsOfAmountBetween,
	listDonationsToUndoByCreatorEmailDomain,
	listPartiesByWalletHostname,
	listUndoneTwistIds,
	markDonationUndoFailed,
	markDonationUndoSent,
	markDonationUndoUnknown,
	recordDonation
} from './index.ts';
import { campaigns } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const AT = '2026-11-15T09:00:00.000Z';
const LATER = '2026-11-15T09:01:00.000Z';

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	for (const id of ['don_a', 'don_b']) {
		await recordDonation(test.db, {
			id,
			campaignId: CAMPAIGN,
			amount: 1000,
			paymentDigest: null,
			receivedAt: AT
		});
	}
});
afterEach(() => test.destroy());

const claim = (donationId: string, twistId: string) =>
	claimDonationUndo(test.db, { donationId, twistId, amount: 1000, startedAt: AT });

describe('claimDonationUndo', () => {
	it('writes the undo as started, and only once for a donation or for a payment', async () => {
		expect(await claim('don_a', 'twist-1')).toBe(true);
		expect(await claim('don_a', 'twist-2')).toBe(false);
		expect(await claim('don_b', 'twist-1')).toBe(false);

		expect(await getDonationUndo(test.db, 'don_a')).toEqual({
			donationId: 'don_a',
			twistId: 'twist-1',
			amount: 1000,
			status: 'started',
			statusReason: null,
			startedAt: AT,
			settledAt: null
		});
		expect(await getDonationUndo(test.db, 'don_b')).toBeNull();
		expect(await listUndoneTwistIds(test.db, ['twist-1', 'twist-2'])).toEqual(new Set(['twist-1']));
	});

	it('gives one of two claims made at the same moment', async () => {
		const answers = await Promise.all([claim('don_a', 'twist-1'), claim('don_a', 'twist-1')]);
		expect(answers.sort()).toEqual([false, true]);
	});

	it('refuses a donation that does not exist, and an amount that is not positive', async () => {
		await expect(claim('don_missing', 'twist-9')).rejects.toThrow();
		await expect(
			claimDonationUndo(test.db, { donationId: 'don_a', twistId: 't', amount: 0, startedAt: AT })
		).rejects.toThrow(RangeError);
	});
});

describe('what counts in a campaign’s total', () => {
	it('every donation until an undo is recorded as sent; then that one does not', async () => {
		const both = { raised: 2000, donations: 2, readAt: AT };
		expect(await getDonationTotals(test.db, CAMPAIGN)).toEqual(both);

		await claim('don_a', 'twist-1');
		expect(await getDonationTotals(test.db, CAMPAIGN)).toEqual(both);

		expect(await markDonationUndoSent(test.db, 'don_a', LATER)).toBe(true);
		expect(await getDonationTotals(test.db, CAMPAIGN)).toEqual({
			raised: 1000,
			donations: 1,
			readAt: AT
		});
		// The row is kept.
		expect((await listDonations(test.db, CAMPAIGN)).map(({ id }) => id)).toEqual([
			'don_a',
			'don_b'
		]);
	});

	it('a failed or unknown undo leaves the donation counted, and is never rewritten', async () => {
		await claim('don_a', 'twist-1');
		await claim('don_b', 'twist-2');
		expect(await markDonationUndoFailed(test.db, 'don_a', 'refused', LATER)).toBe(true);
		expect(await markDonationUndoUnknown(test.db, 'don_b', 'no answer')).toBe(true);

		expect(await markDonationUndoSent(test.db, 'don_a', LATER)).toBe(false);
		expect(await markDonationUndoSent(test.db, 'don_b', LATER)).toBe(false);
		expect((await getDonationUndo(test.db, 'don_a'))!.status).toBe('failed');
		expect((await getDonationUndo(test.db, 'don_b'))!.status).toBe('unknown');
		expect((await getDonationTotals(test.db, CAMPAIGN))!.donations).toBe(2);
	});

	it('an undone donation does not help a later one reach the goal', async () => {
		await test.db
			.update(campaigns)
			.set({ status: 'funding', fundingGoal: 3000 })
			.where(eq(campaigns.id, CAMPAIGN));
		await claim('don_a', 'twist-1');
		await markDonationUndoSent(test.db, 'don_a', LATER);

		const third = await recordDonation(test.db, {
			id: 'don_c',
			campaignId: CAMPAIGN,
			amount: 1000,
			paymentDigest: null,
			receivedAt: LATER
		});
		expect(third.becameFunded).toBe(false);
	});
});

describe('the lists a pass reads', () => {
	it('donations by the creator’s domain: the end of the address, any letter case, not sent', async () => {
		expect(await listDonationsToUndoByCreatorEmailDomain(test.db, 'e2e.m.todaq.net', AT)).toEqual(
			[]
		);

		await test.db
			.update(campaigns)
			.set({ creatorEmail: 'E2E-Creator@E2E.M.Todaq.NET' })
			.where(eq(campaigns.id, CAMPAIGN));
		await claim('don_a', 'twist-1');
		const rows = await listDonationsToUndoByCreatorEmailDomain(test.db, 'e2e.m.todaq.net', AT);
		expect(rows.map((row) => [row.donationId, row.undoStatus])).toEqual([
			['don_a', 'started'],
			['don_b', null]
		]);

		await markDonationUndoSent(test.db, 'don_a', LATER);
		expect(
			(await listDonationsToUndoByCreatorEmailDomain(test.db, 'e2e.m.todaq.net', AT)).map(
				(row) => row.donationId
			)
		).toEqual(['don_b']);
		// Older than the time asked for: not listed.
		expect(
			await listDonationsToUndoByCreatorEmailDomain(test.db, 'e2e.m.todaq.net', LATER)
		).toEqual([]);
		// `_` is not a wildcard.
		expect(await listDonationsToUndoByCreatorEmailDomain(test.db, 'e2e_m.todaq.net', AT)).toEqual(
			[]
		);
	});

	it('donations of one amount between two times, on any campaign', async () => {
		await claim('don_a', 'twist-1');
		expect(await listDonationsOfAmountBetween(test.db, 1000, AT, AT)).toEqual([
			{ donationId: 'don_a', receivedAt: AT, hasUndo: true },
			{ donationId: 'don_b', receivedAt: AT, hasUndo: false }
		]);
		expect(await listDonationsOfAmountBetween(test.db, 5000, AT, AT)).toEqual([]);
		expect(await listDonationsOfAmountBetween(test.db, 1000, LATER, LATER)).toEqual([]);
	});

	it('every party a wallet is registered to, as primary or as agent', async () => {
		const party = fixtures.parties[0]!;
		expect(await listPartiesByWalletHostname(test.db, party.primaryWalletHostname!)).toEqual([
			{ email: party.email, primaryWalletHostname: party.primaryWalletHostname }
		]);
		expect(await listPartiesByWalletHostname(test.db, party.agentWalletHostname!)).toEqual([
			{ email: party.email, agentWalletHostname: party.agentWalletHostname }
		]);
		expect(await listPartiesByWalletHostname(test.db, 'nobody.biz.todaq.net')).toEqual([]);
	});
});
