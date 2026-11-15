/**
 * The reconciler (surface C4): proves each saved entry was paid for, and by whom.
 *
 * The check-in endpoint saves an entry the moment Qatom calls it, with no transaction, no
 * paying wallet and no stamp time. This module reads the ledgers of the catalog items the
 * campaigns name through Tejido's merchant account, finds the transaction that paid for each
 * such entry, and records it. Paid from the agent wallet registered for the entry's party:
 * `verified`. Paid from any other wallet: `flagged`, with a reason donors can read.
 *
 * CAMPAIGNS SHARE THEIR ITEMS
 *
 * Every campaign names the same two catalog items (the owner's decision, 15 November), so one
 * ledger holds the payments of every campaign. Each ledger is therefore read once in a pass,
 * and the waiting entries of every campaign that names it are matched together. Judging one
 * campaign at a time would let a transaction that paid for another campaign's entry look like
 * the only one that fits, and put it on the wrong entry.
 *
 * HOW AN ENTRY FINDS ITS TRANSACTION
 *
 * Qatom tells our endpoint nothing about the payment, so there is no id to match on. A
 * transaction can be an entry's only if all of these hold:
 *
 *   - it is in the ledger of the item the entry was filed with, as the entry's campaign names it;
 *   - no entry has it already;
 *   - its amount is the entry's deposit;
 *   - its time is in the window around the moment we saved the entry (the payment comes
 *     first, then Qatom calls us): MATCH_WINDOW_BEFORE_MS before to MATCH_WINDOW_AFTER_MS after.
 *
 * Then, per ledger, over the entries of every campaign that names it:
 *
 *   1. Registered wallet first. Among the transactions paid from the party's registered agent
 *      wallet, an entry is matched when exactly one could be its, and that one could be no
 *      other entry's.
 *   2. Any other wallet. An entry with no transaction from its registered wallet is matched
 *      to a transaction from elsewhere under the same exactly-one-each-way rule, and flagged.
 *      Transactions that step 1 looked at are not offered here.
 *
 * Whenever it is not exactly one each way (say, two work logs by the same party a minute
 * apart, on one campaign or on two), nothing is recorded: the entries are counted as `ambiguous` and left as they are.
 * A wrong receipt on a donor's proof page is worse than a missing one.
 *
 * An entry whose party has not linked a wallet yet is left waiting, not flagged: there is no
 * registered wallet to compare with until they sign in.
 *
 * An `incomplete` entry paid from the registered wallet gets its transaction recorded but
 * stays `incomplete`, with its reason: it is still missing something. So a stamped incomplete
 * entry was always paid from the right wallet. Paid from another wallet, it becomes `flagged`.
 *
 * A stamped entry is never looked at again, so a second pass changes nothing.
 */
import {
	DEPOSIT_AMOUNT,
	timestampSchema,
	type Amount,
	type Campaign,
	type EntryItem
} from '@tejido/contracts';
import {
	listCampaigns,
	listUnreconciledEntries,
	listUsedTwistIds,
	stampEntries,
	type Database,
	type EntryStamp,
	type UnreconciledEntry
} from '@tejido/db';
import { QatomError, sameTwin } from '@tejido/qatom';
import type { LedgerTransaction, MerchantAccount } from '@tejido/qatom/account';

/**
 * How long before we saved an entry its payment may have been recorded. The payment happens
 * first and Qatom calls our endpoint straight after; in the fixtures the gap is nine seconds.
 * NOT MEASURED ON STAGING. Five minutes allows for a slow call without reaching back to the
 * same party's previous filing.
 */
export const MATCH_WINDOW_BEFORE_MS = 5 * 60_000;
/** Allowance for the ledger's clock running ahead of ours. */
export const MATCH_WINDOW_AFTER_MS = 60_000;

const STATUS_REASON_MAX = 500;

