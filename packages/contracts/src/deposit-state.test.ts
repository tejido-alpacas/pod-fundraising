// Every branch of the deposit state: held, refunded, and each reason a refund is outstanding.
import { describe, expect, it } from 'vitest';
import {
	DEPOSIT_STATE_LABEL,
	REFUND_OUTSTANDING_MEANING,
	depositStateSchema,
	depositStatusSchema,
	deriveDepositState,
	describeDeposit,
	refundOutstandingReasonSchema,
	totalDeposits,
	type DepositStateInput,
	type MilestoneState,
	type RefundStatus
} from './index.ts';

const AT = '2026-11-14T12:00:00.000Z';
const LATER = '2026-11-14T13:00:00.000Z';

/** A verified entry on a confirmed milestone, filer signed in, no refund begun. */
function input(change: Partial<DepositStateInput> = {}): DepositStateInput {
	return {
		deposit: { refundedAt: null },
		milestone: { state: 'confirmed_independent' },
		entry: { status: 'verified', twistId: 'twist-1' },
		filerHasPrimaryWallet: true,
		refunds: [],
		...change
	};
}
const refund = (status: RefundStatus, startedAt = AT) => ({ status, startedAt });
const outstanding = (outstandingReason: string) => ({
	state: 'refund_outstanding',
	outstandingReason
});

describe('the three deposit states', () => {
	it('are exactly held, refunded and refund outstanding, with their labels', () => {
		expect(depositStateSchema.options).toEqual(['held', 'refunded', 'refund_outstanding']);
		expect(DEPOSIT_STATE_LABEL).toEqual({
			held: 'Deposit held',
			refunded: 'Deposit refunded',
			refund_outstanding: 'Refund outstanding'
		});
	});

	it('never say "refunded" without "deposit", and never call a deposit a donation or payment', () => {
		const words = [
			...Object.values(DEPOSIT_STATE_LABEL),
			...Object.values(REFUND_OUTSTANDING_MEANING)
		];
		for (const text of words) {
			if (/refunded/i.test(text)) expect(text).toMatch(/deposit/i);
			expect(text).not.toMatch(/donation|payment for|fee/i);
		}
	});

	it('explain every reason a refund can be outstanding', () => {
		expect(Object.keys(REFUND_OUTSTANDING_MEANING).sort()).toEqual(
			[...refundOutstandingReasonSchema.options].sort()
		);
	});
});

describe('held', () => {
	it.each<MilestoneState>(['open', 'claimed'])(
		'a deposit on a milestone that is %s is held',
		(state) => {
			expect(deriveDepositState(input({ milestone: { state } }))).toEqual({
				state: 'held',
				outstandingReason: null
			});
		}
	);

	it('is held before confirmation whatever the entry looks like', () => {
		for (const entry of [
			{ status: 'flagged', twistId: 'twist-1' },
			{ status: 'incomplete', twistId: null },
			{ status: 'filed', twistId: null }
		] as const) {
			const derived = deriveDepositState(
				input({ milestone: { state: 'claimed' }, entry, filerHasPrimaryWallet: false })
			);
			expect(derived.state).toBe('held');
		}
	});

	it('is still held after a refund of it was refused, while the milestone is unconfirmed', () => {
		expect(
			deriveDepositState(input({ milestone: { state: 'claimed' }, refunds: [refund('failed')] }))
				.state
		).toBe('held');
	});
});

describe('refunded', () => {
	it('is refunded exactly when the deposit carries its refund time', () => {
		expect(
			deriveDepositState(input({ deposit: { refundedAt: AT }, refunds: [refund('sent')] }))
		).toEqual({ state: 'refunded', outstandingReason: null });
	});

	it('trusts the refund time over everything else recorded', () => {
		expect(
			deriveDepositState(
				input({
					deposit: { refundedAt: AT },
					milestone: { state: 'claimed' },
					entry: { status: 'flagged', twistId: null },
					filerHasPrimaryWallet: false,
					refunds: [refund('failed'), refund('unknown')]
				})
			).state
		).toBe('refunded');
	});
});

