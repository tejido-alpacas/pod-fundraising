/**
 * Refunds for the END-TO-END TEST PEOPLE ONLY, sent by themselves on the timer. Track C owns
 * this file.
 *
 * THE ONE EXCEPTION (CLAUDE.md, "Qatom"; the owner's decision of 15 November 2026). The paid
 * end-to-end tests pay deposits from each test person's AGENT wallet. So that those wallets
 * stay funded with nobody topping them up, a test person's deposits on a confirmed milestone
 * go back to that same agent wallet, paid out of the twin the item is sold from. Everyone
 * else is refunded by refunds.ts, to their PRIMARY wallet, and only when a person asks.
 *
 * WHO. A party whose email is at the test inbox domain: `isEndToEndTestEmail` in
 * @tejido/qatom is the one place that decides. It is asked here about every deposit, and
 * again inside the Qatom call. The database only shortens the list.
 *
 * ONE TRANSFER is one party's deposits on one milestone for one catalog item: the two items
 * are sold from two different twins, and a twin can only pay back what was paid into it.
 * WHICH ITEM: the one the campaign stores an id for, and otherwise the shared item
 * (SHARED_ITEM_COMMODITY_ID in reconciler.ts), exactly as the reconciler reads it. Campaigns
 * made with the builder, which is what the paid tests file on, store none.
 * Its amount is the sum of exactly the deposits it claims, and each deposit must be the
 * item's fixed price.
 *
 * ONCE ONLY, with the same bookkeeping as refunds.ts: the refund is written as `started` and
 * its deposits claimed BEFORE the transfer; then it becomes `sent`, `failed` (the twin
 * refused, nothing moved) or `unknown` (no answer; the money may have moved). And one thing
 * stricter, because this runs every minute with nobody watching: a deposit that any refund
 * has ever covered is NEVER tried again here, whatever came of that refund. A person looks.
 *
 * A LIMIT PER PASS. The transfers one pass asks for may add up to at most PASS_LIMIT. Past
 * it, deposits wait for the next pass.
 *
 * The twin's hostname and key never reach this file: @tejido/qatom reads them, uses them for
 * the one transfer and drops them. Nothing here stores or logs a wallet address.
 */
import { DEPOSIT_AMOUNT, formatAmount, type Amount, type EntryItem } from '@tejido/contracts';
import {
	claimDepositsForRefund,
	listConfirmedUnrefundedDepositsByEmailDomain,
	markRefundFailed,
	markRefundSent,
	markRefundUnknown,
	type ConfirmedUnrefundedDeposit,
	type Database
} from '@tejido/db';
import { QatomError } from '@tejido/qatom';
import {
	E2E_TEST_EMAIL_DOMAIN,
	isEndToEndTestEmail,
	type ItemTwinRefundRefusal,
	type MerchantAccount
} from '@tejido/qatom/account';
import { randomUUID } from 'node:crypto';
import { SHARED_ITEM_COMMODITY_ID } from './reconciler.ts';

/**
 * The most one pass may ask twins to send, in Tejido's unit: 10.00.
 *
 * One run of the paid tests files 2.10 of deposits (a work log 0.10, a claim 1.00, its
 * confirmation 1.00), so this lets a pass catch up on four runs at once and no more. A fault
 * here could at worst move 10.00 in a minute, out of twins that hold deposits.
 */
export const PASS_LIMIT: Amount = 10_000;

export type TestRefundSkipReason =
	/** The reconciler has not matched the entry to a ledger transaction yet. */
	| 'entry_not_verified'
	/** The reconciler flagged the entry: it was not paid from the party's own agent wallet. */
	| 'entry_flagged'
	/** An earlier pass claimed these deposits and has not recorded what happened. */
	| 'refund_in_progress'
	/** An earlier transfer of these deposits got no answer. It may have gone through. */
	| 'refund_outcome_unknown'
	/** A refund of these deposits was tried before and did not go through. Not tried again. */
	| 'refund_tried_before'
	/** A deposit is not the fixed price of its item. Nothing about it is trusted. */
	| 'unexpected_deposit_amount'
	/** The party has no agent wallet registered: they have not signed in with Qatom. */
	| 'no_agent_wallet'
	/** This one transfer alone would be more than a whole pass may send. Never sent here. */
	| 'transfer_over_limit'
	/** This pass has already asked for as much as one pass may. Waits for the next pass. */
	| 'pass_limit_reached'
	/** Qatom, or the twin's balance, could not be read. Nothing was sent. Tried next pass. */
	| 'qatom_unavailable'
	/** Another request claimed these deposits while this one was preparing. */
	| 'claimed_by_another_request'
	/** The twin answered the transfer with a status that is not OK. Nothing moved. */
	| 'transfer_refused'
	/** The transfer got no answer. It may have gone through. Never sent again. */
	| 'transfer_outcome_unknown'
	/** The twin accepted the transfer but we could not record it. Never sent again. */
	| 'sent_not_recorded'
	/** A check inside the Qatom call stopped it before anything was sent. */
	| Exclude<ItemTwinRefundRefusal, 'stopped_by_caller'>;

