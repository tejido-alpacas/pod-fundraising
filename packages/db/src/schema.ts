/**
 * The tables behind the contracts. One table per record in @tejido/contracts, with the same
 * field names. The assertions at the bottom of this file make `npm run typecheck` fail if a
 * table and its contract drift apart.
 *
 * After changing a table, run `npm run db:generate` and commit the new file in ../drizzle.
 */
import type {
	AgentWalletHostname,
	Cadence,
	Campaign,
	CampaignStatus,
	Deposit,
	Entry,
	EntryItem,
	EvidenceFileRecord,
	EvidenceVisibility,
	EntryStatus,
	FundingTotals,
	LogWorkInput,
	Milestone,
	MilestoneHitInput,
	MilestoneKind,
	MilestoneState,
	Party,
	PartyRelationship,
	PartyRole,
	PrimaryWalletHostname,
	RefundStatus
} from '@tejido/contracts';
import { sql } from 'drizzle-orm';
import {
	check,
	foreignKey,
	index,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

// Times are ISO 8601 UTC strings, as in the contracts. They sort correctly as text.

export const campaigns = sqliteTable('campaigns', {
	id: text('id').primaryKey(),
	title: text('title').notNull(),
	summary: text('summary').notNull(),
	beneficiary: text('beneficiary').notNull(),
	creatorName: text('creator_name').notNull(),
	creatorEmail: text('creator_email').notNull(),
	status: text('status').$type<CampaignStatus>().notNull(),
	cadence: text('cadence').$type<Cadence>().notNull(),
	logWorkCommodityId: integer('log_work_commodity_id'),
	milestoneHitCommodityId: integer('milestone_hit_commodity_id'),
	// A whole number of Qatom's smallest unit. Null means no goal is set; none is ever assumed.
	fundingGoal: integer('funding_goal'),
	donationCommodityId: integer('donation_commodity_id'),
	createdAt: text('created_at').notNull()
});

export const parties = sqliteTable(
	'parties',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id),
		role: text('role').$type<PartyRole>().notNull(),
		name: text('name').notNull(),
		title: text('title').notNull(),
		email: text('email').notNull(),
		reporterCode: text('reporter_code').notNull().unique(),
		// Null means nobody has recorded it. It is never read as `independent`.
		relationship: text('relationship').$type<PartyRelationship>(),
		relationshipReason: text('relationship_reason'),
		// Deposits are paid FROM the agent wallet. Refunds go TO the primary wallet.
		agentWalletHostname: text('agent_wallet_hostname').$type<AgentWalletHostname>(),
		primaryWalletHostname: text('primary_wallet_hostname').$type<PrimaryWalletHostname>(),
		createdAt: text('created_at').notNull()
	},
	(table) => [index('parties_campaign_idx').on(table.campaignId)]
);

export const milestones = sqliteTable(
	'milestones',
	{
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id),
		// Unique within the campaign only: this is the value a reporter types as `milestone_id`.
		id: text('id').notNull(),
		position: integer('position').notNull(),
		title: text('title').notNull(),
		description: text('description').notNull(),
		kind: text('kind').$type<MilestoneKind>().notNull(),
		ownerPartyId: text('owner_party_id')
			.notNull()
			.references(() => parties.id),
		confirmerPartyId: text('confirmer_party_id')
			.notNull()
			.references(() => parties.id),
		dueDate: text('due_date').notNull(),
		state: text('state').$type<MilestoneState>().notNull(),
		confirmedAt: text('confirmed_at')
	},
	(table) => [primaryKey({ columns: [table.campaignId, table.id] })]
);