describe('refund outstanding', () => {
	it.each<MilestoneState>(['confirmed_independent', 'confirmed_creator'])(
		'a confirmed milestone (%s) with no refund begun: not attempted',
		(state) => {
			expect(deriveDepositState(input({ milestone: { state } }))).toEqual(
				outstanding('not_attempted')
			);
		}
	);

	it('a transfer that timed out: outcome unknown, never called refunded', () => {
		expect(deriveDepositState(input({ refunds: [refund('unknown')] }))).toEqual(
			outstanding('outcome_unknown')
		);
	});

	it('a refund that was started and has no recorded outcome: in progress', () => {
		expect(deriveDepositState(input({ refunds: [refund('started')] }))).toEqual(
			outstanding('in_progress')
		);
	});

	it('a refund Qatom refused: refused, however many times', () => {
		expect(deriveDepositState(input({ refunds: [refund('failed')] }))).toEqual(
			outstanding('refused')
		);
		expect(
			deriveDepositState(input({ refunds: [refund('failed'), refund('failed', LATER)] }))
		).toEqual(outstanding('refused'));
	});

	it('a refused refund followed by one whose outcome is unknown: outcome unknown', () => {
		expect(
			deriveDepositState(input({ refunds: [refund('failed'), refund('unknown', LATER)] }))
		).toEqual(outstanding('outcome_unknown'));
		expect(
			deriveDepositState(input({ refunds: [refund('started', LATER), refund('failed')] }))
		).toEqual(outstanding('in_progress'));
	});

	it('a refund in flight counts even if the milestone is not recorded as confirmed', () => {
		expect(
			deriveDepositState(input({ milestone: { state: 'claimed' }, refunds: [refund('unknown')] }))
		).toEqual(outstanding('outcome_unknown'));
		expect(
			deriveDepositState(input({ milestone: { state: 'open' }, refunds: [refund('started')] }))
		).toEqual(outstanding('in_progress'));
	});

	it('a refund marked sent on a deposit with no refund time is not called refunded', () => {
		expect(deriveDepositState(input({ refunds: [refund('sent')] }))).toEqual(
			outstanding('outcome_unknown')
		);
	});

	it('a flagged entry: held back for a person, whatever else is true', () => {
		expect(
			deriveDepositState(
				input({
					entry: { status: 'flagged', twistId: 'twist-1' },
					filerHasPrimaryWallet: false,
					refunds: [refund('failed')]
				})
			)
		).toEqual(outstanding('entry_flagged'));
	});

	it('an entry not yet matched to the ledger: not verified', () => {
		for (const entry of [
			{ status: 'filed', twistId: null },
			{ status: 'incomplete', twistId: null },
			// Cannot happen today, but `filed` means unmatched even with a transaction on record.
			{ status: 'filed', twistId: 'twist-1' }
		] as const) {
			expect(deriveDepositState(input({ entry }))).toEqual(outstanding('entry_not_verified'));
		}
	});

	it('an incomplete entry that has been matched to the ledger is refundable like a verified one', () => {
		expect(
			deriveDepositState(input({ entry: { status: 'incomplete', twistId: 'twist-1' } }))
		).toEqual(outstanding('not_attempted'));
	});

	it('a filer with no primary wallet: nowhere to send it', () => {
		expect(deriveDepositState(input({ filerHasPrimaryWallet: false }))).toEqual(
			outstanding('no_primary_wallet')
		);
		// The missing wallet is the standing reason, even after a refusal.
		expect(
			deriveDepositState(input({ filerHasPrimaryWallet: false, refunds: [refund('failed')] }))
		).toEqual(outstanding('no_primary_wallet'));
	});
});

describe('a deposit with its state', () => {
	const deposit = { id: 'dep-1', entryId: 'ent-1', amount: 100, refundedAt: null };
	const where = { campaignId: 'library-wing', milestoneId: 'm2-walls', partyId: 'party-1' };

	it('carries the label, the number of attempts and the latest one', () => {
		const status = describeDeposit(deposit, where, {
			...input(),
			refunds: [refund('unknown', LATER), refund('failed', AT)]
		});

		expect(depositStatusSchema.parse(status)).toEqual(status);
		expect(status).toEqual({
			deposit,
			...where,
			state: 'refund_outstanding',
			outstandingReason: 'outcome_unknown',
			label: 'Refund outstanding',
			refundAttempts: 2,
			lastRefundAttempt: { status: 'unknown', startedAt: LATER }
		});
	});

	it('has no latest attempt when no refund was ever begun', () => {
		const status = describeDeposit(deposit, where, input({ milestone: { state: 'open' } }));
		expect(status).toMatchObject({
			state: 'held',
			label: 'Deposit held',
			outstandingReason: null,
			refundAttempts: 0,
			lastRefundAttempt: null
		});
	});
});

describe('deposit totals', () => {
	it('adds amounts by state, and the three add up to what was paid', () => {
		const totals = totalDeposits([
			{ deposit: { amount: 1000 }, state: 'refunded' },
			{ deposit: { amount: 100 }, state: 'held' },
			{ deposit: { amount: 100 }, state: 'refund_outstanding' },
			{ deposit: { amount: 1000 }, state: 'refund_outstanding' }
		]);
		expect(totals).toEqual({ paid: 2200, held: 100, refunded: 1000, outstanding: 1100 });
		expect(totals.held + totals.refunded + totals.outstanding).toBe(totals.paid);
	});

	it('is all zeroes for no deposits', () => {
		expect(totalDeposits([])).toEqual({ paid: 0, held: 0, refunded: 0, outstanding: 0 });
	});
});
