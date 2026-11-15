/**
 * Reading and writing the records in @tejido/contracts.
 *
 * These are the queries the foundation needs. Add to them freely: a query that returns a
 * contract type belongs here, next to the others, so pages and jobs share it.
 */
import {
	describeDeposit,
	entrySchema,
	fundingSummary,
	fundingTotalsSchema,
	isGoalMet,
	partySchema,
	totalDeposits,
	type AgentWalletHostname,
	type Amount,
	type Campaign,
	type Deposit,
	type DepositStatus,
	type DepositTotals,
	type Entry,
	type EntryItem,
	type EntryStatus,
	type EvidenceFileRecord,
	type EvidenceNotPublic,
	type EvidenceVisibility,
	type FundingSummary,
	type FundingTotals,
	type Milestone,
	type MilestoneState,
	type Party,
	type Photo,
	type PrimaryWalletHostname,
	type Timestamp
} from '@tejido/contracts';
import {
	and,
	asc,
	count,
	desc,
	eq,
	inArray,
	isNull,
	lt,
	lte,
	notExists,
	or,
	sql
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/sqlite-core';
import type { Database, Executor } from './client.ts';
import { getDonationTotals } from './donations.ts';
import {
	campaignFunding,
	campaigns,
	deposits,
	entries,
	entryPurchases,
	evidenceFiles,
	itemProvisioning,
	milestones,
	parties,
	partySignInTokens,
	refundAttempts,
	refundDeposits,
	refunds,
	type RefundStatus
} from './schema.ts';

/**
 * Narrows a stored row to an Entry, checking it against the contract on the way. A row cannot
 * express that `item` decides the shape of `inputs`; the schema can.
 */
export function toEntry(row: typeof entries.$inferSelect): Entry {
	return entrySchema.parse(row);
}

// --- Campaigns ---

export async function listCampaigns(db: Executor): Promise<Campaign[]> {
	return db.select().from(campaigns).orderBy(asc(campaigns.createdAt));
}

export async function getCampaign(db: Executor, id: string): Promise<Campaign | undefined> {
	const [row] = await db.select().from(campaigns).where(eq(campaigns.id, id)).limit(1);
	return row;
}

// --- Funding ---

/**
 * What a page may show of a campaign's funding: its goal and what has been given, or "not
 * known" with the reason. Totals only; nothing here, and nothing stored, identifies a donor.
 * This reads our database and never calls Qatom.
 *
 * A campaign with recorded donations (donations.ts) is summed from them: campaigns share
 * Tejido's donation items, and each recorded donation names its campaign. A campaign with
 * none falls back to the totals of the last read of its own donation ledger, as before.
 */
export async function getFundingSummary(
	db: Executor,
	campaign: Pick<Campaign, 'id' | 'fundingGoal' | 'donationCommodityId'>
): Promise<FundingSummary> {
	const recorded = await getDonationTotals(db, campaign.id);
	if (recorded) {
		return {
			state: 'known',
			goal: campaign.fundingGoal,
			...recorded,
			goalMet: isGoalMet(campaign.fundingGoal, recorded.raised)
		};
	}
	const [row] = await db
		.select({
			raised: campaignFunding.raised,
			donations: campaignFunding.donations,
			readAt: campaignFunding.readAt
		})
		.from(campaignFunding)
		.where(eq(campaignFunding.campaignId, campaign.id))
		.limit(1);
	return fundingSummary(campaign, row ?? null);
}

/**
 * Stores the totals of one read of a campaign's donation ledger, replacing the last read's,
 * and in the same write moves the campaign from `funding` to `funded` when it has a goal and
 * the amount raised reaches it. Both land, or neither does.
 *
 * Safe to repeat: the same totals stored twice leave the same row, and a campaign that is
 * already `funded`, or in any status other than `funding`, is not touched. No status moves
 * backwards, whatever the totals say, and a campaign with no goal is never moved.
 *
 * The condition is the rule in `statusAfterFunding` (@tejido/contracts), written as SQL so it
 * is checked against the row as it is at the moment of the write.
 */
export async function recordFundingTotals(
	db: Database,
	campaignId: string,
	totals: FundingTotals
): Promise<{ becameFunded: boolean }> {
	const { raised, donations, readAt } = fundingTotalsSchema.parse(totals);
	const [, moved] = await db.batch([
		db
			.insert(campaignFunding)
			.values({ campaignId, raised, donations, readAt })
			.onConflictDoUpdate({
				target: campaignFunding.campaignId,
				set: { raised, donations, readAt }
			}),
		db
			.update(campaigns)
			.set({ status: 'funded' })
			.where(
				and(
					eq(campaigns.id, campaignId),
					eq(campaigns.status, 'funding'),
					// NULL is not less than anything, so a campaign without a goal never matches.
					lte(campaigns.fundingGoal, raised)
				)
			)
			.returning({ id: campaigns.id })
	]);
	return { becameFunded: moved.length > 0 };
}

// --- Parties ---

export async function listParties(db: Executor, campaignId: string): Promise<Party[]> {
	return db
		.select()
		.from(parties)
		.where(eq(parties.campaignId, campaignId))
		.orderBy(asc(parties.createdAt));
}

export async function getParty(db: Executor, id: string): Promise<Party | undefined> {
	const [row] = await db.select().from(parties).where(eq(parties.id, id)).limit(1);
	return row;
}

/** A reporter code maps to one party on one campaign. */
export async function findPartyByReporterCode(
	db: Executor,
	reporterCode: string
): Promise<Party | undefined> {
	const [row] = await db
		.select()
		.from(parties)
		.where(eq(parties.reporterCode, reporterCode))
		.limit(1);
	return row;
}

/**
 * Stores the two wallet hostnames from a party's Qatom sign-in. The parameter types are
 * branded, so the two cannot be swapped by accident.
 */
export async function linkPartyWallets(
	db: Executor,
	partyId: string,
	wallets: {
		agentWalletHostname: AgentWalletHostname;
		primaryWalletHostname: PrimaryWalletHostname;
	}
): Promise<void> {
	await db
		.update(parties)
		.set({
			agentWalletHostname: wallets.agentWalletHostname,
			primaryWalletHostname: wallets.primaryWalletHostname
		})
		.where(eq(parties.id, partyId));
}

/**
 * Records how a party relates to the project, with the organiser's reason. Both values replace
 * what was stored. Null clears one: a null relationship is "not recorded", never `independent`.
 */
export async function setPartyRelationship(
	db: Executor,
	partyId: string,
	recorded: Pick<Party, 'relationship' | 'relationshipReason'>
): Promise<void> {
	const { relationship, relationshipReason } = partySchema
		.pick({ relationship: true, relationshipReason: true })
		.parse(recorded);
	await db.update(parties).set({ relationship, relationshipReason }).where(eq(parties.id, partyId));
}

// --- Sign-in tokens (sealed) ---

/**
 * A party's Qatom sign-in tokens as the database holds them: sealed.
 *
 * `sealedTokens` is an opaque string. Sealing (encrypting with a key derived from
 * SESSION_SECRET) and unsealing are the App's job, in its own server code. Nothing in this
 * package can read a token, and none of these functions may be given one in the clear.
 */
export interface SealedSignInTokens {
	partyId: string;
	/** Already sealed by the caller. Never a token, and never JSON holding one. */
	sealedTokens: string;
	updatedAt: Timestamp;
}

/**
 * Saves a party's sealed sign-in tokens. A party has one row: a later save replaces the
 * earlier one. The caller seals the tokens first; this stores the string as given.
 */
export async function saveSealedSignInTokens(
	db: Executor,
	record: SealedSignInTokens
): Promise<void> {
	await db
		.insert(partySignInTokens)
		.values(record)
		.onConflictDoUpdate({
			target: partySignInTokens.partyId,
			set: { sealedTokens: record.sealedTokens, updatedAt: record.updatedAt }
		});
}

/** A party's sealed sign-in tokens, still sealed. The caller unseals them. */
export async function readSealedSignInTokens(
	db: Executor,
	partyId: string
): Promise<SealedSignInTokens | undefined> {
	const [row] = await db
		.select()
		.from(partySignInTokens)
		.where(eq(partySignInTokens.partyId, partyId))
		.limit(1);
	return row;
}

/** Forgets a party's sealed sign-in tokens. Answers whether there was a row to delete. */
export async function deleteSealedSignInTokens(db: Executor, partyId: string): Promise<boolean> {
	const deleted = await db
		.delete(partySignInTokens)
		.where(eq(partySignInTokens.partyId, partyId))
		.returning({ partyId: partySignInTokens.partyId });
	return deleted.length > 0;
}

// --- Milestones ---

export async function listMilestones(db: Executor, campaignId: string): Promise<Milestone[]> {
	return db
		.select()
		.from(milestones)
		.where(eq(milestones.campaignId, campaignId))
		.orderBy(asc(milestones.position));
}

/** A milestone id is unique within its campaign only, so both are needed to find one. */
export async function getMilestone(
	db: Executor,
	campaignId: string,
	milestoneId: string
): Promise<Milestone | undefined> {
	const [row] = await db
		.select()
		.from(milestones)
		.where(and(eq(milestones.campaignId, campaignId), eq(milestones.id, milestoneId)))
		.limit(1);
	return row;
}

// --- Entries and deposits ---

/** A campaign's entries, newest first. */
export async function listEntries(db: Executor, campaignId: string): Promise<Entry[]> {
	const rows = await db
		.select()
		.from(entries)
		.where(eq(entries.campaignId, campaignId))
		.orderBy(desc(entries.filedAt));
	return rows.map(toEntry);
}

export async function getEntry(db: Executor, id: string): Promise<Entry | undefined> {
	const [row] = await db.select().from(entries).where(eq(entries.id, id)).limit(1);
	return row && toEntry(row);
}

/** The deposits paid on a campaign's entries. */
export async function listDeposits(db: Executor, campaignId: string): Promise<Deposit[]> {
	return db
		.select({
			id: deposits.id,
			entryId: deposits.entryId,
			amount: deposits.amount,
			refundedAt: deposits.refundedAt
		})
		.from(deposits)
		.innerJoin(entries, eq(entries.id, deposits.entryId))
		.where(eq(entries.campaignId, campaignId));
}

/** Saves an entry together with the deposit paid on it. Both are written, or neither. */
export async function insertEntryWithDeposit(
	db: Database,
	entry: Entry,
	deposit: Deposit,
	purchase: FiledPurchase | null = null
): Promise<void> {
	await db.batch([
		db.insert(entries).values(entry),
		db.insert(deposits).values(deposit),
		...purchaseInsert(db, entry, purchase)
	]);
}

/**
 * The purchase Qatom named when it called us with a filing: its transaction id, and the
 * catalog item it was a purchase of when Qatom said which. Kept beside the entry so the
 * purchase can be looked up at Qatom afterwards.
 */
export interface FiledPurchase {
	transactionId: string;
	catalogItemId: number | null;
}

/** The insert that keeps a filing's purchase, in the same batch as its entry, or nothing. */
function purchaseInsert(db: Database, entry: Entry, purchase: FiledPurchase | null) {
	if (purchase === null) return [];
	return [
		db.insert(entryPurchases).values({
			entryId: entry.id,
			transactionId: purchase.transactionId,
			catalogItemId: purchase.catalogItemId
		})
	];
}

/** The purchase Qatom named with an entry, or undefined when it was filed without one. */
export async function getEntryPurchase(
	db: Executor,
	entryId: string
): Promise<FiledPurchase | undefined> {
	const [row] = await db
		.select({
			transactionId: entryPurchases.transactionId,
			catalogItemId: entryPurchases.catalogItemId
		})
		.from(entryPurchases)
		.where(eq(entryPurchases.entryId, entryId))
		.limit(1);
	return row;
}

/** A milestone moving from one state to the next because of an entry. */
export interface MilestoneAdvance {
	from: MilestoneState;
	to: MilestoneState;
	/** Set when the milestone becomes confirmed. */
	confirmedAt: Timestamp | null;
}

/**
 * Saves an entry and its deposit and, in the same batch, moves the entry's milestone to its
 * next state. All three are written, or none.
 *
 * The milestone moves only if it is still in `advance.from`, so two entries arriving at once
 * cannot both move it. Answers whether this entry was the one that did.
 */
export async function insertEntryAdvancingMilestone(
	db: Database,
	entry: Entry,
	deposit: Deposit,
	advance: MilestoneAdvance,
	purchase: FiledPurchase | null = null
): Promise<boolean> {
	const [, , moved] = await db.batch([
		db.insert(entries).values(entry),
		db.insert(deposits).values(deposit),
		db
			.update(milestones)
			.set({ state: advance.to, confirmedAt: advance.confirmedAt })
			.where(
				and(
					eq(milestones.campaignId, entry.campaignId),
					eq(milestones.id, entry.milestoneId),
					eq(milestones.state, advance.from)
				)
			)
			.returning({ id: milestones.id }),
		...purchaseInsert(db, entry, purchase)
	]);
	return moved.length > 0;
}

// --- Reconciliation ---

/** An entry not yet matched to Qatom's ledger, with what the reconciler needs to match it. */
export interface UnreconciledEntry {
	entry: Entry;
	/** The party the entry's reporter code named. Its agent wallet is the payer we expect. */
	party: Party;
	/** The deposit paid on the entry. */
	depositAmount: Amount;
}

/** A campaign's entries that have no ledger transaction yet, oldest first. */
export async function listUnreconciledEntries(
	db: Executor,
	campaignId: string
): Promise<UnreconciledEntry[]> {
	const rows = await db
		.select({ entry: entries, party: parties, depositAmount: deposits.amount })
		.from(entries)
		.innerJoin(parties, eq(parties.id, entries.partyId))
		.innerJoin(deposits, eq(deposits.entryId, entries.id))
		.where(and(eq(entries.campaignId, campaignId), isNull(entries.twistId)))
		.orderBy(asc(entries.filedAt), asc(entries.id));
	return rows.map((row) => ({ ...row, entry: toEntry(row.entry) }));
}

// D1 allows 100 bound values in one statement.
const TWIST_IDS_PER_QUERY = 90;

/** Which of these ledger transactions already prove an entry, in any campaign. */
export async function listUsedTwistIds(db: Executor, twistIds: string[]): Promise<Set<string>> {
	const used = new Set<string>();
	for (let start = 0; start < twistIds.length; start += TWIST_IDS_PER_QUERY) {
		const rows = await db
			.select({ twistId: entries.twistId })
			.from(entries)
			.where(inArray(entries.twistId, twistIds.slice(start, start + TWIST_IDS_PER_QUERY)));
		for (const row of rows) if (row.twistId !== null) used.add(row.twistId);
	}
	return used;
}

/** What the reconciler records on an entry once it has found the entry's ledger transaction. */
export interface EntryStamp {
	entryId: string;
	twistId: string;
	/** The paying address exactly as the ledger reports it. */
	payingWallet: string;
	/** The ledger's own timestamp for the deposit. */
	stampedAt: Timestamp;
	status: EntryStatus;
	statusReason: string | null;
	updatedAt: Timestamp;
}

/**
 * Records ledger transactions on entries, all in one batch: every stamp is written, or none.
 *
 * A stamp is skipped, not an error, when its entry already has a transaction or its
 * transaction already proves another entry. So one transaction stamps at most one entry, and
 * recording the same stamps twice changes nothing. Answers the ids of the entries it stamped.
 */
export async function stampEntries(db: Database, stamps: EntryStamp[]): Promise<string[]> {
	const stamped = alias(entries, 'stamped');
	const updates = stamps.map((stamp) =>
		db
			.update(entries)
			.set({
				twistId: stamp.twistId,
				payingWallet: stamp.payingWallet,
				stampedAt: stamp.stampedAt,
				status: stamp.status,
				statusReason: stamp.statusReason,
				updatedAt: stamp.updatedAt
			})
			.where(
				and(
					eq(entries.id, stamp.entryId),
					isNull(entries.twistId),
					notExists(
						db
							.select({ found: sql`1` })
							.from(stamped)
							.where(eq(stamped.twistId, stamp.twistId))
					)
				)
			)
			.returning({ id: entries.id })
	);
	const [first, ...rest] = updates;
	if (!first) return [];
	const results = await db.batch([first, ...rest]);
	return results.flatMap((rows) => rows.map((row) => row.id));
}

/** How many work logs a party has filed on a milestone. */
export async function countWorkLogs(
	db: Executor,
	campaignId: string,
	milestoneId: string,
	partyId: string
): Promise<number> {
	const [row] = await db
		.select({ total: count() })
		.from(entries)
		.where(
			and(
				eq(entries.campaignId, campaignId),
				eq(entries.milestoneId, milestoneId),
				eq(entries.partyId, partyId),
				eq(entries.item, 'log_work')
			)
		);
	return row?.total ?? 0;
}

// --- Adding evidence to an incomplete entry ---

/** The entries a party filed that are still `incomplete`, oldest first. */
export async function listIncompleteEntries(db: Executor, partyId: string): Promise<Entry[]> {
	const rows = await db
		.select()
		.from(entries)
		.where(and(eq(entries.partyId, partyId), eq(entries.status, 'incomplete')))
		.orderBy(asc(entries.filedAt), asc(entries.id));
	return rows.map(toEntry);
}

/** Evidence being added to an entry after it was filed. No deposit is paid for this. */
export interface EvidenceAddition {
	/** The entry exactly as it was just read. The write only lands if it has not changed since. */
	entry: Entry;
	/** The files to add, after the ones the entry already has. Checked by the caller. */
	added: Photo[];
	/** True when, with these files, the check-in rules find nothing missing any more. */
	complete: boolean;
	/** What is still missing, in words a donor can read. Used only when `complete` is false. */
	stillMissing: string | null;
	updatedAt: Timestamp;
}

/**
 * Adds evidence to an entry that is `incomplete`, and says where the entry stands afterwards.
 * One statement, so the files and the status change land together or not at all.
 *
 * Only the list of files grows. The files already there keep their place, and nothing else
 * about the entry (its note, times, milestone, party, paying wallet, transaction) can be
 * changed through this function. No deposit is written and no milestone moves.
 *
 * A complete entry gets the status it would have had if it had been filed complete: `filed`
 * while it has no ledger transaction, so the reconciler picks it up as usual, and `verified`
 * if it has one, because the reconciler only leaves a stamped entry `incomplete` when it was
 * paid from the party's registered wallet (otherwise it is `flagged`, and not changed here).
 *
 * Answers the entry's new status. Answers null, and writes nothing, when the entry is not the
 * named party's, is not `incomplete`, or changed after it was read (say, the reconciler
 * stamped it, or evidence was added from another window): read it again and decide again.
 * Throws if the entry would no longer satisfy the contract, e.g. more than ten files.
 */
export async function addEvidenceToIncompleteEntry(
	db: Executor,
	partyId: string,
	addition: EvidenceAddition
): Promise<EntryStatus | null> {
	const { entry, added, complete, updatedAt } = addition;
	if (added.length === 0) throw new RangeError('There is no evidence to add.');

	const status: EntryStatus = !complete
		? 'incomplete'
		: entry.twistId === null
			? 'filed'
			: 'verified';
	const statusReason = complete ? null : addition.stillMissing;
	const inputs = { ...entry.inputs, photos: [...(entry.inputs.photos ?? []), ...added] };
	// What is stored must still be an entry: this is where an eleventh file is turned away.
	entrySchema.parse({ ...entry, inputs, status, statusReason, updatedAt });

	const changed = await db
		.update(entries)
		.set({ inputs, status, statusReason, updatedAt })
		.where(
			and(
				eq(entries.id, entry.id),
				eq(entries.partyId, partyId),
				eq(entries.status, 'incomplete'),
				eq(entries.updatedAt, entry.updatedAt)
			)
		)
		.returning({ id: entries.id });
	return changed.length > 0 ? status : null;
}

// --- Deposit refunds ---
//
// The bookkeeping that makes a refund happen once only. The order is always:
//   1. claimDepositsForRefund  writes the refund as `started` and claims its deposits
//                              (and notes, for good, which deposits it covered)
//   2. the caller sends the transfer (never from this package)
//   3. markRefundSent | markRefundFailed | markRefundUnknown  records what happened
// A deposit claimed by a refund cannot be claimed by another, so nothing is sent twice.

/** One transfer of deposits back to one party for one milestone. */
export type Refund = typeof refunds.$inferSelect;

/**
 * A refund as it is first written. It names exactly one wallet, and which kind it is: the
 * party's PRIMARY wallet, or, for an end-to-end test person only, the agent wallet their
 * deposits were paid from. The table refuses a row with both or neither.
 */
export type NewRefund = Omit<Refund, 'primaryWalletHostname' | 'agentWalletHostname'> &
	(
		| { primaryWalletHostname: PrimaryWalletHostname; agentWalletHostname?: null }
		| { agentWalletHostname: AgentWalletHostname; primaryWalletHostname?: null }
	);

/** A deposit that has not been refunded, with what a refund needs to know about it. */
export interface UnrefundedDeposit {
	deposit: Deposit;
	entry: Pick<Entry, 'id' | 'partyId' | 'item' | 'status' | 'twistId'>;
	/** The refund that has claimed this deposit, if one has: it is `started` or `unknown`. */
	claim: { refundId: string; status: RefundStatus } | null;
}

// D1 allows 100 bound values in one statement. These keep well under it.
const CLAIM_ROWS_PER_INSERT = 40;
const IDS_PER_QUERY = 80;

function chunks<T>(items: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let start = 0; start < items.length; start += size) {
		out.push(items.slice(start, start + size));
	}
	return out;
}