export const entries = sqliteTable(
	'entries',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id').notNull(),
		milestoneId: text('milestone_id').notNull(),
		partyId: text('party_id')
			.notNull()
			.references(() => parties.id),
		item: text('item').$type<EntryItem>().notNull(),
		inputs: text('inputs', { mode: 'json' }).$type<LogWorkInput | MilestoneHitInput>().notNull(),
		status: text('status').$type<EntryStatus>().notNull(),
		statusReason: text('status_reason'),
		payingWallet: text('paying_wallet'),
		// One ledger transaction can prove at most one entry.
		twistId: text('twist_id').unique(),
		filedAt: text('filed_at').notNull(),
		stampedAt: text('stamped_at'),
		updatedAt: text('updated_at').notNull()
	},
	(table) => [
		foreignKey({
			columns: [table.campaignId, table.milestoneId],
			foreignColumns: [milestones.campaignId, milestones.id]
		}),
		index('entries_campaign_filed_idx').on(table.campaignId, table.filedAt),
		index('entries_party_idx').on(table.partyId)
	]
);

export const deposits = sqliteTable('deposits', {
	id: text('id').primaryKey(),
	// Every entry has exactly one deposit.
	entryId: text('entry_id')
		.notNull()
		.unique()
		.references(() => entries.id),
	// A whole number of Qatom's smallest unit. See money.ts in @tejido/contracts.
	amount: integer('amount').notNull(),
	refundedAt: text('refunded_at')
});

/**
 * One row per stored evidence file, by the SHA-256 of its bytes: who uploaded it and who may
 * see it. The file itself is in the evidence store (R2) under the same SHA-256.
 *
 * A file with no row was uploaded before rows were kept, and is public.
 */
export const evidenceFiles = sqliteTable('evidence_files', {
	sha256: text('sha256').primaryKey(),
	/** Only this party can change `visibility`. */
	uploadedByPartyId: text('uploaded_by_party_id')
		.notNull()
		.references(() => parties.id),
	visibility: text('visibility').$type<EvidenceVisibility>().notNull(),
	// Both are shown to donors, and both are set exactly when the file is `not_public`.
	notPublicKind: text('not_public_kind'),
	notPublicReason: text('not_public_reason'),
	createdAt: text('created_at').notNull(),
	updatedAt: text('updated_at').notNull()
});

// ---------------------------------------------------------------------------
// Funding (the totals of the last read of a campaign's donation ledger)
// ---------------------------------------------------------------------------

/**
 * What the last successful read of a campaign's donation ledger added up to. One row per
 * campaign, replaced whole by each read; no row means the ledger has never been read.
 *
 * Totals only. Individual donations are not stored, and nothing here can identify a donor:
 * no wallet address, no transaction id.
 */
export const campaignFunding = sqliteTable('campaign_funding', {
	campaignId: text('campaign_id')
		.primaryKey()
		.references(() => campaigns.id),
	// A whole number of Qatom's smallest unit. See money.ts in @tejido/contracts.
	raised: integer('raised').notNull(),
	donations: integer('donations').notNull(),
	readAt: text('read_at').notNull()
});

// ---------------------------------------------------------------------------
// Donations (one row per paid donation Qatom told us about; not a contract record)
// ---------------------------------------------------------------------------

/**
 * One donation, written when Qatom calls POST /api/donations/<amount> after a donor has paid
 * for one of Tejido's shared donation items. A campaign's funding is the sum of its rows.
 *
 * Nothing here can identify a donor: no name, no email, no wallet address, and no Qatom
 * transaction id. `paymentDigest` is the SHA-256 of the transaction id Qatom sent with the
 * call, kept only so the same payment is never counted twice; the id itself cannot be read
 * back from it. It is null when Qatom sent no transaction id.
 */
export const donations = sqliteTable(
	'donations',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id),
		// A whole number of Qatom's smallest unit. See money.ts in @tejido/contracts.
		amount: integer('amount').notNull(),
		/** One payment is one donation: a second call with the same digest writes nothing. */
		paymentDigest: text('payment_digest').unique(),
		/** When Qatom's call reached us. Not when the donor paid. */
		receivedAt: text('received_at').notNull()
	},
	(table) => [index('donations_campaign_idx').on(table.campaignId)]
);

