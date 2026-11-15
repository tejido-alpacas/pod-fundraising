/**
 * Donations: the rows written when Qatom tells us a donor has paid, and what they add up to.
 *
 * Campaigns share Tejido's donation items, so there is no ledger per campaign to read. Each
 * call from Qatom names its campaign, and a campaign's funding is the sum of its own rows.
 * Nothing stored here identifies a donor (see `donations` in schema.ts).
 */
import {
	amountSchema,
	idSchema,
	sha256Schema,
	timestampSchema,
	type Amount,
	type FundingTotals
} from '@tejido/contracts';
import { and, count, eq, lte, max, sql, sum } from 'drizzle-orm';
import type { Database, Executor } from './client.ts';
import { campaigns, donations } from './schema.ts';

export type Donation = typeof donations.$inferSelect;

/** Every donation recorded for one campaign, oldest first. */
export async function listDonations(db: Executor, campaignId: string): Promise<Donation[]> {
	return db
		.select()
		.from(donations)
		.where(eq(donations.campaignId, campaignId))
		.orderBy(donations.receivedAt, donations.id);
}

/**
 * What a campaign's recorded donations add up to, or null when it has none. `readAt` is when
 * the newest of them reached us: the totals have not changed since.
 */
export async function getDonationTotals(
	db: Executor,
	campaignId: string
): Promise<FundingTotals | null> {
	const [row] = await db
		.select({
			raised: sum(donations.amount).mapWith(Number),
			donations: count(),
			readAt: max(donations.receivedAt)
		})
		.from(donations)
		.where(eq(donations.campaignId, campaignId));
	if (!row || row.donations === 0 || row.readAt === null) return null;
	return { raised: row.raised, donations: row.donations, readAt: row.readAt };
}

export interface NewDonation {
	id: string;
	campaignId: string;
	/** A positive whole number of Qatom's smallest unit. */
	amount: Amount;
	/** The SHA-256 of the transaction id Qatom sent, or null when it sent none. */
	paymentDigest: string | null;
	receivedAt: string;
}

export interface RecordedDonation {
	/** False when this payment was already recorded: nothing was written. */
	recorded: boolean;
	/** The row for this payment: the new one, or the one an earlier call wrote. */
	donationId: string;
	/** True when this write moved the campaign from `funding` to `funded`. */
	becameFunded: boolean;
}

/**
 * Records one paid donation and, in the same write, moves the campaign from `funding` to
 * `funded` when it has a goal and its donations now reach it. Both land, or neither does.
 *
 * Safe to repeat for one payment: a second call with the same `paymentDigest` writes no row
 * and answers the first one's id. A donation with no digest cannot be recognised again, so
 * each such call is recorded.
 *
 * Only `funding` ever moves, and only to `funded`: the rule is `statusAfterFunding` in
 * @tejido/contracts, written as SQL so it is checked against the rows as they are at the
 * moment of the write. A campaign with no goal never moves. The campaign must exist; a
 * donation for one that does not is refused by the database.
 */
export async function recordDonation(
	db: Database,
	donation: NewDonation
): Promise<RecordedDonation> {
	const row = {
		id: idSchema.parse(donation.id),
		campaignId: idSchema.parse(donation.campaignId),
		amount: amountSchema.positive().parse(donation.amount),
		paymentDigest: sha256Schema.nullable().parse(donation.paymentDigest),
		receivedAt: timestampSchema.parse(donation.receivedAt)
	};
	const raised = sql<number>`(select coalesce(sum(${donations.amount}), 0) from ${donations} where ${donations.campaignId} = ${row.campaignId})`;

	const [inserted, moved] = await db.batch([
		db
			.insert(donations)
			.values(row)
			.onConflictDoNothing({ target: donations.paymentDigest })
			.returning({ id: donations.id }),
		db
			.update(campaigns)
			.set({ status: 'funded' })
			.where(
				and(
					eq(campaigns.id, row.campaignId),
					eq(campaigns.status, 'funding'),
					// NULL is not less than anything, so a campaign without a goal never matches.
					lte(campaigns.fundingGoal, raised)
				)
			)
			.returning({ id: campaigns.id })
	]);
	const becameFunded = moved.length > 0;

	const [written] = inserted;
	if (written) return { recorded: true, donationId: written.id, becameFunded };

	// The payment was recorded before. Only a row with this digest can have stopped the insert.
	const [earlier] =
		row.paymentDigest === null
			? []
			: await db
					.select({ id: donations.id })
					.from(donations)
					.where(eq(donations.paymentDigest, row.paymentDigest))
					.limit(1);
	if (!earlier) throw new Error('the donation was not written and no earlier one was found');
	return { recorded: false, donationId: earlier.id, becameFunded };
}