/** The deposits on one milestone's entries that have not been refunded, oldest entry first. */
export async function listUnrefundedDeposits(
	db: Executor,
	campaignId: string,
	milestoneId: string
): Promise<UnrefundedDeposit[]> {
	const rows = await db
		.select({
			id: deposits.id,
			entryId: deposits.entryId,
			amount: deposits.amount,
			refundedAt: deposits.refundedAt,
			partyId: entries.partyId,
			item: entries.item,
			entryStatus: entries.status,
			twistId: entries.twistId,
			refundId: refunds.id,
			refundStatus: refunds.status
		})
		.from(deposits)
		.innerJoin(entries, eq(entries.id, deposits.entryId))
		.leftJoin(refundDeposits, eq(refundDeposits.depositId, deposits.id))
		.leftJoin(refunds, eq(refunds.id, refundDeposits.refundId))
		.where(
			and(
				eq(entries.campaignId, campaignId),
				eq(entries.milestoneId, milestoneId),
				isNull(deposits.refundedAt)
			)
		)
		.orderBy(asc(entries.filedAt), asc(deposits.id));

	return rows.map((row) => ({
		deposit: {
			id: row.id,
			entryId: row.entryId,
			amount: row.amount,
			refundedAt: row.refundedAt
		},
		entry: {
			id: row.entryId,
			partyId: row.partyId,
			item: row.item,
			status: row.entryStatus,
			twistId: row.twistId
		},
		claim:
			row.refundId !== null && row.refundStatus !== null
				? { refundId: row.refundId, status: row.refundStatus }
				: null
	}));
}