/** Reasons that no later pass will clear by itself: someone has to look. */
const NEEDS_A_PERSON: ReadonlySet<TestRefundSkipReason> = new Set([
	'entry_flagged',
	'refund_in_progress',
	'refund_outcome_unknown',
	'refund_tried_before',
	'unexpected_deposit_amount',
	'transfer_over_limit',
	'transfer_refused',
	'transfer_outcome_unknown',
	'sent_not_recorded',
	'not_a_test_person',
	'recipient_not_a_wallet',
	'item_twin_not_a_wallet',
	'recipient_is_the_item_twin'
]);

interface TestRefundLine {
	campaign_id: string;
	milestone_id: string;
	party_id: string;
	item: EntryItem;
	/** In Tejido's unit, thousandths of USD-TDN: 1000 is 1.00. */
	amount: Amount;
	amount_display: string;
	deposit_ids: string[];
}

export interface TestRefundSent extends TestRefundLine {
	refund_id: string;
}

export interface TestRefundSkipped extends TestRefundLine {
	reason: TestRefundSkipReason;
	/** The refund row to look at, when one exists. */
	refund_id: string | null;
}

export interface TestRefundReport {
	sent: TestRefundSent[];
	skipped: TestRefundSkipped[];
	/** What the twins were asked to send in this pass, whatever came of it. */
	asked_total: Amount;
	/** True when something was skipped that only a person can resolve. */
	needs_a_person: boolean;
	message: string;
}

export interface RefundTestAccountsOptions {
	db: Database;
	/** Tejido's merchant account. Never a person's token. */
	account: Pick<MerchantAccount, 'resolveCommodityHash' | 'refundTestPersonFromItemTwin'>;
}

const total = (deposits: ConfirmedUnrefundedDeposit[]): Amount =>
	deposits.reduce((sum, { deposit }) => sum + deposit.amount, 0);

/** Why a deposit cannot be refunded by this pass, from what is recorded. Null if it can. */
function reasonToSkip(row: ConfirmedUnrefundedDeposit): TestRefundSkipReason | null {
	if (row.claim) {
		return row.claim.status === 'unknown' ? 'refund_outcome_unknown' : 'refund_in_progress';
	}
	if (row.attempted) return 'refund_tried_before';
	if (row.entry.status === 'flagged') return 'entry_flagged';
	if (row.entry.twistId === null || row.entry.status === 'filed') return 'entry_not_verified';
	if (row.deposit.amount !== DEPOSIT_AMOUNT[row.entry.item]) return 'unexpected_deposit_amount';
	if (row.party.agentWalletHostname === null) return 'no_agent_wallet';
	return null;
}

/** A short description of a failure. A QatomError never carries a token, key or address. */
function describeFailure(error: unknown): string {
	if (error instanceof QatomError) return `${error.name}: ${error.message}`.slice(0, 300);
	// Anything else is not ours to quote.
	return error instanceof Error ? error.name : 'Unknown failure';
}

/**
 * One pass: sends every end-to-end test person's refundable deposits on confirmed milestones
 * back to their agent wallet. Safe to run again: a deposit is never sent twice.
 *
 * Transfers go one after another, never side by side.
 */