/**
 * The ledger's `amount` in our units (see money.ts in @tejido/contracts).
 *
 * THE ONE PLACE that knows the ledger's unit. Qatom's document does not state it. We assume
 * it is the same smallest unit as prices and transfers, so a 0.10 work log reads 100. If
 * staging shows otherwise (README, "Still to confirm on staging"), convert here and nowhere else.
 */
function ledgerAmountInUnits(transaction: LedgerTransaction): Amount {
	return transaction.amount;
}

/**
 * Whether a transaction was paid from this agent wallet.
 *
 * THE ONE PLACE that compares a ledger address with a registered wallet. `sameTwin` accepts
 * a bare hostname or a twin URL, because the document does not say which the ledger uses.
 */
function paidFrom(transaction: LedgerTransaction, agentWalletHostname: string): boolean {
	return sameTwin(transaction.payingAddress, agentWalletHostname);
}

export interface ReconcileSummary {
	/** Campaigns with at least one catalog item to read. */
	campaigns: number;
	/** Campaigns skipped because neither commodity id is stored on them yet. */
	campaignsWithoutItems: number;
	/** Ledgers read. A ledger several campaigns share is read, and counted, once. */
	ledgersRead: number;
	/**
	 * Ledgers Qatom did not give us, including a commodity id Qatom does not know or could not
	 * look up: one line for each ledger, with the campaigns that have entries waiting on it and
	 * the item they name it for. Those entries stay as they were and count as unmatched.
	 */
	ledgerErrors: {
		commodityId: number;
		items: EntryItem[];
		campaignIds: string[];
		problem: string;
	}[];
	/** Entries given a transaction in this pass: verified + flagged + stampedIncomplete. */
	matched: number;
	verified: number;
	flagged: number;
	/** Paid from the registered wallet, but the entry is still missing something. */
	stampedIncomplete: number;
	/** Entries still without a transaction after this pass, including the two counts below. */
	unmatched: number;
	/** Unmatched because more than one pairing was possible. */
	ambiguous: number;
	/** Unmatched because the party has not linked a wallet yet. */
	waitingForWallet: number;
	/** Ledger rows we could not use: a field missing, or a time that is not a time. */
	unreadableTransactions: number;
}

interface Candidate {
	transaction: LedgerTransaction;
	atMs: number;
	stampedAt: string;
}

const ITEM_COMMODITY_ID = {
	log_work: 'logWorkCommodityId',
	milestone_hit: 'milestoneHitCommodityId'
} as const satisfies Record<EntryItem, keyof Campaign>;

const ITEMS = Object.keys(DEPOSIT_AMOUNT) as EntryItem[];

function fit(text: string): string {
	return text.length <= STATUS_REASON_MAX ? text : `${text.slice(0, STATUS_REASON_MAX - 1)}…`;
}

function couldBe(waiting: UnreconciledEntry, candidate: Candidate): boolean {
	const filedAtMs = Date.parse(waiting.entry.filedAt);
	return (
		ledgerAmountInUnits(candidate.transaction) === waiting.depositAmount &&
		candidate.atMs >= filedAtMs - MATCH_WINDOW_BEFORE_MS &&
		candidate.atMs <= filedAtMs + MATCH_WINDOW_AFTER_MS
	);
}

/**
 * Pairs entries with transactions where the pairing is certain: the entry has exactly one
 * possible transaction, and that transaction has exactly one possible entry.
 */
function pairCertain(
	possible: Map<UnreconciledEntry, Candidate[]>
): Map<UnreconciledEntry, Candidate> {
	const claims = new Map<Candidate, number>();
	for (const candidates of possible.values()) {
		for (const candidate of candidates) claims.set(candidate, (claims.get(candidate) ?? 0) + 1);
	}
	const pairs = new Map<UnreconciledEntry, Candidate>();
	for (const [waiting, candidates] of possible) {
		const [only, ...others] = candidates;
		if (only && others.length === 0 && claims.get(only) === 1) pairs.set(waiting, only);
	}
	return pairs;
}

