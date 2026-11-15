/**
 * The reconciler (surface C4): proves each saved entry was paid for, and by whom.
 *
 * The check-in endpoint saves an entry the moment Qatom calls it, with no transaction, no
 * paying wallet and no stamp time. This module reads the ledgers of the catalog items the
 * campaigns name through Tejido's merchant account, finds the transaction that paid for each
 * such entry, and records it. Paid from the agent wallet registered for the entry's party:
 * `verified`. Paid from any other wallet: `flagged`, with a reason donors can read.
 *
 * TWO WAYS TO PROVE AN ENTRY. An entry filed with a transaction id from Qatom is proved by
 * Qatom's own purchase record (see "BY QATOM'S OWN PURCHASE RECORD" below): that shows a
 * settled sale of the right item for the right amount, and NOT which wallet paid. Every other
 * entry is looked for on the ledger, as described here, which is the only way that compares
 * the paying wallet.
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
 * WHICH LEDGER ROWS ARE LOOKED AT. A row is left out when it says it is money going out (its
 * `operation` is `send`), or when it names a commodity other than the one whose ledger was
 * read. Qatom's ledger also lists `receive`, `transfer` and `split`; it is NOT SETTLED which
 * of those a sale is listed as, so none of them is left out, and a row with no operation is
 * kept. The summary counts what was left out and which operations were seen.
 *
 * A PAYING ADDRESS WE CANNOT COMPARE IS NEVER A REASON TO FLAG. It is NOT SETTLED whether the
 * ledger's `fromAddress` is a wallet hostname or a 66-character hexadecimal address. A
 * registered wallet is a hostname, so only a hostname (or a twin URL) can be told apart from
 * it. When the only transaction that fits an entry has a paying address in any other form,
 * the entry is left as it is and counted as `payingWalletNotComparable`. A wrong flag on a
 * donor's page is worse than a pending receipt.
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
	type FiledPurchase,
	type UnreconciledEntry
} from '@tejido/db';
import { QatomError, sameTwin, twinHostname } from '@tejido/qatom';
import type { LedgerTransaction, MerchantAccount, Purchase } from '@tejido/qatom/account';

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
 * Nothing is converted here. Qatom reports decimal USD-TDN (a 0.10 work log reads 0.1) and
 * @tejido/qatom turns it into our thousandths before this module sees it (amounts.ts there,
 * the one place that converts). So a 0.10 work log arrives as 100. Do not scale it again.
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

/**
 * Whether the paying address is in a form that can be compared with a registered wallet: a
 * hostname with a dot in it, bare or as a twin URL. A 66-character hexadecimal address is not.
 * Only a comparable address can show that a deposit was paid from ANOTHER wallet.
 */
function payingWalletComparable(transaction: LedgerTransaction): boolean {
	return twinHostname(transaction.payingAddress)?.includes('.') ?? false;
}

/** The operations Qatom's ledger lists. Any other value is counted as `other`. */
const LEDGER_OPERATIONS = ['send', 'receive', 'transfer', 'split'] as const;

/**
 * Whether a ledger row may be a payment for the item whose ledger it is on.
 *
 * THE ONE PLACE that decides which rows are looked at. `send` is money going out, so it is
 * never a payment in. It is not settled which of `receive`, `transfer` and `split` a sale is
 * listed as, so those are all kept, as is a row with no operation: leaving out the wrong one
 * would hide every payment. A row naming another commodity is not a sale of this one.
 */
function mayBePayment(transaction: LedgerTransaction, commodityHash: string): boolean {
	if (transaction.operation?.toLowerCase() === 'send') return false;
	return (
		transaction.commodityHash === null ||
		transaction.commodityHash.toLowerCase() === commodityHash.toLowerCase()
	);
}

