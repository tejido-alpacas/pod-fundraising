// The bookkeeping that makes a deposit refund happen once only, against the real local D1.
// Nothing here sends a transfer: this package cannot.
import { agentWalletHostnameSchema, DEPOSIT_AMOUNT } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	claimDepositsForRefund,
	listConfirmedUnrefundedDepositsByEmailDomain,
	listDeposits,
	listRefunds,
	listUnrefundedDeposits,
	markRefundFailed,
	markRefundSent,
	markRefundUnknown,
	type NewRefund
} from './index.ts';
import { deposits, entries, milestones, parties, refundDeposits } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const WALLS = 'm2-walls';
const contractor = fixtures.parties[0]!;
const AT = '2026-11-14T12:00:00.000Z';

// The fixtures have two unrefunded work-log deposits on m2-walls, both the contractor's.
const WALLS_DEPOSITS = ['dep-m2-log-1', 'dep-m2-log-2'];

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test?.destroy());

function started(id: string, amount = 2 * DEPOSIT_AMOUNT.log_work): NewRefund {
	return {
		id,
		campaignId: CAMPAIGN,
		milestoneId: WALLS,
		partyId: contractor.id,
		primaryWalletHostname: contractor.primaryWalletHostname!,
		agentWalletHostname: null,
		dq: '41dq',
		amount,
		status: 'started',
		statusReason: null,
		startedAt: AT,
		settledAt: null
	};
}

const refundedAt = async (depositId: string) =>
	(await listDeposits(test.db, CAMPAIGN)).find((deposit) => deposit.id === depositId)!.refundedAt;
const claimsOf = async () => (await test.db.select().from(refundDeposits)).length;

describe('unrefunded deposits', () => {
	it('lists a milestone’s deposits that have not gone back, with their entries', async () => {
		const rows = await listUnrefundedDeposits(test.db, CAMPAIGN, WALLS);

		expect(rows.map((row) => row.deposit.id)).toEqual(WALLS_DEPOSITS);
		expect(rows.map((row) => row.entry)).toEqual([
			expect.objectContaining({ partyId: contractor.id, item: 'log_work', status: 'flagged' }),
			expect.objectContaining({ partyId: contractor.id, item: 'log_work', status: 'filed' })
		]);
		expect(rows.every((row) => row.claim === null)).toBe(true);
	});

	it('leaves out deposits already refunded, and other milestones', async () => {
		expect(await listUnrefundedDeposits(test.db, CAMPAIGN, 'm1-foundation')).toEqual([]);
		expect(await listUnrefundedDeposits(test.db, 'nope', WALLS)).toEqual([]);
	});
});

describe('claiming deposits for a refund', () => {
	it('writes the refund as started and shows the claim', async () => {
		expect(await claimDepositsForRefund(test.db, started('rfd-1'), WALLS_DEPOSITS)).toBe(true);

		expect(await listRefunds(test.db, CAMPAIGN, WALLS)).toEqual([started('rfd-1')]);
		const rows = await listUnrefundedDeposits(test.db, CAMPAIGN, WALLS);
		expect(rows.map((row) => row.claim)).toEqual([
			{ refundId: 'rfd-1', status: 'started' },
			{ refundId: 'rfd-1', status: 'started' }
		]);
		// Claimed is not refunded.
		expect(await refundedAt('dep-m2-log-1')).toBeNull();
	});

	it('refuses a second claim on any of the same deposits, and writes none of it', async () => {
		await claimDepositsForRefund(test.db, started('rfd-1'), ['dep-m2-log-1']);

		// One deposit free, one taken: the whole second claim is refused.
		expect(await claimDepositsForRefund(test.db, started('rfd-2'), WALLS_DEPOSITS)).toBe(false);

		expect((await listRefunds(test.db, CAMPAIGN, WALLS)).map((row) => row.id)).toEqual(['rfd-1']);
		expect(await claimsOf()).toBe(1);
	});

	it('lets only one of two claims made at the same moment through', async () => {
		const results = await Promise.all([
			claimDepositsForRefund(test.db, started('rfd-a'), WALLS_DEPOSITS),
			claimDepositsForRefund(test.db, started('rfd-b'), WALLS_DEPOSITS)
		]);

		expect(results.sort()).toEqual([false, true]);
		expect(await listRefunds(test.db, CAMPAIGN, WALLS)).toHaveLength(1);
		expect(await claimsOf()).toBe(2);
	});

	it('refuses an empty claim, a refund that is not started, and an unknown deposit', async () => {
		await expect(claimDepositsForRefund(test.db, started('rfd-1'), [])).rejects.toThrow();
		await expect(
			claimDepositsForRefund(test.db, { ...started('rfd-1'), status: 'sent' }, WALLS_DEPOSITS)
		).rejects.toThrow();
		await expect(claimDepositsForRefund(test.db, started('rfd-1'), ['nope'])).rejects.toThrow();
		expect(await listRefunds(test.db, CAMPAIGN, WALLS)).toEqual([]);
		expect(await claimsOf()).toBe(0);
	});

	it('claims more deposits than fit in one statement', async () => {
		const [template] = fixtures.entries.filter((entry) => entry.id === 'ent-m2-log-2');
		const ids = Array.from({ length: 95 }, (_, n) => `many-${String(n).padStart(3, '0')}`);
		for (const id of ids) {
			await test.db.batch([
				test.db.insert(entries).values({ ...template!, id: `ent-${id}`, twistId: null }),
				test.db.insert(deposits).values({
					id: `dep-${id}`,
					entryId: `ent-${id}`,
					amount: DEPOSIT_AMOUNT.log_work,
					refundedAt: null
				})
			]);
		}
		const depositIds = ids.map((id) => `dep-${id}`);

		expect(await claimDepositsForRefund(test.db, started('rfd-many'), depositIds)).toBe(true);
		expect(await claimsOf()).toBe(95);
		expect(await claimDepositsForRefund(test.db, started('rfd-again'), depositIds)).toBe(false);

		expect(await markRefundSent(test.db, 'rfd-many', AT)).toBe(true);
		expect(await refundedAt('dep-many-094')).toBe(AT);
	});
});