/**
 * A deposit not yet refunded, with the party who filed its entry, whether its milestone is
 * confirmed and when the entry was filed. What the automatic refund pass for the end-to-end
 * test people starts from: it decides, from these, which deposits are due.
 */
export interface UnrefundedDepositWithFiler extends UnrefundedDeposit {
	campaignId: string;
	milestoneId: string;
	/** True when the entry's own milestone is confirmed, by anyone. */
	milestoneConfirmed: boolean;
	/** When the entry was filed: the moment we saved it. */
	filedAt: Timestamp;
	party: Pick<Party, 'id' | 'name' | 'email' | 'agentWalletHostname'>;
	/**
	 * The commodity id of the item the entry was filed with, as its campaign stores it. Null
	 * when the campaign stores none of its own: the caller then reads the shared item.
	 */
	commodityId: number | null;
	/** True when any refund has ever covered this deposit, whatever came of it. */
	attempted: boolean;
}

/**
 * Every unrefunded deposit, in any campaign and on any milestone, confirmed or not, whose
 * filer's email is at `emailDomain` (compared without regard to letter case), oldest entry
 * first.
 *
 * The domain here only keeps the list short. It decides nothing about who may be refunded,
 * how or when: the caller asks `isEndToEndTestEmail` in @tejido/qatom about every row it is
 * given, and decides from `milestoneConfirmed` and `filedAt` which deposits are due.
 */
