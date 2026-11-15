// The state of every deposit, read from the real local D1. Nothing here sends a transfer:
// this package cannot. The pure rules are tested in @tejido/contracts (deposit-state.test.ts).
import { DEPOSIT_AMOUNT } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	claimDepositsForRefund,
	listDepositStatuses,
	markRefundFailed,
	markRefundSent,
	markRefundUnknown,
	type NewRefund
} from './index.ts';
import { entries, milestones, parties, refundAttempts, refundDeposits } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const WALLS = 'm2-walls';
const contractor = fixtures.parties[0]!;
const AT = '2026-11-14T12:00:00.000Z';
const LATER = '2026-11-14T13:00:00.000Z';
const LOG = DEPOSIT_AMOUNT.log_work;
const HIT = DEPOSIT_AMOUNT.milestone_hit;

// On m2-walls the fixtures have two work-log deposits, both the contractor's:
// dep-m2-log-1 on a flagged entry and dep-m2-log-2 on a filed, unmatched one.
const FLAGGED = 'dep-m2-log-1';
const FILED = 'dep-m2-log-2';

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test?.destroy());

function started(id: string, startedAt = AT): NewRefund {
	return {
		id,
		campaignId: CAMPAIGN,
		milestoneId: WALLS,
		partyId: contractor.id,
		primaryWalletHostname: contractor.primaryWalletHostname!,
		agentWalletHostname: null,
		dq: '41dq',
		amount: LOG,
		status: 'started',
		statusReason: null,
		startedAt,
		settledAt: null
	};
}

const confirmWalls = () =>
	test.db
		.update(milestones)
		.set({ state: 'confirmed_independent', confirmedAt: AT })
		.where(eq(milestones.id, WALLS));

/** Makes the filed entry on the walls a verified one: matched to the ledger. */
const verifyFiled = () =>
	test.db
		.update(entries)
		.set({ status: 'verified', twistId: 'twist-m2-log-2' })
		.where(eq(entries.id, 'ent-m2-log-2'));

async function stateOf(depositId: string) {
	const { deposits } = await listDepositStatuses(test.db, CAMPAIGN);
	const found = deposits.find(({ deposit }) => deposit.id === depositId)!;
	return {
		state: found.state,
		reason: found.outstandingReason,
		attempts: found.refundAttempts,
		last: found.lastRefundAttempt
	};
}

describe('deposit states for a campaign', () => {
	it('gives every deposit its state and label, oldest entry first', async () => {
		const { deposits, totals } = await listDepositStatuses(test.db, CAMPAIGN);

		expect(deposits.map(({ deposit, state, label }) => [deposit.id, state, label])).toEqual([
			['dep-m1-claim', 'refunded', 'Deposit refunded'],
			['dep-m1-confirm', 'refunded', 'Deposit refunded'],
			[FLAGGED, 'held', 'Deposit held'],
			['dep-m3-delivery', 'held', 'Deposit held'],
			[FILED, 'held', 'Deposit held']
		]);
		expect(deposits[2]).toEqual({
			deposit: { id: FLAGGED, entryId: 'ent-m2-log-1', amount: LOG, refundedAt: null },
			campaignId: CAMPAIGN,
			milestoneId: WALLS,
			partyId: contractor.id,
			state: 'held',
			label: 'Deposit held',
			outstandingReason: null,
			refundAttempts: 0,
			lastRefundAttempt: null
		});
		expect(totals).toEqual({
			paid: 2 * HIT + HIT + 2 * LOG,
			held: HIT + 2 * LOG,
			refunded: 2 * HIT,
			outstanding: 0
		});
	});

	it('narrows to one milestone or one entry, with totals for just those', async () => {
		const walls = await listDepositStatuses(test.db, CAMPAIGN, { milestoneId: WALLS });
		expect(walls.deposits.map(({ deposit }) => deposit.id)).toEqual([FLAGGED, FILED]);
		expect(walls.totals).toEqual({ paid: 2 * LOG, held: 2 * LOG, refunded: 0, outstanding: 0 });

		const one = await listDepositStatuses(test.db, CAMPAIGN, { entryId: 'ent-m1-claim' });
		expect(one.deposits.map(({ deposit }) => deposit.id)).toEqual(['dep-m1-claim']);
		expect(one.totals).toEqual({ paid: HIT, held: 0, refunded: HIT, outstanding: 0 });
	});

	it('answers nothing for another campaign, or an entry that is not this campaign’s', async () => {
		const empty = { deposits: [], totals: { paid: 0, held: 0, refunded: 0, outstanding: 0 } };
		expect(await listDepositStatuses(test.db, 'nope')).toEqual(empty);
		expect(await listDepositStatuses(test.db, 'nope', { entryId: 'ent-m1-claim' })).toEqual(empty);
		expect(await listDepositStatuses(test.db, CAMPAIGN, { milestoneId: 'nope' })).toEqual(empty);
	});
});

