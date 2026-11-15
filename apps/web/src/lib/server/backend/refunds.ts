/**
 * Deposit refunds (surface C5). Track C owns this file.
 *
 * When a milestone is confirmed, the deposits paid on its entries go back to the people who
 * paid them: one transfer per party, for that party's total, to that party's PRIMARY wallet.
 *
 * ONCE ONLY. A transfer returns no id and can never be looked up or retried, so the database
 * decides what may be sent:
 *
 *   1. Before anything is sent, the refund is written as `started` and its deposits are
 *      claimed (claimDepositsForRefund). A deposit can be claimed by one refund only, so a
 *      second request, even one running at the same moment, finds them taken and sends nothing.
 *   2. The transfer is sent, once.
 *   3. Qatom accepted it: the refund becomes `sent` and the deposits get `refundedAt`.
 *      Qatom refused it and nothing moved: the refund becomes `failed` and the deposits are
 *      released, so asking again later may refund them.
 *      Anything else (a timeout, a dropped connection, a server error): the outcome is NOT
 *      KNOWN. The refund becomes `unknown` and keeps its deposits. Nothing here ever sends
 *      them again; a person checks the wallet and settles the row.
 *
 * NOT THE END-TO-END TEST PEOPLE. A party whose email is at the test inbox domain is skipped
 * here: by the one exception in CLAUDE.md their deposits go back to their agent wallet, by
 * themselves, in test-account-refunds.ts. Everyone else is refunded here and only here.
 *
 * WHICH DEPOSITS. Only a deposit whose entry the reconciler has matched to a ledger
 * transaction (it has a `twistId`) and has not flagged. Until then we have not seen that the
 * deposit was paid, or by whom, so it is skipped and reported, and a later request picks it up.
 *
 * WHICH DIGITAL QUANTITY. A transfer must name the digital quantity (`dq`) the deposits were
 * paid in. It is read from the ledger of the campaign's catalog item at the time of the
 * refund (`commodity.dq`). It is not stored on an entry, and never guessed.
 */
import {
	formatAmount,
	type Amount,
	type Campaign,
	type EntryItem,
	type Party,
	type PrimaryWalletHostname
} from '@tejido/contracts';
import {
	claimDepositsForRefund,
	getCampaign,
	getMilestone,
	listParties,
	listUnrefundedDeposits,
	markRefundFailed,
	markRefundSent,
	markRefundUnknown,
	type Database,
	type UnrefundedDeposit
} from '@tejido/db';
import { QatomError, QatomHttpError } from '@tejido/qatom';
import { isEndToEndTestEmail, type MerchantAccount } from '@tejido/qatom/account';
import { randomUUID } from 'node:crypto';

/** Why deposits were not sent back by this request. */
export type RefundSkipReason =
	/** The reconciler has not matched the entry to a ledger transaction yet. */
	| 'entry_not_verified'
	/** The reconciler flagged the entry: its receipt does not match the filing. */
	| 'entry_flagged'
	/** An earlier request claimed these deposits and has not recorded what happened. */
	| 'refund_in_progress'
	/** An earlier transfer of these deposits got no usable answer. It may have gone through. */
	| 'refund_outcome_unknown'
	/** The party has not signed in with Qatom, so there is no primary wallet to send to. */
	| 'no_primary_wallet'
	/**
	 * The party is an end-to-end test person. Their deposits go back by themselves, to their
	 * agent wallet (test-account-refunds.ts), and never from here.
	 */
	| 'test_person'
	/** The campaign does not have the catalog item's commodity id stored. */
	| 'no_commodity_id'
	/**
	 * The ledger could not be read, so the digital quantity is not known. That includes a
	 * commodity id Qatom does not know or could not look up.
	 */
	| 'ledger_unavailable'
	/** The ledger did not report a usable digital quantity. */
	| 'no_dq'
	/** Another request claimed these deposits while this one was preparing. */
	| 'claimed_by_another_request'
	/** Qatom refused the transfer. Nothing moved. The deposits can be refunded later. */
	| 'transfer_failed'
	/** The transfer got no usable answer. It may have gone through. Not sent again. */
	| 'transfer_outcome_unknown'
	/** Qatom accepted the transfer but we could not record it. Not sent again. */
	| 'sent_not_recorded';

/** Reasons that code will never clear by itself: someone has to look. */
const NEEDS_A_PERSON: ReadonlySet<RefundSkipReason> = new Set([
	'entry_flagged',
	'refund_in_progress',
	'refund_outcome_unknown',
	'transfer_outcome_unknown',
	'sent_not_recorded'
]);

interface RefundLine {
	party_id: string;
	party_name: string;
	/** In Tejido's unit, thousandths of USD-TDN: 1200 is 1.20. */
	amount: Amount;
	/** For people, e.g. "1.20". */
	amount_display: string;
	deposit_ids: string[];
}