/**
 * Decides, for one ledger, which entries get which transaction. `waiting` holds the entries of
 * every campaign that names the ledger's item. Reads and writes nothing.
 */
function matchLedger(
	waiting: UnreconciledEntry[],
	candidates: Candidate[],
	now: string
): { stamps: EntryStamp[]; ambiguous: number; waitingForWallet: number } {
	const stamps: EntryStamp[] = [];
	const stamp = (
		{ entry }: UnreconciledEntry,
		candidate: Candidate,
		status: EntryStamp['status'],
		statusReason: string | null
	) =>
		stamps.push({
			entryId: entry.id,
			twistId: candidate.transaction.twistId,
			payingWallet: candidate.transaction.payingAddress,
			stampedAt: candidate.stampedAt,
			status,
			statusReason,
			updatedAt: now
		});

	// 1. Transactions paid from each party's registered agent wallet.
	const fromOwnWallet = new Map<UnreconciledEntry, Candidate[]>();
	const looked = new Set<Candidate>();
	for (const row of waiting) {
		const wallet = row.party.agentWalletHostname;
		if (wallet === null) continue;
		const own = candidates.filter(
			(candidate) => couldBe(row, candidate) && paidFrom(candidate.transaction, wallet)
		);
		fromOwnWallet.set(row, own);
		for (const candidate of own) looked.add(candidate);
	}
	const ownPairs = pairCertain(fromOwnWallet);
	for (const [row, candidate] of ownPairs) {
		if (row.entry.status === 'incomplete') {
			stamp(row, candidate, 'incomplete', row.entry.statusReason);
		} else {
			stamp(row, candidate, 'verified', null);
		}
	}

	// 2. For entries with nothing from their own wallet: transactions from anywhere else.
	//    An entry whose party has no wallet yet takes part, so a transaction that may be its
	//    is not handed to someone else, but it is never stamped here.
	const fromElsewhere = new Map<UnreconciledEntry, Candidate[]>();
	for (const row of waiting) {
		if ((fromOwnWallet.get(row)?.length ?? 0) > 0) continue;
		fromElsewhere.set(
			row,
			candidates.filter((candidate) => !looked.has(candidate) && couldBe(row, candidate))
		);
	}
	const otherPairs = pairCertain(fromElsewhere);
	let waitingForWallet = 0;
	for (const row of fromElsewhere.keys()) {
		if (row.party.agentWalletHostname === null) {
			waitingForWallet += 1;
			otherPairs.delete(row);
		}
	}
	for (const [row, candidate] of otherPairs) {
		const reason = `The deposit was paid from a wallet that is not the one registered for ${row.party.name}.`;
		const earlier = row.entry.status === 'incomplete' ? row.entry.statusReason : null;
		stamp(row, candidate, 'flagged', fit(earlier ? `${reason} ${earlier}` : reason));
	}

	let ambiguous = 0;
	for (const row of waiting) {
		if (ownPairs.has(row) || otherPairs.has(row) || row.party.agentWalletHostname === null) {
			continue;
		}
		const had = (fromOwnWallet.get(row)?.length ?? 0) + (fromElsewhere.get(row)?.length ?? 0);
		if (had > 0) ambiguous += 1;
	}
	return { stamps, ambiguous, waitingForWallet };
}

/** One commodity's ledger, and everything waiting on it across every campaign that names it. */
interface SharedLedger {
	commodityId: number;
	/** Which campaigns name this commodity, and for which item. Kept for the error report. */
	namedBy: { campaignId: string; item: EntryItem }[];
	waiting: UnreconciledEntry[];
}

/**
 * Runs one reconciliation pass over every campaign.
 *
 * Reads ledgers only through the merchant account. A ledger Qatom does not give us is noted in
 * the summary and the pass carries on with the others; a database failure throws.
 */
