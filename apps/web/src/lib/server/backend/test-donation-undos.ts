/**
 * Undoing the donations the automatic paid tests make, by itself, on the timer. FOR THE
 * END-TO-END TEST PEOPLE ONLY. Track C owns this file.
 *
 * THE ONE EXCEPTION (CLAUDE.md, "Qatom"; the owner's decision of 15 November 2026: "pay real
 * donation is totally fine, make one, then remove it then refund the donation like the other
 * e2e tests"). A donation to a campaign the tests own, paid from a wallet registered to a
 * test person, is taken out of the campaign's total and sent back to the wallet it was paid
 * from, out of the donation item's own twin. Nobody else's donation is ever touched, and
 * nobody who is not a test person is ever sent money this way.
 *
 * WHICH DONATIONS. A recorded donation whose campaign's creator's email is at the test inbox
 * domain (`isEndToEndTestEmail` in @tejido/qatom, the one place that decides), that reached
 * us in the last CONSIDER_FOR_MS, and that no undo has ever named.
 *
 * WHO GETS THE MONEY. Qatom's call to the donation endpoint does not say who paid, so the
 * payment is found on the ledger of the donation item that sells the amount (the item is
 * found as the Give page finds it, donation-items.ts). A ledger row can be a donation's
 * payment only if ALL of these hold:
 *   - its `operation` is `receive`, and it names no other commodity;
 *   - its amount is exactly the donation's;
 *   - its time is in the window around the moment the donation was recorded (the payment
 *     comes first, then Qatom calls us): the reconciler's own window;
 *   - no undo has ever named it;
 *   - its paying address is a wallet hostname that Tejido's OWN database has registered, as a
 *     primary or an agent wallet, to at least one party, and EVERY party it is registered to
 *     is a test person. What the ledger says is never enough by itself.
 * Then exactly one each way: the donation is undone only when exactly one row can be its
 * payment, and that row could be the payment of no other recorded donation of that amount,
 * on ANY campaign. So a test person's donation to a real campaign is never mistaken for one
 * to a test campaign. Whenever it is not exactly one each way, nothing is sent.
 *
 * The money goes to the party's wallet AS TEJIDO STORES IT, never to the text of the ledger.
 *
 * ONCE ONLY, in the order of the test-account refunds: the undo is written as `started`,
 * tied to the donation and to the ledger payment, BEFORE the transfer; then it becomes
 * `sent`, `failed` (the twin refused, nothing moved) or `unknown` (no answer; the money may
 * have moved). A donation or a payment that any undo has ever named is NEVER tried again,
 * whatever came of it. The transfer itself is sent once by @tejido/qatom and never retried.
 *
 * OUT OF THE TOTAL. Only an undo recorded as `sent` takes the donation out of the campaign's
 * total and count (`counted` in donations.ts of @tejido/db). The donation's row stays. A
 * campaign's status never moves backwards: one the donation made `funded` stays `funded`.
 *
 * A LIMIT PER PASS. The transfers one pass asks for may add up to at most PASS_LIMIT. A
 * donation larger than that is never undone here.
 *
 * WHAT IS KEPT. For an undone test donation: the ledger payment's own id, the amount and
 * where the undo stands. No wallet. The twin's hostname and key never reach this file:
 * @tejido/qatom reads them, uses them for the one transfer and drops them. Nothing here
 * stores or logs a wallet address. For every other donation nothing changes: no wallet, no
 * transaction id, only the one-way fingerprint.
 */
import { formatAmount, type Amount } from '@tejido/contracts';
import {
	claimDonationUndo,
	listDonationsOfAmountBetween,
	listDonationsToUndoByCreatorEmailDomain,
	listPartiesByWalletHostname,
	listUndoneTwistIds,
	markDonationUndoFailed,
	markDonationUndoSent,
	markDonationUndoUnknown,
	type Database,
	type DonationOfCreatorDomain,
	type PartyOfWallet
} from '@tejido/db';
import { QatomError, twinHostname } from '@tejido/qatom';
import {
	E2E_TEST_EMAIL_DOMAIN,
	isEndToEndTestEmail,
	isWalletHostname,
	type ItemTwinRefundRefusal,
	type LedgerTransaction,
	type MerchantAccount
} from '@tejido/qatom/account';
import { donationOptions } from './donation-items.ts';
import { MATCH_WINDOW_AFTER_MS, MATCH_WINDOW_BEFORE_MS } from './reconciler.ts';