describe('recording what happened to the transfer', () => {
	beforeEach(async () => {
		await claimDepositsForRefund(test.db, started('rfd-1'), WALLS_DEPOSITS);
	});

	it('sent: marks the refund and its deposits together, once', async () => {
		expect(await markRefundSent(test.db, 'rfd-1', AT)).toBe(true);

		expect(await listRefunds(test.db, CAMPAIGN, WALLS)).toEqual([
			{ ...started('rfd-1'), status: 'sent', settledAt: AT }
		]);
		expect(await refundedAt('dep-m2-log-1')).toBe(AT);
		expect(await refundedAt('dep-m2-log-2')).toBe(AT);
		expect(await listUnrefundedDeposits(test.db, CAMPAIGN, WALLS)).toEqual([]);

		// Settled is settled: nothing changes it afterwards.
		const later = '2026-11-15T12:00:00.000Z';
		expect(await markRefundSent(test.db, 'rfd-1', later)).toBe(false);
		expect(await markRefundFailed(test.db, 'rfd-1', 'no', later)).toBe(false);
		expect(await markRefundUnknown(test.db, 'rfd-1', 'no')).toBe(false);
		expect(await refundedAt('dep-m2-log-1')).toBe(AT);
		expect(await claimsOf()).toBe(2);
		// And its deposits can never be claimed again.
		expect(await claimDepositsForRefund(test.db, started('rfd-2'), WALLS_DEPOSITS)).toBe(false);
	});

	it('failed: keeps the record and releases the deposits for a later refund', async () => {
		expect(await markRefundFailed(test.db, 'rfd-1', 'Qatom said 402', AT)).toBe(true);

		expect(await listRefunds(test.db, CAMPAIGN, WALLS)).toEqual([
			{ ...started('rfd-1'), status: 'failed', statusReason: 'Qatom said 402', settledAt: AT }
		]);
		expect(await refundedAt('dep-m2-log-1')).toBeNull();
		expect(await claimsOf()).toBe(0);
		expect(await claimDepositsForRefund(test.db, started('rfd-2'), WALLS_DEPOSITS)).toBe(true);
	});

	it('unknown: keeps the deposits claimed, so they are not sent again', async () => {
		expect(await markRefundUnknown(test.db, 'rfd-1', 'timed out')).toBe(true);

		expect(await listRefunds(test.db, CAMPAIGN, WALLS)).toEqual([
			{ ...started('rfd-1'), status: 'unknown', statusReason: 'timed out' }
		]);
		expect(await refundedAt('dep-m2-log-1')).toBeNull();
		const rows = await listUnrefundedDeposits(test.db, CAMPAIGN, WALLS);
		expect(rows.map((row) => row.claim?.status)).toEqual(['unknown', 'unknown']);
		expect(await claimDepositsForRefund(test.db, started('rfd-2'), WALLS_DEPOSITS)).toBe(false);
		// Not settled by code afterwards either.
		expect(await markRefundSent(test.db, 'rfd-1', AT)).toBe(false);
		expect(await markRefundFailed(test.db, 'rfd-1', 'no', AT)).toBe(false);
		expect(await claimsOf()).toBe(2);
	});

	it('does nothing for a refund that does not exist', async () => {
		expect(await markRefundSent(test.db, 'nope', AT)).toBe(false);
		expect(await markRefundFailed(test.db, 'nope', 'no', AT)).toBe(false);
		expect(await markRefundUnknown(test.db, 'nope', 'no')).toBe(false);
		expect(await claimsOf()).toBe(2);
	});
});