export async function listUnrefundedDepositsByEmailDomain(
	db: Executor,
	emailDomain: string
): Promise<UnrefundedDepositWithFiler[]> {
	const suffix = `@${emailDomain.toLowerCase()}`;
	const rows = await db
		.select({
			id: deposits.id,
			entryId: deposits.entryId,
			amount: deposits.amount,
			refundedAt: deposits.refundedAt,
			campaignId: entries.campaignId,
			milestoneId: entries.milestoneId,
			milestoneState: milestones.state,
			filedAt: entries.filedAt,
			partyId: entries.partyId,
			item: entries.item,
			entryStatus: entries.status,
			twistId: entries.twistId,
			partyName: parties.name,
			email: parties.email,
			agentWalletHostname: parties.agentWalletHostname,
			logWorkCommodityId: campaigns.logWorkCommodityId,
			milestoneHitCommodityId: campaigns.milestoneHitCommodityId,
			refundId: refunds.id,
			refundStatus: refunds.status,
			attempts: sql<number>`(select count(*) from ${refundAttempts} where ${refundAttempts.depositId} = ${deposits.id})`
		})
		.from(deposits)
		.innerJoin(entries, eq(entries.id, deposits.entryId))
		.innerJoin(
			milestones,
			and(eq(milestones.campaignId, entries.campaignId), eq(milestones.id, entries.milestoneId))
		)
		.innerJoin(campaigns, eq(campaigns.id, entries.campaignId))
		.innerJoin(parties, eq(parties.id, entries.partyId))
		.leftJoin(refundDeposits, eq(refundDeposits.depositId, deposits.id))
		.leftJoin(refunds, eq(refunds.id, refundDeposits.refundId))
		.where(
			and(
				isNull(deposits.refundedAt),
				sql`lower(substr(${parties.email}, ${-suffix.length})) = ${suffix}`
			)
		)
		.orderBy(asc(entries.filedAt), asc(deposits.id));

	return rows.map((row) => ({
		campaignId: row.campaignId,
		milestoneId: row.milestoneId,
		milestoneConfirmed:
			row.milestoneState === 'confirmed_independent' || row.milestoneState === 'confirmed_creator',
		filedAt: row.filedAt,
		deposit: {
			id: row.id,
			entryId: row.entryId,
			amount: row.amount,
			refundedAt: row.refundedAt
		},
		entry: {
			id: row.entryId,
			partyId: row.partyId,
			item: row.item,
			status: row.entryStatus,
			twistId: row.twistId
		},
		party: {
			id: row.partyId,
			name: row.partyName,
			email: row.email,
			agentWalletHostname: row.agentWalletHostname
		},
		commodityId: row.item === 'log_work' ? row.logWorkCommodityId : row.milestoneHitCommodityId,
		claim:
			row.refundId !== null && row.refundStatus !== null
				? { refundId: row.refundId, status: row.refundStatus }
				: null,
		attempted: row.attempts > 0
	}));
}

