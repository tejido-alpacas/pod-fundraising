/**
 * Funding: reads each campaign's donation ledger and stores what it adds up to.
 *
 * Donors give through Qatom, by paying for the campaign's donation catalog item. Our code takes
 * no part in that. This module reads the item's ledger afterwards, through Tejido's merchant
 * account, and stores the totals so pages never call Qatom: how much, how many donations, and
 * when we read. When a campaign in `funding` has reached its goal, the same write moves it to
 * `funded`. Nothing else follows from that here: no catalog items are created, no reporter
 * codes issued, no other status moved.
 *
 * READ ONLY. Nothing in this module moves money or changes anything in Qatom.
 *
 * NO DONOR IS KEPT. A ledger row names the paying wallet. It is read to add up the amounts and
 * then dropped: no address and no transaction id is stored, logged or put in the summary.
 *
 * WHAT COUNTS AS A DONATION
 *
 * Qatom's document describes the ledger as "the sales history of one commodity", and the
 * donation item has a commodity of its own, so a row on that ledger is a donation. Two things
 * the document does let us check are checked, and a row failing either is not counted:
 *
 *   - if the row names a commodity (`commodityHash`), it is the donation commodity;
 *   - if the ledger names the twin that owns the commodity (`commodity.hostname`), the row's
 *     receiving address is that twin: money that came in, not anything that went out.
 *
 * A row listed twice (the same `twistId`) is one donation. The row's `operation` and `fileType`
 * are not used: the document lists them without saying what values they take.
 *
 * ALL OR NOTHING PER LEDGER. The ledger is read whole (the document gives this call no paging)
 * and its total replaces the stored one. So if any row cannot be read (a field missing, or an
 * amount that is not a positive whole number) nothing is stored for that campaign: a total
 * that leaves rows out would be a wrong number shown as a right one. The stored totals stay
 * as they were, and the summary says why. The same when Qatom fails or does not answer.
 *
 * Running it again reads the ledgers again and stores the same totals. `funding` moves to
 * `funded` once.
 */
import { amountSchema, type Amount, type FundingTotals } from '@tejido/contracts';
import { listCampaigns, recordFundingTotals, type Database } from '@tejido/db';
import { QatomError, sameTwin } from '@tejido/qatom';
import type { CommodityLedger, LedgerTransaction, MerchantAccount } from '@tejido/qatom/account';

/**
 * The ledger's `amount` in our units (see money.ts in @tejido/contracts), or null when it is
 * not a donation we can count: not a positive whole number.
 *
 * THE ONE PLACE here that knows the ledger's unit, as `ledgerAmountInUnits` is in the
 * reconciler. Qatom's document does not state it. We assume, as the reconciler does, that it is
 * the same smallest unit as prices and transfers. If staging shows otherwise (README, "Still
 * to confirm on staging"), convert here. Until then a ledger in another unit is refused whole,
 * not rounded.
 */
function donationAmountInUnits(transaction: LedgerTransaction): Amount | null {
	const amount = amountSchema.safeParse(transaction.amount);
	return amount.success && amount.data > 0 && Number.isSafeInteger(amount.data)
		? amount.data
		: null;
}

export interface FundingRefreshSummary {
	/** Campaigns that have a donation item, so a ledger to read. */
	campaigns: number;
	/** Campaigns skipped because no donation commodity id is stored on them yet. */
	campaignsWithoutDonationItem: number;
	/** Ledgers read and stored. */
	ledgersRead: number;
	/**
	 * Campaigns whose totals were NOT updated in this pass, and why. What was stored for them
	 * before is still there.
	 */
	ledgerErrors: { campaignId: string; problem: string }[];
	/** What was stored in this pass, per campaign. Totals only. */
	updated: {
		campaignId: string;
		raised: Amount;
		donations: number;
		/** True when this pass moved the campaign from `funding` to `funded`. */
		becameFunded: boolean;
		/** Rows on the ledger that were not donations (see the top of this file). */
		rowsNotCounted: number;
	}[];
}