export interface ReconcileSummary {
	/** Campaigns looked at: every campaign. */
	campaigns: number;
	/**
	 * Of those, the campaigns that store no commodity id of their own and so are read under
	 * the two shared items (SHARED_ITEM_COMMODITY_ID). They are not skipped.
	 */
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
	/** Entries still without a transaction after this pass, including the three counts below. */
	unmatched: number;
	/** Unmatched because more than one pairing was possible. */
	ambiguous: number;
	/** Unmatched because the party has not linked a wallet yet. */
	waitingForWallet: number;
	/**
	 * Unmatched, and deliberately NOT flagged: the one transaction that fits the entry has a
	 * paying address that is not a hostname (for example a hexadecimal address), so we cannot
	 * tell whether it is the party's registered wallet. Above zero means Qatom's ledger does
	 * not give the paying wallet in the form we registered, and the owner must tell us the form.
	 */
	payingWalletNotComparable: number;
	/** Ledger rows we could not use: a field missing, or a time that is not a time. */
	unreadableTransactions: number;
	/**
	 * Ledger rows left out because they are not payments for the item: money going out
	 * (`send`), or a row naming another commodity.
	 */
	rowsNotPayments: number;
	/**
	 * How many readable ledger rows carried each operation, before any was left out. `other`
	 * is a value not in Qatom's list; `none` is a row with no operation. Counts only: it shows
	 * which operation a real sale is listed as.
	 */
	operationsSeen: Record<(typeof LEDGER_OPERATIONS)[number] | 'other' | 'none', number>;
	/** Purchases asked of Qatom in this pass, for entries filed with a transaction id. */
	purchaseLookups: number;
	/** Of those, the ones Qatom does not know or has not settled yet. They are asked again. */
	purchasesNotSettled: number;
	/** Entries left waiting because Qatom could not be asked, or the item they name was not found. */
	purchaseErrors: number;
	/**
	 * Entries with a transaction id that were not asked about in this pass: over the limit of
	 * one pass, or filed too long ago to be asked about any more.
	 */
	purchasesNotAsked: number;
}

/**
 * One plain line about a pass, for the Worker's logs: the summary's numbers and nothing else.
 * It is written for every pass, also one that found nothing, so the logs show that the timer
 * runs and what each pass saw.
 *
 * Numbers only. Each value is a count from the summary; of `ledgerErrors` only how many there
 * were. Never a wallet, a hostname, a commodity or campaign id, an email, an amount, or the
 * text of a problem.
 */
export function reconcileLogLine(summary: ReconcileSummary): string {
	const seen = summary.operationsSeen;
	return [
		`Reconcile: campaigns ${summary.campaigns} (${summary.campaignsWithoutItems} on the shared items)`,
		`ledgers read ${summary.ledgersRead}`,
		`ledger errors ${summary.ledgerErrors.length}`,
		`matched ${summary.matched} (verified ${summary.verified}, flagged ${summary.flagged}, incomplete ${summary.stampedIncomplete})`,
		`unmatched ${summary.unmatched} (ambiguous ${summary.ambiguous}, waiting for wallet ${summary.waitingForWallet}, paying wallet not comparable ${summary.payingWalletNotComparable})`,
		`rows unreadable ${summary.unreadableTransactions}`,
		`rows not payments ${summary.rowsNotPayments}`,
		`purchases asked ${summary.purchaseLookups} (not settled ${summary.purchasesNotSettled}, errors ${summary.purchaseErrors}, not asked ${summary.purchasesNotAsked})`,
		`operations seen: send ${seen.send}, receive ${seen.receive}, transfer ${seen.transfer}, split ${seen.split}, other ${seen.other}, none ${seen.none}.`
	].join(', ');
}

/**
 * One plain line about a pass, for the Worker's logs: the summary's numbers and nothing else.
 * It is written for every pass, also one that found nothing, so the logs show that the timer
 * runs and what each pass saw.
 *
 * Numbers only. Each value is a count from the summary; of `ledgerErrors` only how many there
 * were. Never a wallet, a hostname, a commodity or campaign id, an email, an amount, or the
 * text of a problem.
 */