export async function refundTestAccounts(
	options: RefundTestAccountsOptions
): Promise<TestRefundReport> {
	const { db, account } = options;

	// WHO. The database shortens the list by the same domain; this line decides.
	const rows = (
		await listConfirmedUnrefundedDepositsByEmailDomain(db, E2E_TEST_EMAIL_DOMAIN)
	).filter((row) => isEndToEndTestEmail(row.party.email));

	const sent: TestRefundSent[] = [];
	const skipped: TestRefundSkipped[] = [];
	const line = (rows: ConfirmedUnrefundedDeposit[]): TestRefundLine => {
		const first = rows[0]!;
		const amount = total(rows);
		return {
			campaign_id: first.campaignId,
			milestone_id: first.milestoneId,
			party_id: first.party.id,
			item: first.entry.item,
			amount,
			amount_display: formatAmount(amount),
			deposit_ids: rows.map(({ deposit }) => deposit.id)
		};
	};
	const skip = (
		rows: ConfirmedUnrefundedDeposit[],
		reason: TestRefundSkipReason,
		refundId: string | null = null
	) => {
		skipped.push({ ...line(rows), reason, refund_id: refundId });
	};

	// 1. Sort every deposit: ready, or skipped with a reason. One group is one party's deposits
	//    on one milestone for one item (and, when skipped, for one reason).
	const ready = new Map<string, ConfirmedUnrefundedDeposit[]>();
	const notReady = new Map<
		string,
		{ reason: TestRefundSkipReason; refundId: string | null; rows: ConfirmedUnrefundedDeposit[] }
	>();
	for (const row of rows) {
		const group = [row.campaignId, row.milestoneId, row.party.id, row.entry.item].join('\n');
		const reason = reasonToSkip(row);
		if (reason === null) {
			ready.set(group, [...(ready.get(group) ?? []), row]);
			continue;
		}
		const refundId = row.claim?.refundId ?? null;
		const key = `${group}\n${reason}\n${refundId ?? ''}`;
		const found = notReady.get(key) ?? { reason, refundId, rows: [] };
		found.rows.push(row);
		notReady.set(key, found);
	}
	for (const group of notReady.values()) skip(group.rows, group.reason, group.refundId);

	// 2. One transfer at a time, oldest deposits first, up to the limit.
	let askedTotal: Amount = 0;
	for (const group of ready.values()) {
		const first = group[0]!;
		const { party, campaignId, milestoneId } = first;
		// The item's own id if the campaign stores one, otherwise the shared item: the same
		// choice, from the same constant, as the reconciler made when it matched the payment.
		// So the refund is paid out of the twin whose ledger that payment was found in.
		const commodityId = first.commodityId ?? SHARED_ITEM_COMMODITY_ID[first.entry.item];
		const agentWalletHostname = party.agentWalletHostname;
		// reasonToSkip already refused this; the types do not know it.
		if (agentWalletHostname === null) continue;

		// The amount is the sum of exactly the deposits this refund will claim.
		const amount = total(group);
		const depositIds = group.map(({ deposit }) => deposit.id);
		if (askedTotal + amount > PASS_LIMIT) {
			skip(group, amount > PASS_LIMIT ? 'transfer_over_limit' : 'pass_limit_reached');
			continue;
		}

		const refundId = `rfd_${randomUUID()}`;
		let claimed = false;
		let result;
		try {
			// The ledger is read by hash. The account looks it up from the id and remembers it.
			const commodityHash = await account.resolveCommodityHash(commodityId);
			result = await account.refundTestPersonFromItemTwin({
				commodityHash,
				party: { email: party.email, agentWalletHostname },
				amount,
				// STARTED, before the transfer. If another request holds any of these deposits,
				// nothing was written and nothing is sent.
				beforeSending: async (dq) => {
					claimed = await claimDepositsForRefund(
						db,
						{
							id: refundId,
							campaignId,
							milestoneId,
							partyId: party.id,
							agentWalletHostname,
							dq,
							amount,
							status: 'started',
							statusReason: null,
							startedAt: new Date().toISOString(),
							settledAt: null
						},
						depositIds
					);
					if (claimed) askedTotal += amount;
					return claimed;
				}
			});
		} catch (error) {
			if (claimed) {
				// Not expected: the Qatom call reports what became of a transfer, it does not
				// throw. If it ever does after the claim, the money may have moved.
				console.error('Test refund outcome unknown:', refundId, describeFailure(error));
				await markRefundUnknown(db, refundId, describeFailure(error));
				skip(group, 'transfer_outcome_unknown', refundId);
				continue;
			}
			if (!(error instanceof QatomError)) throw error;
			// Before the transfer: nothing was sent and nothing was written.
			console.error('Test refund: Qatom could not be read:', describeFailure(error));
			skip(group, 'qatom_unavailable');
			continue;
		}

		if (result.outcome === 'not_sent') {
			skip(
				group,
				result.reason === 'stopped_by_caller' ? 'claimed_by_another_request' : result.reason
			);
			continue;
		}
		if (result.outcome === 'refused') {
			const reason = `The item's twin refused the transfer and nothing moved. (It answered ${result.status}.) Not tried again by the timer.`;
			console.error('Test refund refused by the twin:', refundId, result.status);
			await markRefundFailed(db, refundId, reason, new Date().toISOString());
			skip(group, 'transfer_refused', refundId);
			continue;
		}
		if (result.outcome === 'unknown') {
			const reason = `The transfer from the item's twin got no answer (${result.failure}). It may have gone through. Never sent again.`;
			console.error('Test refund outcome unknown:', refundId, result.failure);
			await markRefundUnknown(db, refundId, reason);
			skip(group, 'transfer_outcome_unknown', refundId);
			continue;
		}

		// REFUNDED. If this write fails the refund stays `started`, which still stops the
		// deposits from ever being sent again.
		try {
			await markRefundSent(db, refundId, new Date().toISOString());
		} catch (error) {
			console.error('Test refund sent but not recorded:', refundId, describeFailure(error));
			skip(group, 'sent_not_recorded', refundId);
			continue;
		}
		sent.push({ ...line(group), refund_id: refundId });
	}

	const needsAPerson = skipped.some(({ reason }) => NEEDS_A_PERSON.has(reason));
	const sentTotal = formatAmount(sent.reduce((sum, { amount }) => sum + amount, 0));
	const parts = [
		sent.length === 0
			? 'Nothing was sent.'
			: `Sent ${sentTotal} back to test people's agent wallets in ${sent.length} transfer${sent.length === 1 ? '' : 's'}.`
	];
	if (skipped.length > 0) {
		parts.push(`${skipped.length} group${skipped.length === 1 ? '' : 's'} of deposits not sent.`);
	}
	if (needsAPerson) parts.push('A person needs to look at some of the skipped ones.');

	return {
		sent,
		skipped,
		asked_total: askedTotal,
		needs_a_person: needsAPerson,
		message: parts.join(' ')
	};
}