export interface RefundSent extends RefundLine {
	refund_id: string;
}

export interface RefundSkipped extends RefundLine {
	reason: RefundSkipReason;
	message: string;
	/** The refund row to look at, when one exists. */
	refund_id: string | null;
}

export interface RefundReport {
	campaign_id: string;
	milestone_id: string;
	sent: RefundSent[];
	skipped: RefundSkipped[];
	/** True when something was skipped that only a person can resolve. */
	needs_a_person: boolean;
	message: string;
}

export type RefundResult =
	| { ok: true; report: RefundReport }
	| {
			ok: false;
			httpStatus: 404 | 409;
			error: 'unknown_milestone' | 'milestone_not_confirmed';
			message: string;
	  };

export interface RefundMilestoneOptions {
	db: Database;
	/** Tejido's merchant account. Refunds are paid from its wallet. */
	account: Pick<MerchantAccount, 'resolveCommodityHash' | 'listCommodityTransactions' | 'transfer'>;
	campaignId: string;
	milestoneId: string;
}

const SKIP_MESSAGES: Record<RefundSkipReason, string> = {
	entry_not_verified:
		'Not sent: the entry has not been matched to its payment in the ledger yet. Run the reconciler, then ask again.',
	entry_flagged:
		'Not sent: the entry is flagged because its receipt does not match the filing. A person must decide.',
	refund_in_progress:
		'Not sent: an earlier request started refunding these deposits and has not recorded the outcome. If no request is still running, a person must check the wallet before anything is sent again.',
	refund_outcome_unknown:
		'Not sent: an earlier transfer of these deposits got no answer, so it may already have gone through. A person must check the wallet.',
	no_primary_wallet:
		'Not sent: this party has not signed in with Qatom, so there is no primary wallet to send to.',
	test_person:
		'Not sent from here: this party is an end-to-end test account. Its deposits go back by themselves, on the timer, to its agent wallet.',
	no_commodity_id:
		"Not sent: the campaign does not have this catalog item's commodity id, so its ledger cannot be read.",
	ledger_unavailable:
		'Not sent: the ledger could not be read, so the digital quantity to send is not known. Ask again later.',
	no_dq: 'Not sent: the ledger did not say which digital quantity the deposits were paid in.',
	claimed_by_another_request:
		'Not sent by this request: another request is already refunding these deposits.',
	transfer_failed: 'Not sent: Qatom refused the transfer and nothing moved. It can be asked again.',
	transfer_outcome_unknown:
		'UNKNOWN: the transfer got no answer, so it may or may not have gone through. It will not be sent again. A person must check the wallet.',
	sent_not_recorded:
		'SENT, but it could not be recorded here. It will not be sent again. A person must mark the refund as sent.'
};

/**
 * HTTP answers from Qatom that mean the transfer was refused before anything moved: the
 * request was rejected (400, 422), not authorised (401, 403), had no such recipient (404), or
 * the account's wallet could not cover it (402). Every other failure is treated as unknown.
 */
const NOTHING_MOVED_STATUSES: ReadonlySet<number> = new Set([400, 401, 402, 403, 404, 422]);

function nothingMoved(error: unknown): error is QatomHttpError {
	return error instanceof QatomHttpError && NOTHING_MOVED_STATUSES.has(error.status);
}

/** A short description of a failure. A QatomError never carries a token or a response body. */
function describeFailure(error: unknown): string {
	const text = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown failure';
	return text.slice(0, 300);
}

/**
 * What is recorded on a refund Qatom refused. A 402 gets plain words, because a person has to
 * act on it: Qatom pays a transfer from the merchant account's OWN wallet (its main account
 * wallet first), not from the wallets its items are sold from, so deposits coming in do not
 * by themselves put money where refunds are paid from.
 */
function describeRefusal(error: QatomHttpError): string {
	if (error.status !== 402) return describeFailure(error);
	return "Not enough money in Tejido's Qatom account wallet to send this refund, so Qatom refused it and nothing moved. Refunds are paid from the account's own wallet, not from the wallets the items are sold from. Add funds to the account's wallet, then ask again. (Qatom answered 402.)";
}

const DQ_HASH = /^[0-9a-zA-Z]+$/;

const total = (deposits: UnrefundedDeposit[]): Amount =>
	deposits.reduce((sum, { deposit }) => sum + deposit.amount, 0);

/** Why a deposit cannot be refunded yet, from its entry and any earlier refund. Null if it can. */
function reasonToSkip({ entry, claim }: UnrefundedDeposit): RefundSkipReason | null {
	if (claim) return claim.status === 'unknown' ? 'refund_outcome_unknown' : 'refund_in_progress';
	if (entry.status === 'flagged') return 'entry_flagged';
	if (entry.twistId === null || entry.status === 'filed') return 'entry_not_verified';
	return null;
}