type Totalled =
	| { ok: true; raised: Amount; donations: number; rowsNotCounted: number }
	| { ok: false; problem: string };

/** Adds up one donation ledger. Reads and writes nothing. */
export function totalDonations(ledger: CommodityLedger): Totalled {
	if (ledger.incompleteTransactions > 0) {
		return {
			ok: false,
			problem: `The ledger has ${ledger.incompleteTransactions} row(s) with a field missing, so its total cannot be trusted.`
		};
	}
	const seen = new Set<string>();
	let raised = 0;
	let donations = 0;
	let rowsNotCounted = 0;
	for (const transaction of ledger.transactions) {
		// Listed twice by the ledger: still one transaction.
		if (seen.has(transaction.twistId)) continue;
		seen.add(transaction.twistId);

		const aboutThisCommodity =
			transaction.commodityHash === null || transaction.commodityHash === ledger.commodityHash;
		const paidIn =
			ledger.twinHostname === null || sameTwin(transaction.receivingAddress, ledger.twinHostname);
		if (!aboutThisCommodity || !paidIn) {
			rowsNotCounted += 1;
			continue;
		}
		const amount = donationAmountInUnits(transaction);
		if (amount === null) {
			return {
				ok: false,
				problem:
					'The ledger has a donation whose amount is not a positive whole number of the smallest unit, so its total cannot be trusted.'
			};
		}
		raised += amount;
		donations += 1;
	}
	if (!Number.isSafeInteger(raised)) {
		return { ok: false, problem: 'The ledger adds up to more than can be stored exactly.' };
	}
	return { ok: true, raised, donations, rowsNotCounted };
}

/**
 * Reads every campaign's donation ledger once and stores its totals.
 *
 * Reads ledgers only through the merchant account. A ledger Qatom does not give us, or one we
 * cannot total, is noted in the summary and the pass carries on with the others; a database
 * failure throws.
 */
export async function refreshFunding(
	db: Database,
	account: Pick<MerchantAccount, 'resolveCommodityHash' | 'listCommodityTransactions'>,
	now: string = new Date().toISOString()
): Promise<FundingRefreshSummary> {
	const summary: FundingRefreshSummary = {
		campaigns: 0,
		campaignsWithoutDonationItem: 0,
		ledgersRead: 0,
		ledgerErrors: [],
		updated: []
	};

	for (const campaign of await listCampaigns(db)) {
		const commodityId = campaign.donationCommodityId;
		if (commodityId === null) {
			summary.campaignsWithoutDonationItem += 1;
			continue;
		}
		summary.campaigns += 1;
		const refuse = (problem: string) =>
			summary.ledgerErrors.push({ campaignId: campaign.id, problem });

		// The deposit items have ledgers of their own. Read as donations, every work log and
		// milestone stamp would be counted as money given to the campaign.
		if (
			commodityId === campaign.logWorkCommodityId ||
			commodityId === campaign.milestoneHitCommodityId
		) {
			refuse(
				'The donation commodity id is the same as one of the deposit items. Deposits are not donations.'
			);
			continue;
		}

		let ledger: CommodityLedger;
		try {
			// The ledger is read by hash. The account looks it up from the id and remembers it.
			const commodityHash = await account.resolveCommodityHash(commodityId);
			ledger = await account.listCommodityTransactions(commodityHash);
		} catch (error) {
			// A QatomError carries no token, secret or response body.
			if (!(error instanceof QatomError)) throw error;
			refuse(error.message);
			continue;
		}

		const totalled = totalDonations(ledger);
		if (!totalled.ok) {
			refuse(totalled.problem);
			continue;
		}

		const totals: FundingTotals = {
			raised: totalled.raised,
			donations: totalled.donations,
			readAt: now
		};
		const { becameFunded } = await recordFundingTotals(db, campaign.id, totals);
		summary.ledgersRead += 1;
		summary.updated.push({
			campaignId: campaign.id,
			raised: totals.raised,
			donations: totals.donations,
			becameFunded,
			rowsNotCounted: totalled.rowsNotCounted
		});
	}
	return summary;
}