/**
 * The most one pass may ask twins to send, in Tejido's unit: 10.00. The paid tests give the
 * smallest amount (1.00), so this is ten of them. A fault here could at worst move 10.00 in
 * a minute, out of twins that hold donations, to wallets registered to test people.
 */
export const PASS_LIMIT: Amount = 10_000;

/**
 * How long after a donation was recorded a pass still looks at it: one hour. The payment is
 * on the ledger before Qatom calls us, so the first pass normally finds it. Past the hour a
 * donation that could not be undone is left as it is for good, so one that can never be
 * matched does not make the timer read ledgers every minute for ever.
 */
export const CONSIDER_FOR_MS = 60 * 60_000;

/**
 * The window around the moment a donation was recorded in which its payment's ledger time
 * must fall: from five minutes before to one minute after. The reconciler's own window, and
 * the same assumption: NOT MEASURED AGAINST REAL QATOM. The first real paid run measures it.
 * If it is too narrow nothing is sent (`no_payment_from_a_test_wallet`); it never sends more.
 */
export const PAYMENT_WINDOW_BEFORE_MS = MATCH_WINDOW_BEFORE_MS;
export const PAYMENT_WINDOW_AFTER_MS = MATCH_WINDOW_AFTER_MS;

export type DonationUndoSkipReason =
	/** An earlier pass started this undo and has not recorded what happened. */
	| 'undo_in_progress'
	/** An earlier transfer for this donation got no answer. It may have gone through. */
	| 'undo_outcome_unknown'
	/** An undo of this donation was tried before and did not go through. Not tried again. */
	| 'undo_tried_before'
	/** This one donation is more than a whole pass may send. Never sent here. */
	| 'transfer_over_limit'
	/** This pass has already asked for as much as one pass may. Waits for the next pass. */
	| 'pass_limit_reached'
	/** Qatom lists no donation item for this amount with a ledger that can be read. */
	| 'no_donation_item'
	/** The item's ledger holds no payment that fits and was paid from a test person's wallet. */
	| 'no_payment_from_a_test_wallet'
	/** More than one payment fits the donation, or the payment fits more than one donation. */
	| 'ambiguous'
	/** Qatom, or the twin's balance, could not be read. Nothing was sent. Tried next pass. */
	| 'qatom_unavailable'
	/** Another request claimed this donation or this payment while this one was preparing. */
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
const NEEDS_A_PERSON: ReadonlySet<DonationUndoSkipReason> = new Set([
	'undo_in_progress',
	'undo_outcome_unknown',
	'undo_tried_before',
	'transfer_over_limit',
	'transfer_refused',
	'transfer_outcome_unknown',
	'sent_not_recorded',
	'not_a_test_person',
	'recipient_not_a_wallet',
	'item_twin_not_a_wallet',
	'recipient_is_the_item_twin'
]);

interface DonationUndoLine {
	donation_id: string;
	campaign_id: string;
	/** In Tejido's unit, thousandths of USD-TDN: 1000 is 1.00. */
	amount: Amount;
	amount_display: string;
}

export interface DonationUndoSkipped extends DonationUndoLine {
	reason: DonationUndoSkipReason;
}

export interface DonationUndoReport {
	/** Sent back and taken out of the campaign's total. */
	undone: DonationUndoLine[];
	skipped: DonationUndoSkipped[];
	/** What the twins were asked to send in this pass, whatever came of it. */
	asked_total: Amount;
	/** True when something was skipped that only a person can resolve. */
	needs_a_person: boolean;
	message: string;
}

export interface UndoTestDonationsOptions {
	db: Database;
	/** Tejido's merchant account. Never a person's token. */
	account: Pick<
		MerchantAccount,
		'listOwnCatalogItems' | 'listCommodityTransactions' | 'returnTestDonationFromItemTwin'
	>;
	/** The Campaign Site's own origin: where the donation items call (`campaignSiteOrigin`). */
	siteOrigin: string;
	/** The time of the pass. Only tests give one. */
	now?: Date;
}