type DqLookup = { dq: string } | { skip: 'no_commodity_id' | 'ledger_unavailable' | 'no_dq' };

/** Reads the digital quantity of each of the campaign's two catalog items, once per item. */
function digitalQuantities(
	account: RefundMilestoneOptions['account'],
	campaign: Campaign
): (item: EntryItem) => Promise<DqLookup> {
	const found = new Map<EntryItem, Promise<DqLookup>>();

	async function read(item: EntryItem): Promise<DqLookup> {
		const commodityId =
			item === 'log_work' ? campaign.logWorkCommodityId : campaign.milestoneHitCommodityId;
		if (commodityId === null) return { skip: 'no_commodity_id' };
		try {
			// The ledger is read by hash. The account looks it up from the id and remembers it.
			const hash = await account.resolveCommodityHash(commodityId);
			const { dq } = await account.listCommodityTransactions(hash);
			return dq !== null && DQ_HASH.test(dq) ? { dq } : { skip: 'no_dq' };
		} catch (error) {
			if (!(error instanceof QatomError)) throw error;
			console.error('Refund: the ledger could not be read:', error.name, error.message);
			return { skip: 'ledger_unavailable' };
		}
	}

	return (item) => {
		let lookup = found.get(item);
		if (!lookup) {
			lookup = read(item);
			found.set(item, lookup);
		}
		return lookup;
	};
}

/**
 * Refunds the deposits paid on one confirmed milestone. Safe to call again: deposits already
 * refunded, or already claimed by an earlier attempt, are never sent a second time.
 *
 * Sends at most one transfer per party and digital quantity, one after another.
 */