/**
 * Step 1 of a refund: writes the refund and claims its deposits, all or nothing. Call it
 * BEFORE sending the transfer, with `refund.status` set to `started`.
 *
 * Answers false, and writes nothing, if any of the deposits is already claimed by another
 * refund. That is how two requests running at once are kept from both sending.
 */
export async function claimDepositsForRefund(
	db: Database,
	refund: NewRefund,
	depositIds: string[]
): Promise<boolean> {
	if (depositIds.length === 0) throw new RangeError('A refund must cover at least one deposit.');
	if (refund.status !== 'started') throw new RangeError('A refund begins as started.');

	const claims = chunks(depositIds, CLAIM_ROWS_PER_INSERT).map((ids) =>
		db.insert(refundDeposits).values(ids.map((depositId) => ({ depositId, refundId: refund.id })))
	);
	// The lasting record that this refund covered these deposits. Unlike the claims it is
	// never removed, so a refused refund can still be told apart from one never tried. It is
	// written in the same batch: with the claim or not at all.
	const attempts = chunks(depositIds, CLAIM_ROWS_PER_INSERT).map((ids) =>
		db.insert(refundAttempts).values(ids.map((depositId) => ({ depositId, refundId: refund.id })))
	);
	try {
		await db.batch([db.insert(refunds).values(refund), ...claims, ...attempts]);
		return true;
	} catch (error) {
		// The batch wrote nothing. If another refund holds one of these deposits, that is why.
		for (const ids of chunks(depositIds, IDS_PER_QUERY)) {
			const [taken] = await db
				.select({ depositId: refundDeposits.depositId })
				.from(refundDeposits)
				.where(inArray(refundDeposits.depositId, ids))
				.limit(1);
			if (taken) return false;
		}
		throw error;
	}
}