/**
 * FOR THE END-TO-END TEST PEOPLE ONLY (CLAUDE.md, "Qatom": the one exception, the owner's
 * decision of 15 November 2026). The undoing of one donation the automatic paid tests made:
 * its money sent back, out of the donation item's own twin, to the test person's wallet it
 * was paid from. Written by test-donation-undos.ts in the backend and by nothing else.
 *
 * The row is written as `started` BEFORE the transfer is sent, so there is always a record
 * that money may have moved, and it is never removed. Two things make "never twice" a rule
 * of the table itself:
 *   - the donation is the primary key: a donation is undone, or tried, at most once, ever;
 *   - `twistId`, the id of the payment on the item's ledger, is unique: one payment is sent
 *     back at most once, whichever donation it was matched to.
 *
 * A donation whose undo is `sent` no longer counts in its campaign's total (donations.ts).
 * The donation's own row stays, as the history.
 *
 * Nothing here names a wallet, a twin or a key, and no row exists for anyone's donation but
 * a test person's: for everyone else `donations` still holds nothing that identifies a donor.
 */
export const donationUndos = sqliteTable('donation_undos', {
	donationId: text('donation_id')
		.primaryKey()
		.references(() => donations.id),
	/** The ledger's own id of the payment that was sent back. */
	twistId: text('twist_id').notNull().unique(),
	/** What was sent: the donation's amount, in Qatom's smallest unit. */
	amount: integer('amount').notNull(),
	status: text('status').$type<RefundStatus>().notNull(),
	statusReason: text('status_reason'),
	startedAt: text('started_at').notNull(),
	settledAt: text('settled_at')
});

// ---------------------------------------------------------------------------
// The purchase Qatom named with a filing (bookkeeping; not a contract record)
// ---------------------------------------------------------------------------

/**
 * What Qatom said about the sale when it called our check-in endpoint: the id of the purchase
 * (`X-Qatom-Transaction-Id`) and the catalog item it was a purchase of
 * (`X-Qatom-Catalog-Item-Id`). One row for an entry filed with a transaction id; none for an
 * entry filed without one.
 *
 * It is kept so the purchase can be looked up at Qatom afterwards. It decides nothing by
 * itself, and it names no wallet and no person.
 *
 * The transaction id is not unique here on purpose: if Qatom ever calls twice for one sale,
 * both filings are saved as they are today, and whatever reads this decides which one the
 * sale proves.
 */
export const entryPurchases = sqliteTable(
	'entry_purchases',
	{
		entryId: text('entry_id')
			.primaryKey()
			.references(() => entries.id),
		/** Qatom's id of the purchase, as it sent it. */
		transactionId: text('transaction_id').notNull(),
		/** Qatom's id of the catalog item the purchase was of. Null when it sent none we can read. */
		catalogItemId: integer('catalog_item_id')
	},
	(table) => [index('entry_purchases_transaction_idx').on(table.transactionId)]
);

// ---------------------------------------------------------------------------
// Deposit refunds (bookkeeping for transfers; not contract records)
// ---------------------------------------------------------------------------

/** Where one refund transfer stands. Defined in @tejido/contracts (deposit.ts). */
export type { RefundStatus };

/**
 * One transfer of deposits back to one party for one milestone: the row is written BEFORE the
 * transfer is sent, so there is always a record that money may have moved.
 */
