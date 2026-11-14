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
import { and, asc, count, desc, eq } from 'drizzle-orm';
import type { Database, Executor } from './client.ts';
import { campaigns, deposits, entries, milestones, parties } from './schema.ts';

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
