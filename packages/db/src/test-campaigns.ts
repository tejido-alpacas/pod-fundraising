/**
 * Removing a campaign the automatic end-to-end tests created, with everything of its own.
 * Track C owns this file.
 *
 * THIS DELETES DATA. It is here for one caller: the cleanup pass in
 * apps/web/src/lib/server/backend/test-campaign-cleanup.ts, which decides WHICH campaigns.
 * Nothing here decides that, except for two locks that hold whatever a caller believes:
 *
 *   - the fixed test campaign (`E2E_CAMPAIGN_ID`, the one every run uses) is never listed
 *     and never deleted: `deleteCampaignAndAllOfItsOwn` throws when given its id;
 *   - `deleteCampaignAndAllOfItsOwn` reads the campaign's creator and every person on it
 *     itself, and throws, deleting nothing, unless every one of those addresses is at the
 *     test inbox domain it was given. A real fundraiser handed to it by mistake is refused;
 *   - every statement of a deletion names one campaign's id and removes only that campaign's
 *     rows. Foreign keys are enforced, so if anything else still points at the campaign
 *     (a row of another campaign, or a table this file does not know) the whole deletion
 *     fails and the campaign is left exactly as it was.
 *
 * ONE CAMPAIGN IS ALL OR NOTHING: its statements go in one `db.batch`, which D1 runs as a
 * transaction.
 *
 * EVERY TABLE THAT HANGS OFF A CAMPAIGN is in `CAMPAIGN_OWNED_TABLES` below, children before
 * parents. test-campaigns.test.ts walks the schema's foreign keys and fails when a table
 * that points at a campaign, directly or through another table, is missing from the list.
 * So a table added later cannot be silently left behind: add it to the list.
 *
 * EVIDENCE FILES. A file's bytes are in the evidence store, which only the App can reach;
 * NOTHING HERE DELETES STORED BYTES. What is here is the file's row in `evidence_files`: one
 * row per fingerprint, owned by the party who uploaded those bytes first, saying who may see
 * the file. The same bytes can be named by entries of many campaigns (the tests upload the
 * same small picture on every run), so a row owned by a party of the campaign being deleted
 * is treated like this:
 *
 *   - no entry outside the campaign names the file: the row is deleted with the campaign;
 *   - an entry of another campaign names it: the row is KEPT, and handed to the same person
 *     (the same email address) on a remaining campaign that names the file, so the file's
 *     visibility stays exactly as its uploader set it;
 *   - an entry of another campaign names it and none of them is the same person's: the
 *     campaign is not deleted at all.
 */