export const refunds = sqliteTable(
	'refunds',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id').notNull(),
		milestoneId: text('milestone_id').notNull(),
		/** The party who filed the entries, and who is being paid back. */
		partyId: text('party_id')
			.notNull()
			.references(() => parties.id),
		// The wallet the transfer was addressed to: exactly one of the two is set (the check
		// below). For every party but one kind it is the PRIMARY wallet, never the agent wallet.
		primaryWalletHostname: text('primary_wallet_hostname').$type<PrimaryWalletHostname>(),
		// Set ONLY on a refund to an end-to-end test person (CLAUDE.md, "Qatom": the one
		// exception, the owner's decision of 15 November 2026): their deposits go back to the
		// agent wallet they were paid from. Null on every other refund.
		agentWalletHostname: text('agent_wallet_hostname').$type<AgentWalletHostname>(),
		/** The digital quantity hash the ledger reported for the deposits, sent as the transfer's type. */
		dq: text('dq').notNull(),
		/** The total sent, in Qatom's smallest unit: the sum of the claimed deposits. */
		amount: integer('amount').notNull(),
		status: text('status').$type<RefundStatus>().notNull(),
		statusReason: text('status_reason'),
		startedAt: text('started_at').notNull(),
		settledAt: text('settled_at')
	},
	(table) => [
		foreignKey({
			columns: [table.campaignId, table.milestoneId],
			foreignColumns: [milestones.campaignId, milestones.id]
		}),
		index('refunds_milestone_idx').on(table.campaignId, table.milestoneId),
		// A refund names one wallet, and says which kind it is by the column it is in.
		check(
			'refunds_one_wallet',
			sql`(primary_wallet_hostname is null) <> (agent_wallet_hostname is null)`
		)
	]
);

/**
 * Which deposits a refund covers. The deposit is the primary key, so a deposit can belong to
 * at most one refund at a time: this is what stops a deposit being refunded twice, even when
 * two requests run at once. Rows are removed only when their refund is marked `failed`.
 */
export const refundDeposits = sqliteTable(
	'refund_deposits',
	{
		depositId: text('deposit_id')
			.primaryKey()
			.references(() => deposits.id),
		refundId: text('refund_id')
			.notNull()
			.references(() => refunds.id)
	},
	(table) => [index('refund_deposits_refund_idx').on(table.refundId)]
);

/**
 * Every deposit a refund has ever covered: the history `refund_deposits` cannot keep, because
 * its rows are removed when a refund is refused. A row is written with the claim, before the
 * transfer is sent, and is never changed or removed. It decides nothing about what may be
 * sent; it is only read, to say how many refunds of a deposit were tried and how the last
 * one ended.
 */
export const refundAttempts = sqliteTable(
	'refund_attempts',
	{
		refundId: text('refund_id')
			.notNull()
			.references(() => refunds.id),
		depositId: text('deposit_id')
			.notNull()
			.references(() => deposits.id)
	},
	(table) => [
		primaryKey({ columns: [table.refundId, table.depositId] }),
		index('refund_attempts_deposit_idx').on(table.depositId)
	]
);

// ---------------------------------------------------------------------------
// Item provisioning (bookkeeping for creating catalog items; not a contract record)
// ---------------------------------------------------------------------------

/**
 * How far the creation of one campaign's catalog item in Qatom has got. One row per campaign
 * and item. Each column is filled in as soon as Qatom has answered that step, so a run that
 * stops part-way is picked up where it stopped instead of creating things twice.
 *
 * `lockedUntil` is a lease: only the run holding it may call Qatom for this item. A run that
 * ends with a clear answer releases it. A run that ends without one (a timeout, a dropped
 * connection, a server error) leaves it to run out, so nothing is tried again while Qatom may
 * still be finishing the first attempt.
 *
 * Nothing secret is kept here: not the twin's key, and not the check-in secret.
 */