export async function reconcile(
	db: Database,
	account: Pick<MerchantAccount, 'resolveCommodityHash' | 'listCommodityTransactions'>,
	now: string = new Date().toISOString()
): Promise<ReconcileSummary> {
	const summary: ReconcileSummary = {
		campaigns: 0,
		campaignsWithoutItems: 0,
		ledgersRead: 0,
		ledgerErrors: [],
		matched: 0,
		verified: 0,
		flagged: 0,
		stampedIncomplete: 0,
		unmatched: 0,
		ambiguous: 0,
		waitingForWallet: 0,
		unreadableTransactions: 0
	};

	// First, gather. Campaigns that name the same commodity share one ledger, so their waiting
	// entries are put side by side before anything is read or matched.
	const ledgers = new Map<number, SharedLedger>();
	for (const campaign of await listCampaigns(db)) {
		if (ITEMS.every((item) => campaign[ITEM_COMMODITY_ID[item]] === null)) {
			summary.campaignsWithoutItems += 1;
			continue;
		}
		summary.campaigns += 1;
		const waiting = await listUnreconciledEntries(db, campaign.id);
		summary.unmatched += waiting.length;

		for (const item of ITEMS) {
			const commodityId = campaign[ITEM_COMMODITY_ID[item]];
			const waitingForItem = waiting.filter((row) => row.entry.item === item);
			// Nothing to prove, or no ledger to read yet: this campaign asks for no ledger.
			if (commodityId === null || waitingForItem.length === 0) continue;

			let ledger = ledgers.get(commodityId);
			if (!ledger) {
				ledger = { commodityId, namedBy: [], waiting: [] };
				ledgers.set(commodityId, ledger);
			}
			ledger.namedBy.push({ campaignId: campaign.id, item });
			ledger.waiting.push(...waitingForItem);
		}
	}

	// Then, each ledger once, with every entry that could have been paid into it.
	for (const { commodityId, namedBy, waiting } of ledgers.values()) {
		let transactions: LedgerTransaction[];
		try {
			// The ledger is read by hash. The account looks it up from the id and remembers it.
			const commodityHash = await account.resolveCommodityHash(commodityId);
			const ledger = await account.listCommodityTransactions(commodityHash);
			transactions = ledger.transactions;
			summary.ledgersRead += 1;
			summary.unreadableTransactions += ledger.incompleteTransactions;
		} catch (error) {
			// A QatomError carries no token, secret or response body.
			if (!(error instanceof QatomError)) throw error;
			summary.ledgerErrors.push({
				commodityId,
				items: ITEMS.filter((item) => namedBy.some((named) => named.item === item)),
				campaignIds: [...new Set(namedBy.map((named) => named.campaignId))],
				problem: error.message
			});
			continue;
		}

		const used = await listUsedTwistIds(
			db,
			transactions.map((transaction) => transaction.twistId)
		);
		const candidates: Candidate[] = [];
		for (const transaction of transactions) {
			if (used.has(transaction.twistId)) continue;
			// Listed twice by the ledger: still one transaction.
			used.add(transaction.twistId);
			const atMs = Date.parse(transaction.timestamp);
			const stampedAt = Number.isNaN(atMs) ? null : new Date(atMs).toISOString();
			if (stampedAt === null || !timestampSchema.safeParse(stampedAt).success) {
				summary.unreadableTransactions += 1;
				continue;
			}
			candidates.push({ transaction, atMs, stampedAt });
		}

		const { stamps, ambiguous, waitingForWallet } = matchLedger(waiting, candidates, now);
		const stamped = new Set(await stampEntries(db, stamps));
		for (const stamp of stamps) {
			if (!stamped.has(stamp.entryId)) continue;
			summary.matched += 1;
			summary.unmatched -= 1;
			if (stamp.status === 'verified') summary.verified += 1;
			else if (stamp.status === 'flagged') summary.flagged += 1;
			else summary.stampedIncomplete += 1;
		}
		summary.ambiguous += ambiguous;
		summary.waitingForWallet += waitingForWallet;
	}
	return summary;
}
