/**
 * Undoing a donation the automatic paid tests made. FOR THE END-TO-END TEST PEOPLE ONLY
 * (CLAUDE.md, "Qatom": the one exception, the owner's decision of 15 November 2026).
 *
 * This file only reads and writes Tejido's own database. It sends nothing: the transfer is
 * the backend's (test-donation-undos.ts), through @tejido/qatom. The order is the same as a
 * deposit refund's:
 *   1. claimDonationUndo        writes the undo as `started`, tied to its donation and to
 *                               the ledger payment, BEFORE the transfer
 *   2. the caller sends the transfer, once
 *   3. markDonationUndoSent | markDonationUndoFailed | markDonationUndoUnknown
 * A donation or a ledger payment that any undo has ever named cannot be claimed again.
 */
import type { AgentWalletHostname, Amount, PrimaryWalletHostname } from '@tejido/contracts';
import { and, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { Database, Executor } from './client.ts';
import { campaigns, donations, donationUndos, parties, type RefundStatus } from './schema.ts';

export type DonationUndo = typeof donationUndos.$inferSelect;

/** A recorded donation to a campaign whose creator's email is at one domain. */
export interface DonationOfCreatorDomain {
	donationId: string;
	campaignId: string;
	/** The campaign's creator's email. THE CALLER DECIDES from it; the query only shortens the list. */
	creatorEmail: string;
	amount: Amount;
	receivedAt: string;
	/** Where its undo stands, or null when none was ever started. Never `sent`: those are left out. */
	undoStatus: Exclude<RefundStatus, 'sent'> | null;
}

/**
 * The donations, oldest first, that reached us at or after `receivedSince`, to campaigns
 * whose creator's email ends in `@<emailDomain>` (compared without regard to letter case),
 * and whose undo is not `sent`. The domain match here only shortens the list: an address can
 * end that way and still not be at the domain, so the caller must decide for each row.
 */
export async function listDonationsToUndoByCreatorEmailDomain(
	db: Executor,
	emailDomain: string,
	receivedSince: string
): Promise<DonationOfCreatorDomain[]> {
	const suffix = `@${emailDomain.toLowerCase()}`;
	const rows = await db
		.select({
			donationId: donations.id,
			campaignId: donations.campaignId,
			creatorEmail: campaigns.creatorEmail,
			amount: donations.amount,
			receivedAt: donations.receivedAt,
			undoStatus: donationUndos.status
		})
		.from(donations)
		.innerJoin(campaigns, eq(campaigns.id, donations.campaignId))
		.leftJoin(donationUndos, eq(donationUndos.donationId, donations.id))
		.where(
			and(
				gte(donations.receivedAt, receivedSince),
				// The end of the address, not LIKE: `_` and `%` in a domain would be wildcards.
				sql`substr(lower(${campaigns.creatorEmail}), ${-suffix.length}) = ${suffix}`
			)
		)
		.orderBy(donations.receivedAt, donations.id);
	return rows.flatMap((row) =>
		row.undoStatus === 'sent' ? [] : [{ ...row, undoStatus: row.undoStatus }]
	);
}

/**
 * Every recorded donation of exactly `amount`, to ANY campaign, that reached us between the
 * two times (both included), and whether an undo has ever been started for it. Used to see
 * whether a ledger payment could belong to more than one donation.
 */
export async function listDonationsOfAmountBetween(
	db: Executor,
	amount: Amount,
	from: string,
	to: string
): Promise<{ donationId: string; receivedAt: string; hasUndo: boolean }[]> {
	const rows = await db
		.select({
			donationId: donations.id,
			receivedAt: donations.receivedAt,
			undoOf: donationUndos.donationId
		})
		.from(donations)
		.leftJoin(donationUndos, eq(donationUndos.donationId, donations.id))
		.where(
			and(
				eq(donations.amount, amount),
				gte(donations.receivedAt, from),
				lte(donations.receivedAt, to)
			)
		)
		.orderBy(donations.receivedAt, donations.id);
	return rows.map(({ donationId, receivedAt, undoOf }) => ({
		donationId,
		receivedAt,
		hasUndo: undoOf !== null
	}));
}

// D1 allows 100 bound values in one statement. This keeps well under it.
const IDS_PER_QUERY = 80;

/** Which of these ledger payment ids an undo has ever named, whatever became of it. */
export async function listUndoneTwistIds(db: Executor, twistIds: string[]): Promise<Set<string>> {
	const used = new Set<string>();
	for (let start = 0; start < twistIds.length; start += IDS_PER_QUERY) {
		const rows = await db
			.select({ twistId: donationUndos.twistId })
			.from(donationUndos)
			.where(inArray(donationUndos.twistId, twistIds.slice(start, start + IDS_PER_QUERY)));
		for (const { twistId } of rows) used.add(twistId);
	}
	return used;
}

/** A party one wallet hostname is registered to, and as which of their two wallets. */
export type PartyOfWallet = { email: string } & (
	| { primaryWalletHostname: PrimaryWalletHostname; agentWalletHostname?: undefined }
	| { agentWalletHostname: AgentWalletHostname; primaryWalletHostname?: undefined }
);

/**
 * EVERY party, on any campaign, that this hostname is registered to in Tejido's own
 * database, as their primary or as their agent wallet. The hostname in each answer is the
 * party's own stored value, not the one asked about.
 */
export async function listPartiesByWalletHostname(
	db: Executor,
	hostname: string
): Promise<PartyOfWallet[]> {
	const rows = await db
		.select({
			email: parties.email,
			primaryWalletHostname: parties.primaryWalletHostname,
			agentWalletHostname: parties.agentWalletHostname
		})
		.from(parties)
		.where(
			or(eq(parties.primaryWalletHostname, hostname), eq(parties.agentWalletHostname, hostname))
		)
		.orderBy(parties.id);
	const found: PartyOfWallet[] = [];
	for (const { email, primaryWalletHostname, agentWalletHostname } of rows) {
		if (primaryWalletHostname !== null && primaryWalletHostname === hostname) {
			found.push({ email, primaryWalletHostname });
		}
		if (agentWalletHostname !== null && agentWalletHostname === hostname) {
			found.push({ email, agentWalletHostname });
		}
	}
	return found;
}

/**
 * STARTED, before the transfer: writes the undo of one donation, naming the ledger payment
 * that is about to be sent back. Answers false, having written nothing, when an undo already
 * names this donation or this payment (another request got there first, or an earlier pass
 * did): the caller must then send nothing.
 */
export async function claimDonationUndo(
	db: Database,
	undo: { donationId: string; twistId: string; amount: Amount; startedAt: string }
): Promise<boolean> {
	if (!Number.isSafeInteger(undo.amount) || undo.amount <= 0) {
		throw new RangeError('An undo sends a positive whole amount.');
	}
	const written = await db
		.insert(donationUndos)
		.values({
			donationId: undo.donationId,
			twistId: undo.twistId,
			amount: undo.amount,
			status: 'started',
			statusReason: null,
			startedAt: undo.startedAt,
			settledAt: null
		})
		// Either rule of the table: this donation, or this payment, already has an undo.
		.onConflictDoNothing()
		.returning({ donationId: donationUndos.donationId });
	return written.length === 1;
}

async function settle(
	db: Database,
	donationId: string,
	values: { status: RefundStatus; statusReason: string | null; settledAt: string | null }
): Promise<boolean> {
	const marked = await db
		.update(donationUndos)
		.set(values)
		// Only a `started` undo is settled: what was recorded once is never rewritten.
		.where(and(eq(donationUndos.donationId, donationId), eq(donationUndos.status, 'started')))
		.returning({ donationId: donationUndos.donationId });
	return marked.length === 1;
}

/**
 * The transfer went through. From this write on the donation no longer counts in its
 * campaign's total. Answers false if the undo was not `started`.
 */
export function markDonationUndoSent(db: Database, donationId: string, at: string) {
	return settle(db, donationId, { status: 'sent', statusReason: null, settledAt: at });
}

/** The twin refused the transfer: nothing moved. The donation still counts. Never tried again. */
export function markDonationUndoFailed(
	db: Database,
	donationId: string,
	reason: string,
	at: string
) {
	return settle(db, donationId, { status: 'failed', statusReason: reason, settledAt: at });
}

/** No answer: the money may have moved. The donation still counts. Never sent again. */
export function markDonationUndoUnknown(db: Database, donationId: string, reason: string) {
	return settle(db, donationId, { status: 'unknown', statusReason: reason, settledAt: null });
}

/** The undo of one donation, if one was ever started. */
export async function getDonationUndo(db: Executor, donationId: string) {
	const [row] = await db
		.select()
		.from(donationUndos)
		.where(eq(donationUndos.donationId, donationId))
		.limit(1);
	return row ?? null;
}