export const itemProvisioning = sqliteTable(
	'item_provisioning',
	{
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id),
		item: text('item').$type<EntryItem>().notNull(),
		/** The twin made to be paid for this item, as Qatom numbers it. */
		twinId: integer('twin_id'),
		twinHostname: text('twin_hostname'),
		commodityHash: text('commodity_hash'),
		commodityId: integer('commodity_id'),
		catalogItemId: integer('catalog_item_id'),
		/** An ISO 8601 time. Null when no run holds the lease. */
		lockedUntil: text('locked_until'),
		updatedAt: text('updated_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.campaignId, table.item] })]
);

// ---------------------------------------------------------------------------
// The cadence scheduler (bookkeeping for what is due; not contract records)
// ---------------------------------------------------------------------------

/**
 * The day a campaign's work-log periods are counted from: the UTC day the scheduler first
 * saw the campaign with work under way. One row per campaign, written once and never changed.
 * No row means the scheduler has not yet seen the campaign reporting, so no work log is due.
 */
export const workLogSchedules = sqliteTable('work_log_schedules', {
	campaignId: text('campaign_id')
		.primaryKey()
		.references(() => campaigns.id),
	/** A calendar day in UTC, `YYYY-MM-DD`: the first day of the first period. */
	startedOn: text('started_on').notNull(),
	recordedAt: text('recorded_at').notNull()
});

/**
 * One reminder raised for one party: that something of theirs fell due, or became overdue.
 * A record only. Nothing is sent from here; a person or a later mailer reads these.
 *
 * The unique index is what stops the same reminder being recorded twice, however often the
 * scheduler runs and even when two runs overlap: one `due` and one `overdue` per party for
 * each milestone, and for each work-log period.
 */
export const reminders = sqliteTable(
	'reminders',
	{
		id: text('id').primaryKey(),
		campaignId: text('campaign_id')
			.notNull()
			.references(() => campaigns.id),
		/** The party responsible for what is due. */
		partyId: text('party_id')
			.notNull()
			.references(() => parties.id),
		what: text('what').$type<'work_log' | 'milestone'>().notNull(),
		/** For a milestone, its id. For a work log, the first day of its period (`YYYY-MM-DD`). */
		subject: text('subject').notNull(),
		kind: text('kind').$type<'due' | 'overdue'>().notNull(),
		/** The last day it is on time, in UTC: the milestone's due date, or the period's last day. */
		dueDate: text('due_date').notNull(),
		raisedAt: text('raised_at').notNull()
	},
	(table) => [
		uniqueIndex('reminders_once_idx').on(
			table.campaignId,
			table.partyId,
			table.what,
			table.subject,
			table.kind
		),
		index('reminders_party_idx').on(table.partyId)
	]
);

// ---------------------------------------------------------------------------
// Sign-in tokens (not a contract record: only the App's server reads or writes these)
// ---------------------------------------------------------------------------

/**
 * The tokens Qatom returned when a party signed in, kept so the App's agent chat can reach the
 * Qatom MCP server as that person. One row per party; a new sign-in replaces it.
 *
 * `sealedTokens` is opaque here. The App encrypts the tokens with a key derived from
 * SESSION_SECRET before saving and decrypts after reading. This package never sees a token or
 * a key, and must never be given an unsealed value.
 */
export const partySignInTokens = sqliteTable('party_sign_in_tokens', {
	partyId: text('party_id')
		.primaryKey()
		.references(() => parties.id),
	sealedTokens: text('sealed_tokens').notNull(),
	updatedAt: text('updated_at').notNull()
});

// ---------------------------------------------------------------------------
// Tables must match the contracts
// ---------------------------------------------------------------------------

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/**
 * An entry row before it is narrowed: a row cannot say that `item` and `inputs` go together.
 * Reading a row through `toEntry` in records.ts restores that.
 */
type EntryRow = Omit<Entry, 'item' | 'inputs'> & {
	item: Entry['item'];
	inputs: LogWorkInput | MilestoneHitInput;
};

export type TablesMatchContracts = [
	Assert<Same<typeof campaigns.$inferSelect, Campaign>>,
	Assert<Same<typeof parties.$inferSelect, Party>>,
	Assert<Same<typeof milestones.$inferSelect, Milestone>>,
	Assert<Same<typeof entries.$inferSelect, EntryRow>>,
	Assert<Same<typeof deposits.$inferSelect, Deposit>>,
	Assert<Same<typeof evidenceFiles.$inferSelect, EvidenceFileRecord>>,
	Assert<Same<Omit<typeof campaignFunding.$inferSelect, 'campaignId'>, FundingTotals>>
];