/**
 * Step 3, when Qatom accepted the transfer: the refund becomes `sent` and its deposits get
 * `refundedAt`, together. Only a `started` refund can be marked. Answers whether it was.
 */
export async function markRefundSent(
	db: Database,
	refundId: string,
	at: Timestamp
): Promise<boolean> {
	const [marked] = await db.batch([
		db
			.update(refunds)
			.set({ status: 'sent', settledAt: at })
			.where(and(eq(refunds.id, refundId), eq(refunds.status, 'started')))
			.returning({ id: refunds.id }),
		// Runs after the update above, in the same transaction: it only finds a `sent` refund.
		db
			.update(deposits)
			.set({ refundedAt: at })
			.where(
				and(
					isNull(deposits.refundedAt),
					inArray(
						deposits.id,
						db
							.select({ depositId: refundDeposits.depositId })
							.from(refundDeposits)
							.innerJoin(refunds, eq(refunds.id, refundDeposits.refundId))
							.where(and(eq(refunds.id, refundId), eq(refunds.status, 'sent')))
					)
				)
			)
	]);
	return marked.length > 0;
}

/**
 * Step 3, when Qatom refused the transfer and NOTHING MOVED: the refund becomes `failed` and
 * its deposits are released, so a later request may refund them. Never call this after a
 * timeout or any other failure whose outcome is not known; use markRefundUnknown.
 */
export async function markRefundFailed(
	db: Database,
	refundId: string,
	reason: string,
	at: Timestamp
): Promise<boolean> {
	const [marked] = await db.batch([
		db
			.update(refunds)
			.set({ status: 'failed', statusReason: reason, settledAt: at })
			.where(and(eq(refunds.id, refundId), eq(refunds.status, 'started')))
			.returning({ id: refunds.id }),
		db.delete(refundDeposits).where(
			inArray(
				refundDeposits.refundId,
				db
					.select({ id: refunds.id })
					.from(refunds)
					.where(and(eq(refunds.id, refundId), eq(refunds.status, 'failed')))
			)
		)
	]);
	return marked.length > 0;
}

/**
 * Step 3, when the transfer's outcome is not known: the refund becomes `unknown` and KEEPS
 * its deposits, so no code will send them again. A person checks the wallet and settles it.
 */
export async function markRefundUnknown(
	db: Executor,
	refundId: string,
	reason: string
): Promise<boolean> {
	const marked = await db
		.update(refunds)
		.set({ status: 'unknown', statusReason: reason })
		.where(and(eq(refunds.id, refundId), eq(refunds.status, 'started')))
		.returning({ id: refunds.id });
	return marked.length > 0;
}

/** Every refund attempted for one milestone, oldest first. */
export async function listRefunds(
	db: Executor,
	campaignId: string,
	milestoneId: string
): Promise<Refund[]> {
	return db
		.select()
		.from(refunds)
		.where(and(eq(refunds.campaignId, campaignId), eq(refunds.milestoneId, milestoneId)))
		.orderBy(asc(refunds.startedAt), asc(refunds.id));
}

// --- Deposit states ---

/** Deposits with their states, and their amounts added up by state. */
export interface DepositSummary {
	/** Oldest entry first. */
	deposits: DepositStatus[];
	/** In the unit of `Deposit.amount`. See money.ts in @tejido/contracts. */
	totals: DepositTotals;
}

/**
 * Every deposit paid on a campaign's entries, each with its state (`held`, `refunded` or
 * `refund_outstanding`), why a refund is outstanding, and the totals by state. Pass `only` to
 * narrow it to one milestone or one entry of that campaign.
 *
 * The state is worked out by `deriveDepositState` in @tejido/contracts from what is recorded
 * here: the deposit, its entry, its milestone, whether the filer has a primary wallet, and
 * every refund that has covered the deposit. Pages read this instead of working it out again.
 * Nothing is asked of Qatom, and nothing is written.
 */
export async function listDepositStatuses(
	db: Executor,
	campaignId: string,
	only: { milestoneId?: string; entryId?: string } = {}
): Promise<DepositSummary> {
	const scope = and(
		eq(entries.campaignId, campaignId),
		only.milestoneId === undefined ? undefined : eq(entries.milestoneId, only.milestoneId),
		only.entryId === undefined ? undefined : eq(entries.id, only.entryId)
	);
	const covering = {
		depositId: deposits.id,
		refundId: refunds.id,
		status: refunds.status,
		startedAt: refunds.startedAt
	};

	const [rows, held, tried] = await Promise.all([
		db
			.select({
				id: deposits.id,
				entryId: deposits.entryId,
				amount: deposits.amount,
				refundedAt: deposits.refundedAt,
				milestoneId: entries.milestoneId,
				partyId: entries.partyId,
				entryStatus: entries.status,
				twistId: entries.twistId,
				milestoneState: milestones.state,
				primaryWalletHostname: parties.primaryWalletHostname
			})
			.from(deposits)
			.innerJoin(entries, eq(entries.id, deposits.entryId))
			.innerJoin(
				milestones,
				and(eq(milestones.campaignId, entries.campaignId), eq(milestones.id, entries.milestoneId))
			)
			.innerJoin(parties, eq(parties.id, entries.partyId))
			.where(scope)
			.orderBy(asc(entries.filedAt), asc(deposits.id)),
		// The refund holding each deposit now, if one does. This is what decides what may be
		// sent, so it is read even where the history below should already have it.
		db
			.select(covering)
			.from(refundDeposits)
			.innerJoin(refunds, eq(refunds.id, refundDeposits.refundId))
			.innerJoin(deposits, eq(deposits.id, refundDeposits.depositId))
			.innerJoin(entries, eq(entries.id, deposits.entryId))
			.where(scope),
		// Every refund that ever covered each deposit, refused ones included.
		db
			.select(covering)
			.from(refundAttempts)
			.innerJoin(refunds, eq(refunds.id, refundAttempts.refundId))
			.innerJoin(deposits, eq(deposits.id, refundAttempts.depositId))
			.innerJoin(entries, eq(entries.id, deposits.entryId))
			.where(scope)
	]);

	// One refund counts once per deposit, whichever of the two tables it was found in.
	const refundsByDeposit = new Map<string, Map<string, Pick<Refund, 'status' | 'startedAt'>>>();
	for (const { depositId, refundId, status, startedAt } of [...held, ...tried]) {
		const found = refundsByDeposit.get(depositId) ?? new Map();
		found.set(refundId, { status, startedAt });
		refundsByDeposit.set(depositId, found);
	}

	const statuses = rows.map((row) =>
		describeDeposit(
			{ id: row.id, entryId: row.entryId, amount: row.amount, refundedAt: row.refundedAt },
			{ campaignId, milestoneId: row.milestoneId, partyId: row.partyId },
			{
				milestone: { state: row.milestoneState },
				entry: { status: row.entryStatus, twistId: row.twistId },
				filerHasPrimaryWallet: row.primaryWalletHostname !== null,
				refunds: [...(refundsByDeposit.get(row.id)?.values() ?? [])]
			}
		)
	);
	return { deposits: statuses, totals: totalDeposits(statuses) };
}