/** A short description of a failure. A QatomError never carries a token, key or address. */
function describeFailure(error: unknown): string {
	if (error instanceof QatomError) return `${error.name}: ${error.message}`.slice(0, 300);
	// Anything else is not ours to quote.
	return error instanceof Error ? error.name : 'Unknown failure';
}

/** Whether a payment recorded at `paidAt` is in the window of a donation recorded at `receivedAt`. */
function inWindow(paidAt: number, receivedAt: number): boolean {
	return (
		paidAt >= receivedAt - PAYMENT_WINDOW_BEFORE_MS &&
		paidAt <= receivedAt + PAYMENT_WINDOW_AFTER_MS
	);
}

/**
 * The test person a paying address belongs to, with their wallet as Tejido stores it, or
 * null. THE ONE PLACE that decides whether a wallet may be sent a donation back: the address
 * must be a wallet hostname, registered in Tejido's own database to at least one party, and
 * every party it is registered to must be a test person.
 */
async function testPersonOfWallet(
	db: Database,
	payingAddress: string
): Promise<PartyOfWallet | null> {
	const hostname = twinHostname(payingAddress);
	if (hostname === null || !isWalletHostname(hostname)) return null;
	const registered = await listPartiesByWalletHostname(db, hostname);
	const [first] = registered;
	if (!first || !registered.every(({ email }) => isEndToEndTestEmail(email))) return null;
	return first;
}

/** A ledger row that may be a test person's donation payment, and who paid it. */
interface Payment {
	twistId: string;
	paidAt: number;
	payer: PartyOfWallet;
}

/**
 * One pass: every donation the paid tests made that can be tied to exactly one payment from
 * a test person's wallet is sent back to that wallet and taken out of its campaign's total.
 * Safe to run again: a donation is never sent back twice.
 *
 * Transfers go one after another, never side by side.
 */