describe('once the milestone is confirmed', () => {
	beforeEach(async () => {
		await confirmWalls();
	});

	it('nothing is held any more, and nothing is called refunded', async () => {
		expect(await stateOf(FLAGGED)).toMatchObject({
			state: 'refund_outstanding',
			reason: 'entry_flagged'
		});
		expect(await stateOf(FILED)).toMatchObject({
			state: 'refund_outstanding',
			reason: 'entry_not_verified'
		});
		const { totals } = await listDepositStatuses(test.db, CAMPAIGN, { milestoneId: WALLS });
		expect(totals).toEqual({ paid: 2 * LOG, held: 0, refunded: 0, outstanding: 2 * LOG });
	});

	it('a verified entry with no refund begun: not attempted', async () => {
		await verifyFiled();
		expect(await stateOf(FILED)).toEqual({
			state: 'refund_outstanding',
			reason: 'not_attempted',
			attempts: 0,
			last: null
		});
	});

	it('a filer with no primary wallet: nowhere to send it', async () => {
		await verifyFiled();
		await test.db
			.update(parties)
			.set({ primaryWalletHostname: null })
			.where(eq(parties.id, contractor.id));
		expect(await stateOf(FILED)).toMatchObject({
			state: 'refund_outstanding',
			reason: 'no_primary_wallet'
		});
	});

	it('follows one refund from started, to sent: outstanding until it is recorded as sent', async () => {
		await verifyFiled();
		await claimDepositsForRefund(test.db, started('rfd-1'), [FILED]);
		expect(await stateOf(FILED)).toEqual({
			state: 'refund_outstanding',
			reason: 'in_progress',
			attempts: 1,
			last: { status: 'started', startedAt: AT }
		});

		await markRefundSent(test.db, 'rfd-1', LATER);
		expect(await stateOf(FILED)).toEqual({
			state: 'refunded',
			reason: null,
			attempts: 1,
			last: { status: 'sent', startedAt: AT }
		});
		const { deposits, totals } = await listDepositStatuses(test.db, CAMPAIGN, {
			entryId: 'ent-m2-log-2'
		});
		expect(deposits[0]?.deposit.refundedAt).toBe(LATER);
		expect(totals).toEqual({ paid: LOG, held: 0, refunded: LOG, outstanding: 0 });
	});

	it('a transfer that timed out stays outstanding with its outcome unknown', async () => {
		await verifyFiled();
		await claimDepositsForRefund(test.db, started('rfd-1'), [FILED]);
		await markRefundUnknown(test.db, 'rfd-1', 'timed out');

		expect(await stateOf(FILED)).toEqual({
			state: 'refund_outstanding',
			reason: 'outcome_unknown',
			attempts: 1,
			last: { status: 'unknown', startedAt: AT }
		});
		// The other deposit on the milestone was not part of that refund.
		expect(await stateOf(FLAGGED)).toMatchObject({ reason: 'entry_flagged', attempts: 0 });
	});

	it('remembers a refused refund after its claim is released, and counts each attempt', async () => {
		await verifyFiled();
		await claimDepositsForRefund(test.db, started('rfd-1'), [FILED]);
		await markRefundFailed(test.db, 'rfd-1', 'Qatom said 402', AT);

		// The claim is gone, so the deposit may be refunded later. The history is not.
		expect(await test.db.select().from(refundDeposits)).toEqual([]);
		expect(await test.db.select().from(refundAttempts)).toEqual([
			{ refundId: 'rfd-1', depositId: FILED }
		]);
		expect(await stateOf(FILED)).toEqual({
			state: 'refund_outstanding',
			reason: 'refused',
			attempts: 1,
			last: { status: 'failed', startedAt: AT }
		});

		await claimDepositsForRefund(test.db, started('rfd-2', LATER), [FILED]);
		expect(await stateOf(FILED)).toEqual({
			state: 'refund_outstanding',
			reason: 'in_progress',
			attempts: 2,
			last: { status: 'started', startedAt: LATER }
		});

		await markRefundSent(test.db, 'rfd-2', LATER);
		expect(await stateOf(FILED)).toMatchObject({ state: 'refunded', attempts: 2 });
	});

	it('a claim that was refused because the deposits were taken leaves no history', async () => {
		await claimDepositsForRefund(test.db, started('rfd-1'), [FILED]);
		expect(await claimDepositsForRefund(test.db, started('rfd-2'), [FLAGGED, FILED])).toBe(false);

		expect(await test.db.select().from(refundAttempts)).toEqual([
			{ refundId: 'rfd-1', depositId: FILED }
		]);
		expect(await stateOf(FLAGGED)).toMatchObject({ attempts: 0 });
	});

	it('still sees a refund holding a deposit when it was claimed before attempts were kept', async () => {
		// A refund from before the refund_attempts table existed: a claim with no history row.
		await verifyFiled();
		await claimDepositsForRefund(test.db, started('rfd-old'), [FILED]);
		await markRefundUnknown(test.db, 'rfd-old', 'timed out');
		await test.db.delete(refundAttempts);

		expect(await stateOf(FILED)).toEqual({
			state: 'refund_outstanding',
			reason: 'outcome_unknown',
			attempts: 1,
			last: { status: 'unknown', startedAt: AT }
		});
	});
});