// --- Item provisioning ---

export type ItemProvisioning = typeof itemProvisioning.$inferSelect;

/** What one step of creating an item learned from Qatom. */
export type ItemProvisioningProgress = Partial<
	Pick<
		ItemProvisioning,
		'twinId' | 'twinHostname' | 'commodityHash' | 'commodityId' | 'catalogItemId'
	>
>;

const provisioningRow = (campaignId: string, item: EntryItem) =>
	and(eq(itemProvisioning.campaignId, campaignId), eq(itemProvisioning.item, item));

/**
 * Takes the lease on one campaign's item until `lockedUntil`, and answers the row with the
 * progress saved so far. Answers undefined when another run holds a lease that has not run
 * out: the caller must then not call Qatom for this item.
 *
 * The lease is taken by one conditional update, so of two requests arriving together only
 * one gets the row back.
 */
export async function claimItemProvisioning(
	db: Database,
	campaignId: string,
	item: EntryItem,
	now: Timestamp,
	lockedUntil: Timestamp
): Promise<ItemProvisioning | undefined> {
	await db
		.insert(itemProvisioning)
		.values({ campaignId, item, updatedAt: now })
		.onConflictDoNothing();
	const [row] = await db
		.update(itemProvisioning)
		.set({ lockedUntil, updatedAt: now })
		.where(
			and(
				provisioningRow(campaignId, item),
				or(isNull(itemProvisioning.lockedUntil), lt(itemProvisioning.lockedUntil, now))
			)
		)
		.returning();
	return row;
}

/** Saves what a step learned, straight after Qatom answered it. */
export async function saveItemProvisioningProgress(
	db: Database,
	campaignId: string,
	item: EntryItem,
	progress: ItemProvisioningProgress,
	now: Timestamp
): Promise<void> {
	await db
		.update(itemProvisioning)
		.set({ ...progress, updatedAt: now })
		.where(provisioningRow(campaignId, item));
}

/** Gives the lease back, so the item can be tried again at once. */
export async function releaseItemProvisioning(
	db: Database,
	campaignId: string,
	item: EntryItem,
	now: Timestamp
): Promise<void> {
	await db
		.update(itemProvisioning)
		.set({ lockedUntil: null, updatedAt: now })
		.where(provisioningRow(campaignId, item));
}

/**
 * The last step: stores the item's commodity id on the campaign and gives the lease back,
 * together. A commodity id already on the campaign is never replaced.
 */
export async function finishItemProvisioning(
	db: Database,
	campaignId: string,
	item: EntryItem,
	commodityId: number,
	now: Timestamp
): Promise<void> {
	const column =
		item === 'log_work' ? campaigns.logWorkCommodityId : campaigns.milestoneHitCommodityId;
	const value =
		item === 'log_work'
			? { logWorkCommodityId: commodityId }
			: { milestoneHitCommodityId: commodityId };
	await db.batch([
		db
			.update(campaigns)
			.set(value)
			.where(and(eq(campaigns.id, campaignId), isNull(column))),
		db
			.update(itemProvisioning)
			.set({ lockedUntil: null, updatedAt: now })
			.where(provisioningRow(campaignId, item))
	]);
}

// --- Evidence files: who uploaded each one, and who may see it ---
//
// A file is `public` unless its uploader said otherwise. A file with no row at all was
// uploaded before rows were kept; it is public, and nobody is on record as its uploader.

export async function getEvidenceFile(
	db: Executor,
	sha256: string
): Promise<EvidenceFileRecord | undefined> {
	const [row] = await db
		.select()
		.from(evidenceFiles)
		.where(eq(evidenceFiles.sha256, sha256))
		.limit(1);
	return row;
}

/**
 * Which of these files are marked not public, with what their uploader says about each. Pass
 * the answer to `evidenceFileStates` (@tejido/contracts) and to `decideCheckin`.
 */
export async function listNotPublicEvidence(
	db: Executor,
	sha256s: readonly string[]
): Promise<Map<string, EvidenceNotPublic>> {
	const found = new Map<string, EvidenceNotPublic>();
	for (const some of chunks([...new Set(sha256s)], 50)) {
		const rows = await db
			.select()
			.from(evidenceFiles)
			.where(and(inArray(evidenceFiles.sha256, some), eq(evidenceFiles.visibility, 'not_public')));
		for (const row of rows) {
			// A not-public row always carries both. If one is missing the file stays hidden.
			found.set(row.sha256, { kind: row.notPublicKind ?? '', reason: row.notPublicReason ?? '' });
		}
	}
	return found;
}

