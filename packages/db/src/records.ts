/**
 * Reading and writing the records in @tejido/contracts.
 *
 * These are the queries the foundation needs. Add to them freely: a query that returns a
 * contract type belongs here, next to the others, so pages and jobs share it.
 */
import {
	entrySchema,
	type AgentWalletHostname,
	type Campaign,
	type Deposit,
	type Entry,
	type Milestone,
	type MilestoneState,
	type Party,
	type PrimaryWalletHostname,
	type Timestamp
} from '@tejido/contracts';
import { and, asc, count, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database, Executor } from './client.ts';
import {
	campaigns,
	deposits,
	entries,
	milestones,
	parties,
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
	deposit: Deposit
): Promise<void> {
	await db.batch([db.insert(entries).values(entry), db.insert(deposits).values(deposit)]);
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
	advance: MilestoneAdvance
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
			.returning({ id: milestones.id })
	]);
	return moved.length > 0;
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

// --- Deposit refunds ---
//
// The bookkeeping that makes a refund happen once only. The order is always:
//   1. claimDepositsForRefund  writes the refund as `started` and claims its deposits
//   2. the caller sends the transfer (never from this package)
//   3. markRefundSent | markRefundFailed | markRefundUnknown  records what happened
// A deposit claimed by a refund cannot be claimed by another, so nothing is sent twice.

/** One transfer of deposits back to one party for one milestone. */
export type Refund = typeof refunds.$inferSelect;

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
 * Step 1 of a refund: writes the refund and claims its deposits, all or nothing. Call it
 * BEFORE sending the transfer, with `refund.status` set to `started`.
 *
 * Answers false, and writes nothing, if any of the deposits is already claimed by another
 * refund. That is how two requests running at once are kept from both sending.
 */
export async function claimDepositsForRefund(
	db: Database,
	refund: Refund,
	depositIds: string[]
): Promise<boolean> {
	if (depositIds.length === 0) throw new RangeError('A refund must cover at least one deposit.');
	if (refund.status !== 'started') throw new RangeError('A refund begins as started.');

	const claims = chunks(depositIds, CLAIM_ROWS_PER_INSERT).map((ids) =>
		db.insert(refundDeposits).values(ids.map((depositId) => ({ depositId, refundId: refund.id })))
	);
	try {
		await db.batch([db.insert(refunds).values(refund), ...claims]);
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