export async function refundMilestone(options: RefundMilestoneOptions): Promise<RefundResult> {
	const { db, account, campaignId, milestoneId } = options;

	const [campaign, milestone] = await Promise.all([
		getCampaign(db, campaignId),
		getMilestone(db, campaignId, milestoneId)
	]);
	if (!campaign || !milestone) {
		return {
			ok: false,
			httpStatus: 404,
			error: 'unknown_milestone',
			message: `Refused: ${milestoneId} is not a milestone of campaign ${campaignId}.`
		};
	}
	if (milestone.state !== 'confirmed_independent' && milestone.state !== 'confirmed_creator') {
		return {
			ok: false,
			httpStatus: 409,
			error: 'milestone_not_confirmed',
			message: `Refused: milestone ${milestoneId} is ${milestone.state}. Deposits go back only once it is confirmed.`
		};
	}

	const parties = new Map((await listParties(db, campaignId)).map((party) => [party.id, party]));
	const sent: RefundSent[] = [];
	const skipped: RefundSkipped[] = [];

	const line = (party: Party | undefined, partyId: string, deposits: UnrefundedDeposit[]) => {
		const amount = total(deposits);
		return {
			party_id: partyId,
			party_name: party?.name ?? partyId,
			amount,
			amount_display: formatAmount(amount),
			deposit_ids: deposits.map(({ deposit }) => deposit.id)
		} satisfies RefundLine;
	};
	const skip = (
		partyId: string,
		deposits: UnrefundedDeposit[],
		reason: RefundSkipReason,
		refundId: string | null = null
	) => {
		skipped.push({
			...line(parties.get(partyId), partyId, deposits),
			reason,
			message: SKIP_MESSAGES[reason],
			refund_id: refundId
		});
	};

	// 1. Sort every unrefunded deposit: ready to send, or skipped with a reason. Deposits are
	//    grouped by the party who filed the entry, and by reason, so each line is one story.
	const ready = new Map<string, UnrefundedDeposit[]>();
	const notReady = new Map<
		string,
		{
			partyId: string;
			reason: RefundSkipReason;
			refundId: string | null;
			deposits: UnrefundedDeposit[];
		}
	>();
	for (const row of await listUnrefundedDeposits(db, campaignId, milestoneId)) {
		const partyId = row.entry.partyId;
		const reason = reasonToSkip(row);
		if (reason === null) {
			ready.set(partyId, [...(ready.get(partyId) ?? []), row]);
			continue;
		}
		const refundId = row.claim?.refundId ?? null;
		const key = `${partyId}\n${reason}\n${refundId ?? ''}`;
		const group = notReady.get(key) ?? { partyId, reason, refundId, deposits: [] };
		group.deposits.push(row);
		notReady.set(key, group);
	}
	for (const group of notReady.values()) {
		skip(group.partyId, group.deposits, group.reason, group.refundId);
	}

	// 2. One party at a time.
	const dqOf = digitalQuantities(account, campaign);
	for (const [partyId, deposits] of ready) {
		const party = parties.get(partyId);

		// The one exception to the primary-wallet rule is not made here. An end-to-end test
		// person is refunded by the timer's own pass (test-account-refunds.ts), to the agent
		// wallet; sending from here as well would pay the same person by two roads.
		if (party && isEndToEndTestEmail(party.email)) {
			skip(partyId, deposits, 'test_person');
			continue;
		}

		// Refunds go to the PRIMARY wallet only. With none linked there is nowhere to send:
		// the agent wallet is never used instead.
		const primaryWalletHostname: PrimaryWalletHostname | null =
			party?.primaryWalletHostname ?? null;
		if (!party || primaryWalletHostname === null) {
			skip(partyId, deposits, 'no_primary_wallet');
			continue;
		}

		// The two catalog items are separate commodities. Send each deposit in the digital
		// quantity its own item's ledger reports; normally both are the same one.
		const byDq = new Map<string, UnrefundedDeposit[]>();
		const withoutDq = new Map<RefundSkipReason, UnrefundedDeposit[]>();
		for (const row of deposits) {
			const lookup = await dqOf(row.entry.item);
			if ('skip' in lookup) {
				withoutDq.set(lookup.skip, [...(withoutDq.get(lookup.skip) ?? []), row]);
			} else {
				byDq.set(lookup.dq, [...(byDq.get(lookup.dq) ?? []), row]);
			}
		}
		for (const [reason, rows] of withoutDq) skip(partyId, rows, reason);

		for (const [dq, rows] of byDq) {
			const refundId = `rfd_${randomUUID()}`;
			const amount = total(rows);
			const depositIds = rows.map(({ deposit }) => deposit.id);

			// STARTED, before the transfer. If another request holds any of these deposits,
			// nothing was written and nothing is sent.
			const claimed = await claimDepositsForRefund(
				db,
				{
					id: refundId,
					campaignId,
					milestoneId,
					partyId,
					primaryWalletHostname,
					dq,
					amount,
					status: 'started',
					statusReason: null,
					startedAt: new Date().toISOString(),
					settledAt: null
				},
				depositIds
			);
			if (!claimed) {
				skip(partyId, rows, 'claimed_by_another_request');
				continue;
			}

			// The transfer, exactly once. It is never retried here.
			try {
				await account.transfer({
					to: { primaryWalletHostname },
					dq,
					amount,
					note: `Tejido deposit refund: ${milestone.title}`
				});
			} catch (error) {
				if (nothingMoved(error)) {
					console.error('Refund refused by Qatom:', refundId, error.name, error.message);
					await markRefundFailed(db, refundId, describeRefusal(error), new Date().toISOString());
					skip(partyId, rows, 'transfer_failed', refundId);
				} else {
					// A timeout, a dropped connection, a server error or anything unexpected:
					// the money may have moved. The refund keeps its deposits.
					console.error('Refund outcome unknown:', refundId, describeFailure(error));
					await markRefundUnknown(db, refundId, describeFailure(error));
					skip(partyId, rows, 'transfer_outcome_unknown', refundId);
				}
				continue;
			}

			// REFUNDED. If this write fails the refund stays `started`, which still stops the
			// deposits from ever being sent again.
			try {
				await markRefundSent(db, refundId, new Date().toISOString());
			} catch (error) {
				console.error('Refund sent but not recorded:', refundId, describeFailure(error));
				skip(partyId, rows, 'sent_not_recorded', refundId);
				continue;
			}
			sent.push({ ...line(party, partyId, rows), refund_id: refundId });
		}
	}

	const needsAPerson = skipped.some(({ reason }) => NEEDS_A_PERSON.has(reason));
	return {
		ok: true,
		report: {
			campaign_id: campaignId,
			milestone_id: milestoneId,
			sent,
			skipped,
			needs_a_person: needsAPerson,
			message: describeReport(sent, skipped, needsAPerson)
		}
	};
}

function describeReport(
	sent: RefundSent[],
	skipped: RefundSkipped[],
	needsAPerson: boolean
): string {
	const sentTotal = formatAmount(sent.reduce((sum, { amount }) => sum + amount, 0));
	const parts = [
		sent.length === 0
			? 'Nothing was sent.'
			: `Sent ${sentTotal} back in ${sent.length} transfer${sent.length === 1 ? '' : 's'}.`
	];
	if (skipped.length > 0) {
		parts.push(`${skipped.length} group${skipped.length === 1 ? '' : 's'} of deposits not sent.`);
	} else if (sent.length === 0) {
		parts.push('There are no deposits left to refund on this milestone.');
	}
	if (needsAPerson) parts.push('A person needs to look at the skipped ones.');
	return parts.join(' ');
}