export async function undoTestDonations(
	options: UndoTestDonationsOptions
): Promise<DonationUndoReport> {
	const { db, account, siteOrigin } = options;
	const now = options.now ?? new Date();

	// WHICH DONATIONS. The database shortens the list by the same domain; this line decides.
	const rows = (
		await listDonationsToUndoByCreatorEmailDomain(
			db,
			E2E_TEST_EMAIL_DOMAIN,
			new Date(now.getTime() - CONSIDER_FOR_MS).toISOString()
		)
	).filter((row) => isEndToEndTestEmail(row.creatorEmail));

	const undone: DonationUndoLine[] = [];
	const skipped: DonationUndoSkipped[] = [];
	const line = (row: DonationOfCreatorDomain): DonationUndoLine => ({
		donation_id: row.donationId,
		campaign_id: row.campaignId,
		amount: row.amount,
		amount_display: formatAmount(row.amount)
	});
	const skip = (row: DonationOfCreatorDomain, reason: DonationUndoSkipReason) => {
		skipped.push({ ...line(row), reason });
	};

	// 1. A donation that any undo has ever named is never tried again.
	const ready: DonationOfCreatorDomain[] = [];
	for (const row of rows) {
		if (row.undoStatus === null) ready.push(row);
		else if (row.undoStatus === 'started') skip(row, 'undo_in_progress');
		else if (row.undoStatus === 'unknown') skip(row, 'undo_outcome_unknown');
		else skip(row, 'undo_tried_before');
	}

	// 2. The donation items, asked of Qatom once, and only when there is something to undo.
	let ledgerOfAmount = new Map<Amount, string>();
	let qatomDown = false;
	if (ready.length > 0) {
		try {
			const items = await account.listOwnCatalogItems();
			ledgerOfAmount = new Map(
				donationOptions(items, siteOrigin).flatMap(({ amount, catalogItemId }) => {
					const hash = items.find((item) => item.catalogItemId === catalogItemId)?.commodityHash;
					return hash ? [[amount, hash] as const] : [];
				})
			);
		} catch (error) {
			if (!(error instanceof QatomError)) throw error;
			console.error('Test-donation undo: Qatom could not be read:', describeFailure(error));
			qatomDown = true;
		}
	}

	// 3. Each amount's ledger is read once: the payments on it that a test person's wallet
	//    paid and no undo has named. `null` means the ledger could not be read.
	const paymentsOfAmount = new Map<Amount, Payment[] | null>();
	const paymentsOf = async (amount: Amount, commodityHash: string): Promise<Payment[] | null> => {
		const known = paymentsOfAmount.get(amount);
		if (known !== undefined) return known;
		let transactions: LedgerTransaction[];
		try {
			({ transactions } = await account.listCommodityTransactions(commodityHash));
		} catch (error) {
			if (!(error instanceof QatomError)) throw error;
			console.error('Test-donation undo: Qatom could not be read:', describeFailure(error));
			paymentsOfAmount.set(amount, null);
			return null;
		}
		const incoming = transactions.filter(
			(row) =>
				row.operation?.toLowerCase() === 'receive' &&
				row.amount === amount &&
				(row.commodityHash === null ||
					row.commodityHash.toLowerCase() === commodityHash.toLowerCase()) &&
				!Number.isNaN(Date.parse(row.timestamp))
		);
		const used = await listUndoneTwistIds(
			db,
			incoming.map(({ twistId }) => twistId)
		);
		const payments: Payment[] = [];
		for (const row of incoming) {
			if (used.has(row.twistId)) continue;
			const payer = await testPersonOfWallet(db, row.payingAddress);
			if (payer) payments.push({ twistId: row.twistId, paidAt: Date.parse(row.timestamp), payer });
		}
		paymentsOfAmount.set(amount, payments);
		return payments;
	};

	// 4. One donation at a time, oldest first, up to the limit.
	let askedTotal: Amount = 0;
	for (const row of ready) {
		const { donationId, amount } = row;
		if (amount > PASS_LIMIT) {
			skip(row, 'transfer_over_limit');
			continue;
		}
		if (qatomDown) {
			skip(row, 'qatom_unavailable');
			continue;
		}
		const commodityHash = ledgerOfAmount.get(amount);
		if (commodityHash === undefined) {
			skip(row, 'no_donation_item');
			continue;
		}
		const payments = await paymentsOf(amount, commodityHash);
		if (payments === null) {
			skip(row, 'qatom_unavailable');
			continue;
		}

		// Exactly one each way.
		const receivedAt = Date.parse(row.receivedAt);
		const fitting = payments.filter(({ paidAt }) => inWindow(paidAt, receivedAt));
		const [payment] = fitting;
		if (!payment) {
			skip(row, 'no_payment_from_a_test_wallet');
			continue;
		}
		if (fitting.length > 1) {
			skip(row, 'ambiguous');
			continue;
		}
		// Every recorded donation of this amount, on any campaign, whose window this payment
		// is in. One an undo has named has its own payment already; any other could be the
		// one this payment paid for.
		const others = (
			await listDonationsOfAmountBetween(
				db,
				amount,
				new Date(payment.paidAt - PAYMENT_WINDOW_AFTER_MS).toISOString(),
				new Date(payment.paidAt + PAYMENT_WINDOW_BEFORE_MS).toISOString()
			)
		).filter((other) => other.donationId !== donationId && !other.hasUndo);
		if (others.length > 0) {
			skip(row, 'ambiguous');
			continue;
		}

		if (askedTotal + amount > PASS_LIMIT) {
			skip(row, 'pass_limit_reached');
			continue;
		}

		// The wallet as Tejido stores it for the test person, never the ledger's text.
		const { payer, twistId } = payment;
		const walletHostname = payer.primaryWalletHostname ?? payer.agentWalletHostname;
		let claimed = false;
		let result;
		try {
			result = await account.returnTestDonationFromItemTwin({
				commodityHash,
				payer: { email: payer.email, walletHostname },
				amount,
				// STARTED, before the transfer. If an undo already names this donation or this
				// payment, nothing was written and nothing is sent.
				beforeSending: async () => {
					claimed = await claimDonationUndo(db, {
						donationId,
						twistId,
						amount,
						startedAt: new Date().toISOString()
					});
					if (claimed) askedTotal += amount;
					return claimed;
				}
			});
		} catch (error) {
			if (claimed) {
				// Not expected: the Qatom call reports what became of a transfer, it does not
				// throw. If it ever does after the claim, the money may have moved.
				console.error('Test-donation undo outcome unknown:', donationId, describeFailure(error));
				await markDonationUndoUnknown(db, donationId, describeFailure(error));
				skip(row, 'transfer_outcome_unknown');
				continue;
			}
			if (!(error instanceof QatomError)) throw error;
			// Before the transfer: nothing was sent and nothing was written.
			console.error('Test-donation undo: Qatom could not be read:', describeFailure(error));
			skip(row, 'qatom_unavailable');
			continue;
		}
		// This payment is spoken for now, whatever came of it: no other donation in this pass
		// may be matched to it. (The table refuses it too.)
		if (claimed) payments.splice(payments.indexOf(payment), 1);

		if (result.outcome === 'not_sent') {
			skip(
				row,
				result.reason === 'stopped_by_caller' ? 'claimed_by_another_request' : result.reason
			);
			continue;
		}
		if (result.outcome === 'refused') {
			const reason = `The donation item's twin refused the transfer and nothing moved. (It answered ${result.status}.) Not tried again by the timer.`;
			console.error('Test-donation undo refused by the twin:', donationId, result.status);
			await markDonationUndoFailed(db, donationId, reason, new Date().toISOString());
			skip(row, 'transfer_refused');
			continue;
		}
		if (result.outcome === 'unknown') {
			const reason = `The transfer from the donation item's twin got no answer (${result.failure}). It may have gone through. Never sent again.`;
			console.error('Test-donation undo outcome unknown:', donationId, result.failure);
			await markDonationUndoUnknown(db, donationId, reason);
			skip(row, 'transfer_outcome_unknown');
			continue;
		}

		// SENT BACK, and from this write out of the campaign's total. If the write fails the
		// undo stays `started`, which still stops the donation from ever being sent again.
		let recorded = false;
		try {
			recorded = await markDonationUndoSent(db, donationId, new Date().toISOString());
		} catch (error) {
			console.error(
				'Test-donation undo sent but not recorded:',
				donationId,
				describeFailure(error)
			);
		}
		if (!recorded) {
			skip(row, 'sent_not_recorded');
			continue;
		}
		undone.push(line(row));
	}

	const needsAPerson = skipped.some(({ reason }) => NEEDS_A_PERSON.has(reason));
	const sentTotal = formatAmount(undone.reduce((sum, { amount }) => sum + amount, 0));
	const parts = [
		undone.length === 0
			? 'Nothing was sent.'
			: `Sent ${sentTotal} back to test people's wallets, undoing ${undone.length} test donation${undone.length === 1 ? '' : 's'}.`
	];
	if (skipped.length > 0) {
		parts.push(`${skipped.length} test donation${skipped.length === 1 ? '' : 's'} not undone.`);
	}
	if (needsAPerson) parts.push('A person needs to look at some of the skipped ones.');

	return {
		undone,
		skipped,
		asked_total: askedTotal,
		needs_a_person: needsAPerson,
		message: parts.join(' ')
	};
}

/**
 * One plain line about a pass, for the Worker's logs, or null when the pass had nothing to
 * consider (so the log is not filled once a minute).
 *
 * Counts and reason names only. Never a wallet address, a hostname, a key, an email or an id:
 * the line is built from the numbers of lines and from `reason`, which is one of a fixed set
 * of names, and from nothing else in the report.
 */
export function passLogLine(report: DonationUndoReport): string | null {
	if (report.undone.length === 0 && report.skipped.length === 0) return null;

	const byReason = new Map<DonationUndoSkipReason, number>();
	for (const { reason } of report.skipped) byReason.set(reason, (byReason.get(reason) ?? 0) + 1);
	const reasons = [...byReason]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([reason, count]) => `${reason} ${count}`)
		.join(', ');

	return [
		`Test-donation undos: ${report.undone.length} sent back`,
		`${report.skipped.length} skipped${reasons === '' ? '' : ` (${reasons})`}`,
		`a person needs to look: ${report.needs_a_person ? 'YES' : 'no'}.`
	].join(', ');
}