import { and, asc, eq, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import type { Database, Executor } from './client.ts';
import { E2E_CAMPAIGN_ID } from './e2e-fixture.ts';
import {
	campaignFunding,
	campaigns,
	deposits,
	donations,
	entries,
	evidenceFiles,
	itemProvisioning,
	milestones,
	parties,
	partySignInTokens,
	refundAttempts,
	refundDeposits,
	refunds,
	reminders,
	workLogSchedules
} from './schema.ts';

// The fixed test campaign's id, from the fixture that creates it: the one definition.
export { E2E_CAMPAIGN_ID };

/** One table that holds rows belonging to a campaign, and which of its rows are that campaign's. */
interface OwnedTable {
	table: SQLiteTable;
	/** The rows of this table that belong to the campaign with this id, and no others. */
	ownedBy: (campaignId: string) => SQL | undefined;
}

const partiesOf = (campaignId: string) =>
	sql`(select ${parties.id} from ${parties} where ${parties.campaignId} = ${campaignId})`;
const entriesOf = (campaignId: string) =>
	sql`(select ${entries.id} from ${entries} where ${entries.campaignId} = ${campaignId})`;
const refundsOf = (campaignId: string) =>
	sql`(select ${refunds.id} from ${refunds} where ${refunds.campaignId} = ${campaignId})`;

/**
 * Every table with rows that belong to a campaign, IN THE ORDER THEY ARE DELETED: a table
 * comes before every table it points at. The last one is the campaign itself.
 *
 * A new table that points at `campaigns`, or at any table here, must be added here, before
 * the tables it points at. The schema-walk test fails until it is.
 */
export const CAMPAIGN_OWNED_TABLES: readonly OwnedTable[] = [
	{ table: refundAttempts, ownedBy: (id) => sql`${refundAttempts.refundId} in ${refundsOf(id)}` },
	{ table: refundDeposits, ownedBy: (id) => sql`${refundDeposits.refundId} in ${refundsOf(id)}` },
	{ table: refunds, ownedBy: (id) => eq(refunds.campaignId, id) },
	{ table: deposits, ownedBy: (id) => sql`${deposits.entryId} in ${entriesOf(id)}` },
	{ table: entries, ownedBy: (id) => eq(entries.campaignId, id) },
	{ table: reminders, ownedBy: (id) => eq(reminders.campaignId, id) },
	{
		table: partySignInTokens,
		ownedBy: (id) => sql`${partySignInTokens.partyId} in ${partiesOf(id)}`
	},
	{
		table: evidenceFiles,
		// Only a row that NO remaining entry names. The campaign's own entries are gone by the
		// time this runs (they are earlier in the list), so any entry left is another
		// campaign's. A row that is still named stays, and then the party it belongs to cannot
		// be deleted either: the whole deletion fails and nothing is removed.
		ownedBy: (id) =>
			and(
				sql`${evidenceFiles.uploadedByPartyId} in ${partiesOf(id)}`,
				sql`not exists (select 1 from ${entries} where instr(${entries.inputs}, ${evidenceFiles.sha256}) > 0)`
			)
	},
	{ table: milestones, ownedBy: (id) => eq(milestones.campaignId, id) },
	{ table: parties, ownedBy: (id) => eq(parties.campaignId, id) },
	{ table: campaignFunding, ownedBy: (id) => eq(campaignFunding.campaignId, id) },
	{ table: donations, ownedBy: (id) => eq(donations.campaignId, id) },
	{ table: itemProvisioning, ownedBy: (id) => eq(itemProvisioning.campaignId, id) },
	{ table: workLogSchedules, ownedBy: (id) => eq(workLogSchedules.campaignId, id) },
	{ table: campaigns, ownedBy: (id) => eq(campaigns.id, id) }
];

// --- Which campaigns to look at ---

/** A campaign the cleanup pass may consider, with what it needs to decide. Nothing is decided here. */
export interface CleanupCandidate {
	id: string;
	creatorEmail: string;
	createdAt: string;
	/** The email address of every person on the campaign. */
	partyEmails: string[];
	/** Deposits paid on the campaign's entries that have not been refunded. */
	depositsNotRefunded: number;
	/** Refunds that were started and have no recorded outcome. */
	refundsInProgress: number;
	/** Refunds whose transfer got no answer: the money may or may not have moved. */
	refundsOutcomeUnknown: number;
	/** Donations recorded for the campaign. */
	donations: number;
}

/**
 * Every campaign whose creator's email ends in `@emailDomain`, created at or before
 * `createdAtOrBefore`, oldest first, EXCEPT the fixed test campaign, which is never listed.
 *
 * This only shortens the list. Whether a campaign is the tests' own, old enough and finished
 * with is the caller's to decide, in code, on each one.
 */
export async function listCleanupCandidates(
	db: Executor,
	emailDomain: string,
	createdAtOrBefore: string
): Promise<CleanupCandidate[]> {
	const suffix = `@${emailDomain.toLowerCase()}`;
	const listed = and(
		sql`lower(substr(${campaigns.creatorEmail}, ${-suffix.length})) = ${suffix}`,
		ne(campaigns.id, E2E_CAMPAIGN_ID),
		lte(campaigns.createdAt, createdAtOrBefore)
	);

	const [found, people, unrefunded, openRefunds, given] = await Promise.all([
		db
			.select({
				id: campaigns.id,
				creatorEmail: campaigns.creatorEmail,
				createdAt: campaigns.createdAt
			})
			.from(campaigns)
			.where(listed)
			.orderBy(asc(campaigns.createdAt), asc(campaigns.id)),
		db
			.select({ campaignId: parties.campaignId, email: parties.email })
			.from(parties)
			.innerJoin(campaigns, eq(campaigns.id, parties.campaignId))
			.where(listed),
		db
			.select({ campaignId: entries.campaignId, n: sql<number>`count(*)` })
			.from(deposits)
			.innerJoin(entries, eq(entries.id, deposits.entryId))
			.innerJoin(campaigns, eq(campaigns.id, entries.campaignId))
			.where(and(listed, sql`${deposits.refundedAt} is null`))
			.groupBy(entries.campaignId),
		db
			.select({
				campaignId: refunds.campaignId,
				status: refunds.status,
				n: sql<number>`count(*)`
			})
			.from(refunds)
			.innerJoin(campaigns, eq(campaigns.id, refunds.campaignId))
			.where(and(listed, inArray(refunds.status, ['started', 'unknown'])))
			.groupBy(refunds.campaignId, refunds.status),
		db
			.select({ campaignId: donations.campaignId, n: sql<number>`count(*)` })
			.from(donations)
			.innerJoin(campaigns, eq(campaigns.id, donations.campaignId))
			.where(listed)
			.groupBy(donations.campaignId)
	]);

	const candidates = new Map<string, CleanupCandidate>(
		found.map((campaign) => [
			campaign.id,
			{
				...campaign,
				partyEmails: [],
				depositsNotRefunded: 0,
				refundsInProgress: 0,
				refundsOutcomeUnknown: 0,
				donations: 0
			}
		])
	);
	// A row for a campaign that is not in `found` belongs to one created between two of the
	// reads above. It is left for the next pass.
	for (const { campaignId, email } of people) candidates.get(campaignId)?.partyEmails.push(email);
	for (const { campaignId, n } of unrefunded) {
		const candidate = candidates.get(campaignId);
		if (candidate) candidate.depositsNotRefunded = n;
	}
	for (const { campaignId, status, n } of openRefunds) {
		const candidate = candidates.get(campaignId);
		if (!candidate) continue;
		if (status === 'unknown') candidate.refundsOutcomeUnknown = n;
		else candidate.refundsInProgress = n;
	}
	for (const { campaignId, n } of given) {
		const candidate = candidates.get(campaignId);
		if (candidate) candidate.donations = n;
	}
	return [...candidates.values()];
}

// --- Deleting one ---

export type CampaignDeletion =
	| {
			deleted: true;
			/**
			 * Evidence-file rows removed with the campaign. Each is a file whose bytes are STILL
			 * in the evidence store, with nothing in the database naming them any more.
			 */
			evidenceRowsDeleted: number;
			/** Evidence-file rows kept, and handed to the same person on another campaign. */
			evidenceRowsHandedOver: number;
	  }
	/**
	 * Not deleted, and nothing was changed: a file a person of this campaign uploaded is named
	 * by another campaign's entry, filed by somebody else. The file's row cannot be removed
	 * (it says who may see the file) and there is nobody of the same address to hand it to.
	 */
	| { deleted: false; why: 'evidence_named_by_someone_else' }
	/** Not deleted: there is no campaign with this id (another pass removed it first). */
	| { deleted: false; why: 'not_found' };

/**
 * Deletes one campaign and every row that belongs to it, in one batch: all of it, or none.
 * Deletes no stored evidence bytes. Never deletes the fixed test campaign.
 *
 * It does not decide whether the campaign is old enough or finished with: the caller has.
 * It does refuse, by throwing, any campaign that is not the tests' own (see the top).
 *
 * Throws when the database refuses the batch, which is what happens when something this file
 * does not know about still points at the campaign. Nothing is deleted then.
 */
export async function deleteCampaignAndAllOfItsOwn(
	db: Database,
	campaignId: string,
	/** The test inbox domain. The caller gives it; it is not written in this package. */
	testEmailDomain: string
): Promise<CampaignDeletion> {
	if (campaignId === E2E_CAMPAIGN_ID) {
		throw new RangeError('The fixed test campaign is never deleted.');
	}

	// THE LOCK ON WHOSE CAMPAIGN IT IS, whatever the caller believes: the creator's address
	// and the address of every person on the campaign are read here, and each must be one
	// address at the test inbox domain. Anything else throws, and nothing is deleted.
	const domain = testEmailDomain.toLowerCase();
	if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(domain) || !domain.includes('.')) {
		throw new RangeError('The test inbox domain is not a domain.');
	}
	const atTestDomain = (email: string) => {
		const at = email.indexOf('@');
		return at > 0 && at === email.lastIndexOf('@') && email.slice(at + 1).toLowerCase() === domain;
	};
	const [campaign] = await db
		.select({ creatorEmail: campaigns.creatorEmail })
		.from(campaigns)
		.where(eq(campaigns.id, campaignId))
		.limit(1);
	if (!campaign) return { deleted: false, why: 'not_found' };
	const people = await db
		.select({ email: parties.email })
		.from(parties)
		.where(eq(parties.campaignId, campaignId));
	if (!atTestDomain(campaign.creatorEmail) || !people.every(({ email }) => atTestDomain(email))) {
		throw new RangeError(
			'Only a campaign whose creator and every person are test people is ever deleted.'
		);
	}

	// Evidence rows owned by this campaign's people, and who else names each file.
	const owned = await db
		.select({
			sha256: evidenceFiles.sha256,
			uploaderId: parties.id,
			uploaderEmail: parties.email
		})
		.from(evidenceFiles)
		.innerJoin(parties, eq(parties.id, evidenceFiles.uploadedByPartyId))
		.where(eq(parties.campaignId, campaignId));

	const handOvers = [];
	for (const file of owned) {
		const namedElsewhereBy = await db
			.selectDistinct({ id: parties.id, email: parties.email, createdAt: parties.createdAt })
			.from(entries)
			.innerJoin(parties, eq(parties.id, entries.partyId))
			.where(
				and(
					ne(entries.campaignId, campaignId),
					ne(parties.campaignId, campaignId),
					// As in records.ts: `instr`, because D1 refuses a long LIKE pattern.
					sql`instr(${entries.inputs}, ${file.sha256}) > 0`
				)
			)
			.orderBy(asc(parties.createdAt), asc(parties.id));
		if (namedElsewhereBy.length === 0) continue;

		const samePerson = namedElsewhereBy.find(
			(party) => party.email.toLowerCase() === file.uploaderEmail.toLowerCase()
		);
		if (!samePerson) return { deleted: false, why: 'evidence_named_by_someone_else' };
		handOvers.push(
			db
				.update(evidenceFiles)
				.set({ uploadedByPartyId: samePerson.id })
				.where(
					and(
						eq(evidenceFiles.sha256, file.sha256),
						eq(evidenceFiles.uploadedByPartyId, file.uploaderId)
					)
				)
				.returning({ sha256: evidenceFiles.sha256 })
		);
	}

	// Every table in the list's order, the campaign itself last. The hand-overs go in before
	// any party is removed. The evidence rows and the campaign are counted from what the
	// database says it removed.
	const evidenceAt = CAMPAIGN_OWNED_TABLES.findIndex(({ table }) => table === evidenceFiles);
	const remove = ({ table, ownedBy }: OwnedTable) => db.delete(table).where(ownedBy(campaignId));
	const results = await db.batch([
		remove(CAMPAIGN_OWNED_TABLES[0]!),
		...handOvers,
		...CAMPAIGN_OWNED_TABLES.slice(1, evidenceAt).map(remove),
		db
			.delete(evidenceFiles)
			.where(CAMPAIGN_OWNED_TABLES[evidenceAt]!.ownedBy(campaignId))
			.returning({ sha256: evidenceFiles.sha256 }),
		...CAMPAIGN_OWNED_TABLES.slice(evidenceAt + 1, -1).map(remove),
		db.delete(campaigns).where(eq(campaigns.id, campaignId)).returning({ id: campaigns.id })
	]);

	const rows = (result: unknown): number => (Array.isArray(result) ? result.length : 0);
	if (rows(results.at(-1)) === 0) return { deleted: false, why: 'not_found' };
	return {
		deleted: true,
		evidenceRowsDeleted: rows(results[handOvers.length + evidenceAt]),
		evidenceRowsHandedOver: handOvers.length
	};
}