describe('unrefunded deposits on confirmed milestones, by the filer’s email domain', () => {
	const DOMAIN = 'e2e.m.todaq.net';
	const list = () => listConfirmedUnrefundedDepositsByEmailDomain(test.db, DOMAIN);
	const setEmail = (partyId: string, email: string) =>
		test.db.update(parties).set({ email }).where(eq(parties.id, partyId));
	const confirmWalls = () =>
		test.db
			.update(milestones)
			.set({ state: 'confirmed_creator', confirmedAt: AT })
			.where(eq(milestones.id, WALLS));

	it('lists nobody while no party is at the domain', async () => {
		await confirmWalls();
		expect(await list()).toEqual([]);
	});

	it('lists a party at the domain, whatever the letter case, with what a refund needs', async () => {
		await confirmWalls();
		await setEmail(contractor.id, 'Tejido-Contractor@E2E.M.Todaq.Net');
		const rows = await list();

		expect(rows.map((row) => row.deposit.id)).toEqual(WALLS_DEPOSITS);
		expect(rows[0]).toMatchObject({
			campaignId: CAMPAIGN,
			milestoneId: WALLS,
			party: {
				id: contractor.id,
				email: 'Tejido-Contractor@E2E.M.Todaq.Net',
				agentWalletHostname: contractor.agentWalletHostname
			},
			commodityId: fixtures.campaign.logWorkCommodityId,
			claim: null,
			attempted: false
		});
	});

	it('leaves out unconfirmed milestones, refunded deposits and every other domain', async () => {
		// m2-walls is open: nothing yet, though the contractor is at the domain.
		await setEmail(contractor.id, 'contractor@e2e.m.todaq.net');
		expect(await list()).toEqual([]);

		await confirmWalls();
		for (const email of [
			'contractor@sub.e2e.m.todaq.net',
			'contractor@e2e.m.todaq.net.example',
			'contractor@note2e.m.todaq.net',
			'e2e.m.todaq.net@example.org'
		]) {
			await setEmail(contractor.id, email);
			expect(await list(), email).toEqual([]);
		}
	});

	it('says which refund holds a deposit, and whether one was ever tried', async () => {
		await confirmWalls();
		await setEmail(contractor.id, 'contractor@e2e.m.todaq.net');
		const toAgentWallet: NewRefund = {
			id: 'rfd-agent',
			campaignId: CAMPAIGN,
			milestoneId: WALLS,
			partyId: contractor.id,
			agentWalletHostname: agentWalletHostnameSchema.parse(contractor.agentWalletHostname),
			dq: '41dq',
			amount: DEPOSIT_AMOUNT.log_work,
			status: 'started',
			statusReason: null,
			startedAt: AT,
			settledAt: null
		};
		await claimDepositsForRefund(test.db, toAgentWallet, ['dep-m2-log-1']);

		let rows = await list();
		expect(rows.map((row) => [row.deposit.id, row.claim?.refundId ?? null, row.attempted])).toEqual(
			[
				['dep-m2-log-1', 'rfd-agent', true],
				['dep-m2-log-2', null, false]
			]
		);
		// The refund names the agent wallet and no primary wallet.
		expect(await listRefunds(test.db, CAMPAIGN, WALLS)).toEqual([
			expect.objectContaining({
				agentWalletHostname: contractor.agentWalletHostname,
				primaryWalletHostname: null
			})
		]);

		// Refused: the claim is released, and the deposit still shows it was tried.
		await markRefundFailed(test.db, 'rfd-agent', 'refused', AT);
		rows = await list();
		expect(rows.map((row) => [row.deposit.id, row.claim, row.attempted])).toEqual([
			['dep-m2-log-1', null, true],
			['dep-m2-log-2', null, false]
		]);
	});
});