export function reconcileLogLine(summary: ReconcileSummary): string {
	const seen = summary.operationsSeen;
	return [
		`Reconcile: campaigns ${summary.campaigns} (${summary.campaignsWithoutItems} on the shared items)`,
		`ledgers read ${summary.ledgersRead}`,
		`ledger errors ${summary.ledgerErrors.length}`,
		`matched ${summary.matched} (verified ${summary.verified}, flagged ${summary.flagged}, incomplete ${summary.stampedIncomplete})`,
		`unmatched ${summary.unmatched} (ambiguous ${summary.ambiguous}, waiting for wallet ${summary.waitingForWallet}, paying wallet not comparable ${summary.payingWalletNotComparable})`,
		`rows unreadable ${summary.unreadableTransactions}`,
		`rows not payments ${summary.rowsNotPayments}`,
		`operations seen: send ${seen.send}, receive ${seen.receive}, transfer ${seen.transfer}, split ${seen.split}, other ${seen.other}, none ${seen.none}.`
	].join(', ');
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

/**
 * THE TWO SHARED ITEMS. Every campaign uses the same two catalog items on Tejido's merchant
 * account (the owner's decision, 15 November 2026): one Log work and one Milestone hit. These
 * are their commodity ids in Qatom, the same two the example campaign has always carried.
 *
 * A campaign that stores an id of its own for an item is read under that id. A campaign that
 * stores none, which is every campaign made with the builder, is read under these. Without
 * this its reports would stay at "Receipt pending" for ever.
 *
 * CLAUDE.md prefers configuration for a value that belongs to one Qatom environment. There is
 * one environment, and the owner chose not to add settings to the release for this.
 */
export const SHARED_ITEM_COMMODITY_ID = {
	log_work: 3152,
	milestone_hit: 3153
} as const satisfies Record<EntryItem, number>;

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
): {
	stamps: EntryStamp[];
	ambiguous: number;
	waitingForWallet: number;
	payingWalletNotComparable: number;
} {
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
	// Flagging says "paid from another wallet". That can only be said of an address that can
	// be compared with a registered wallet. Otherwise the entry is left exactly as it is.
	const notComparable = new Set<UnreconciledEntry>();
	for (const [row, candidate] of otherPairs) {
		if (!payingWalletComparable(candidate.transaction)) {
			notComparable.add(row);
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
		if (
			ownPairs.has(row) ||
			otherPairs.has(row) ||
			notComparable.has(row) ||
			row.party.agentWalletHostname === null
		) {
			continue;
		}
		const had = (fromOwnWallet.get(row)?.length ?? 0) + (fromElsewhere.get(row)?.length ?? 0);
		if (had > 0) ambiguous += 1;
	}
	return { stamps, ambiguous, waitingForWallet, payingWalletNotComparable: notComparable.size };
}

/**
 * BY QATOM'S OWN PURCHASE RECORD
 *
 * Qatom's ledger names the payer as a 66-character address that cannot be compared with a
 * wallet hostname, so the ledger walk above can never verify a real filing. For an entry filed
 * with a transaction id (the `X-Qatom-Transaction-Id` header of Qatom's call to our check-in
 * endpoint, kept beside the entry), the reconciler asks Qatom for that purchase instead.
 *
 * WHAT `verified` MEANS FOR SUCH AN ENTRY. Qatom confirms a SETTLED sale, of the catalog item
 * this entry names, for exactly this entry's deposit, and that sale is tied to this filing by
 * the id Qatom itself sent with it.
 *
 * WHAT IT DOES NOT ESTABLISH: WHICH WALLET PAID. Qatom's purchase record names no payer, and
 * its ledger names one only in a form Tejido cannot compare. So `payingWallet` stays null, and
 * nothing here says the deposit came from the party's registered wallet.
 *
 *   - settled, the right item, the right amount: `verified` (an `incomplete` entry keeps its
 *     status and reason, as in the ledger walk), stamped with the time the sale settled;
 *   - not found, or not settled yet: left waiting, and asked again on a later pass;
 *   - settled, but for another item or another amount: `flagged`, with the reason;
 *   - Qatom cannot be asked, or the catalog item the entry names cannot be found: left waiting.
 *
 * The transaction id goes where the ledger row's id goes (`twistId`): it is what identifies
 * the sale at Qatom, and one transaction can still prove only one entry.
 *
 * AT MOST PURCHASE_LOOKUPS_PER_PASS lookups a pass, oldest filing first, and only for filings
 * younger than PURCHASE_LOOKUP_MAX_AGE_MS: a sale settles in seconds, so a filing whose
 * purchase is still not there after that long would otherwise be asked about for ever, ahead
 * of every newer one.
 */
export const PURCHASE_LOOKUPS_PER_PASS = 20;
export const PURCHASE_LOOKUP_MAX_AGE_MS = 24 * 60 * 60_000;

interface WaitingOnPurchase {
	row: UnreconciledEntry & { purchase: FiledPurchase };
	/** The commodity of the item the entry names, as its campaign has it. */
	commodityId: number;
}

async function verifyByPurchase(
	db: Database,
	account: Pick<MerchantAccount, 'findCatalogItem' | 'getPurchase'>,
	waiting: WaitingOnPurchase[],
	now: string,
	summary: ReconcileSummary
): Promise<void> {
	const oldest = Date.parse(now) - PURCHASE_LOOKUP_MAX_AGE_MS;
	const young = waiting
		.filter(({ row }) => Date.parse(row.entry.filedAt) >= oldest)
		.sort(
			(a, b) =>
				a.row.entry.filedAt.localeCompare(b.row.entry.filedAt) ||
				a.row.entry.id.localeCompare(b.row.entry.id)
		);
	const asked = young.slice(0, PURCHASE_LOOKUPS_PER_PASS);
	summary.purchasesNotAsked = waiting.length - asked.length;

	// The catalog item each commodity is sold as, asked once per commodity in a pass.
	const catalogItems = new Map<number, Promise<number | null>>();
	const catalogItemOf = (commodityId: number) => {
		let found = catalogItems.get(commodityId);
		if (!found) {
			found = account.findCatalogItem(commodityId).then((item) => item?.catalogItemId ?? null);
			catalogItems.set(commodityId, found);
		}
		return found;
	};

	const stamps: EntryStamp[] = [];
	for (const { row, commodityId } of asked) {
		let expected: number | null;
		let purchase: Purchase;
		try {
			expected = await catalogItemOf(commodityId);
			if (expected === null) {
				summary.purchaseErrors += 1;
				continue;
			}
			summary.purchaseLookups += 1;
			purchase = await account.getPurchase(row.purchase.transactionId);
		} catch (error) {
			// A QatomError carries no token, secret or response body.
			if (!(error instanceof QatomError)) throw error;
			summary.purchaseErrors += 1;
			continue;
		}
		if (purchase.status !== 'settled') {
			summary.purchasesNotSettled += 1;
			continue;
		}

		const stamp = (status: EntryStamp['status'], statusReason: string | null) =>
			stamps.push({
				entryId: row.entry.id,
				twistId: row.purchase.transactionId,
				// Qatom's purchase record names no payer.
				payingWallet: null,
				stampedAt: purchase.settledAt,
				status,
				statusReason,
				updatedAt: now
			});
		const told = row.purchase.catalogItemId;
		const wrongItem =
			purchase.catalogItemId !== expected || (told !== null && told !== purchase.catalogItemId);
		const wrongAmount = purchase.amount !== row.depositAmount;
		if (wrongItem || wrongAmount) {
			const reason = wrongItem
				? 'Qatom’s record of the purchase filed with this entry is for a different item.'
				: 'Qatom’s record of the purchase filed with this entry is for a different amount than this entry’s deposit.';
			const earlier = row.entry.status === 'incomplete' ? row.entry.statusReason : null;
			stamp('flagged', fit(earlier ? `${reason} ${earlier}` : reason));
		} else if (row.entry.status === 'incomplete') {
			stamp('incomplete', row.entry.statusReason);
		} else {
			stamp('verified', null);
		}
	}

	const stamped = new Set(await stampEntries(db, stamps));
	for (const stamp of stamps) {
		if (!stamped.has(stamp.entryId)) continue;
		summary.matched += 1;
		summary.unmatched -= 1;
		if (stamp.status === 'verified') summary.verified += 1;
		else if (stamp.status === 'flagged') summary.flagged += 1;
		else summary.stampedIncomplete += 1;
	}
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
	account: Pick<
		MerchantAccount,
		'resolveCommodityHash' | 'listCommodityTransactions' | 'findCatalogItem' | 'getPurchase'
	>,
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
		payingWalletNotComparable: 0,
		unreadableTransactions: 0,
		rowsNotPayments: 0,
		operationsSeen: { send: 0, receive: 0, transfer: 0, split: 0, other: 0, none: 0 },
		purchaseLookups: 0,
		purchasesNotSettled: 0,
		purchaseErrors: 0,
		purchasesNotAsked: 0
	};

	// First, gather. Campaigns that name the same commodity share one ledger, so their waiting
	// entries are put side by side before anything is read or matched.
	const ledgers = new Map<number, SharedLedger>();
	const byPurchase: WaitingOnPurchase[] = [];
	for (const campaign of await listCampaigns(db)) {
		// Counted, never skipped: a campaign with no ids of its own uses the shared items.
		if (ITEMS.every((item) => campaign[ITEM_COMMODITY_ID[item]] === null)) {
			summary.campaignsWithoutItems += 1;
		}
		summary.campaigns += 1;
		const waiting = await listUnreconciledEntries(db, campaign.id);
		summary.unmatched += waiting.length;

		for (const item of ITEMS) {
			const commodityId = campaign[ITEM_COMMODITY_ID[item]] ?? SHARED_ITEM_COMMODITY_ID[item];
			// An entry filed with a transaction id is proved by Qatom's purchase record, below.
			// Only the others are looked for on the ledger.
			const waitingForItem: UnreconciledEntry[] = [];
			for (const row of waiting) {
				if (row.entry.item !== item) continue;
				const { purchase } = row;
				if (purchase === null) waitingForItem.push(row);
				else byPurchase.push({ row: { ...row, purchase }, commodityId });
			}
			// Nothing to prove: this campaign asks for no ledger.
			if (waitingForItem.length === 0) continue;

			let ledger = ledgers.get(commodityId);
			if (!ledger) {
				ledger = { commodityId, namedBy: [], waiting: [] };
				ledgers.set(commodityId, ledger);
			}
			ledger.namedBy.push({ campaignId: campaign.id, item });
			ledger.waiting.push(...waitingForItem);
		}
	}

	// The entries Qatom named a purchase for: ask Qatom about each, up to the limit.
	await verifyByPurchase(db, account, byPurchase, now, summary);

	// Then, each ledger once, with every entry that could have been paid into it.
	for (const { commodityId, namedBy, waiting } of ledgers.values()) {
		let transactions: LedgerTransaction[];
		try {
			// The ledger is read by hash. The account looks it up from the id and remembers it.
			const commodityHash = await account.resolveCommodityHash(commodityId);
			const ledger = await account.listCommodityTransactions(commodityHash);
			for (const { operation } of ledger.transactions) {
				const known = LEDGER_OPERATIONS.find((name) => name === operation?.toLowerCase());
				summary.operationsSeen[known ?? (operation === null ? 'none' : 'other')] += 1;
			}
			// Only rows that may be payments for this item are looked at.
			transactions = ledger.transactions.filter((row) => mayBePayment(row, commodityHash));
			summary.rowsNotPayments += ledger.transactions.length - transactions.length;
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

		const { stamps, ambiguous, waitingForWallet, payingWalletNotComparable } = matchLedger(
			waiting,
			candidates,
			now
		);
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
		summary.payingWalletNotComparable += payingWalletNotComparable;
	}
	return summary;
}