/** What an uploader asks for: public, or not public with what donors are told instead. */
export type EvidenceVisibilityChoice =
	{ visibility: 'public' } | ({ visibility: 'not_public' } & EvidenceNotPublic);

export interface EvidenceUpload {
	sha256: string;
	/** The signed-in party uploading the file. */
	partyId: string;
	/** Null when the uploader did not say: a new file is public, a known file stays as it is. */
	choice: EvidenceVisibilityChoice | null;
	/** True when the evidence store already held these bytes before this upload. */
	alreadyStored: boolean;
	now: Timestamp;
}

export type EvidenceUploadOutcome =
	| { accepted: true; visibility: EvidenceVisibility }
	/** The choice would change a file that is someone else's to decide. Nothing was changed. */
	| { accepted: false; why: 'not_the_uploader' };

/**
 * Records an upload and applies the uploader's choice of who may see the file.
 *
 * Only a file's uploader decides its visibility, in either direction:
 *
 * - A file nobody has uploaded before is recorded as this party's, with their choice.
 * - The uploader sending the same bytes again changes the visibility only by saying so. Sent
 *   again with no choice, a not-public file stays not public.
 * - Anyone else sending the same bytes changes nothing. If they asked for something the file
 *   is not, the upload is turned away.
 * - A file stored before rows were kept has no uploader on record. It stays public, and no
 *   row is written, unless someone asks for not public: that is allowed when no entry names
 *   the file, or one of the asking party's own entries does. They become its uploader.
 */
export async function recordEvidenceUpload(
	db: Executor,
	upload: EvidenceUpload
): Promise<EvidenceUploadOutcome> {
	const { sha256, partyId, choice, now } = upload;
	const chosen = {
		visibility: choice?.visibility ?? ('public' as const),
		notPublicKind: choice?.visibility === 'not_public' ? choice.kind : null,
		notPublicReason: choice?.visibility === 'not_public' ? choice.reason : null
	};

	let existing = await getEvidenceFile(db, sha256);
	if (!existing) {
		if (upload.alreadyStored) {
			if (chosen.visibility === 'public') return { accepted: true, visibility: 'public' };
			const filers = await listPartiesNamingEvidence(db, sha256);
			if (filers.length > 0 && !filers.includes(partyId)) {
				return { accepted: false, why: 'not_the_uploader' };
			}
		}
		const inserted = await db
			.insert(evidenceFiles)
			.values({ sha256, uploadedByPartyId: partyId, ...chosen, createdAt: now, updatedAt: now })
			.onConflictDoNothing()
			.returning({ sha256: evidenceFiles.sha256 });
		if (inserted.length > 0) return { accepted: true, visibility: chosen.visibility };
		// Someone recorded the same bytes in the meantime. Decide again against their row.
		existing = await getEvidenceFile(db, sha256);
		if (!existing) throw new Error('An evidence file could be neither recorded nor read.');
	}

	if (choice === null) return { accepted: true, visibility: existing.visibility };
	if (existing.uploadedByPartyId !== partyId) {
		return choice.visibility === existing.visibility
			? { accepted: true, visibility: existing.visibility }
			: { accepted: false, why: 'not_the_uploader' };
	}

	const changed = await db
		.update(evidenceFiles)
		.set({ ...chosen, updatedAt: now })
		.where(and(eq(evidenceFiles.sha256, sha256), eq(evidenceFiles.uploadedByPartyId, partyId)))
		.returning({ sha256: evidenceFiles.sha256 });
	if (changed.length === 0) return { accepted: false, why: 'not_the_uploader' };
	return { accepted: true, visibility: chosen.visibility };
}

/** The parties who have filed an entry naming this file, by its SHA-256. */
async function listPartiesNamingEvidence(db: Executor, sha256: string): Promise<string[]> {
	if (!/^[0-9a-f]{64}$/.test(sha256)) throw new RangeError('Not a SHA-256.');
	const rows = await db
		.selectDistinct({ partyId: entries.partyId })
		.from(entries)
		// `inputs` is stored as JSON text, and a file's hash appears in it wherever the file is
		// named. `instr`, not LIKE: D1 refuses a LIKE pattern longer than 50 bytes.
		.where(sql`instr(${entries.inputs}, ${sha256}) > 0`);
	return rows.map((row) => row.partyId);
}

/**
 * - `public`: anyone may fetch the file.
 * - `allowed`: the file is not public, and this viewer is one of the few who may fetch it.
 * - `refused`: the file is not public, and this viewer may not fetch it.
 */
export type EvidenceAccess = 'public' | 'allowed' | 'refused';

/**
 * Whether a viewer may fetch a stored file. A not-public file may be fetched by the party who
 * uploaded it, and by a party named as the confirmer of any milestone in that uploader's
 * campaign. By nobody else: not another third party on the campaign, not a party of another
 * campaign, not someone signed in without a party, and not someone who is not signed in.
 *
 * @param viewerPartyId the party the viewer is signed in as, or null.
 */
export async function evidenceAccess(
	db: Executor,
	sha256: string,
	viewerPartyId: string | null
): Promise<EvidenceAccess> {
	const file = await getEvidenceFile(db, sha256);
	if (!file || file.visibility === 'public') return 'public';
	if (viewerPartyId === null) return 'refused';
	if (viewerPartyId === file.uploadedByPartyId) return 'allowed';

	// A milestone's confirmer must be a party of the same campaign as the uploader: the
	// milestone is looked up in the uploader's campaign, and a party belongs to one campaign.
	const [confirms] = await db
		.select({ id: milestones.id })
		.from(milestones)
		.innerJoin(parties, eq(parties.campaignId, milestones.campaignId))
		.where(
			and(eq(parties.id, file.uploadedByPartyId), eq(milestones.confirmerPartyId, viewerPartyId))
		)
		.limit(1);
	return confirms ? 'allowed' : 'refused';
}
