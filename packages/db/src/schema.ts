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
	EntryStatus,
	LogWorkInput,
	Milestone,
	MilestoneHitInput,
	MilestoneKind,
	MilestoneState,
	Party,
	PartyRole,
	PrimaryWalletHostname
} from '@tejido/contracts';
import { foreignKey, index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

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
	logWorkCommodityHash: text('log_work_commodity_hash'),
	milestoneHitCommodityHash: text('milestone_hit_commodity_hash'),
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

// ---------------------------------------------------------------------------
// Deposit refunds (bookkeeping for transfers; not contract records)
// ---------------------------------------------------------------------------

/**
 * Where one refund transfer stands.
 *
 * - `started`: the deposits are claimed and the transfer is about to be, or is being, sent.
 *   A row left here means the server stopped part-way. Treat it like `unknown`.
 * - `sent`: Qatom accepted the transfer. The deposits carry `refundedAt`.
 * - `failed`: Qatom refused the transfer and nothing moved. The deposits were released and
 *   may be refunded by a later request.
 * - `unknown`: no usable answer came back (a timeout, a dropped connection, a server error).
 *   The money may or may not have moved. It is never sent again by code: a person checks the
 *   wallet and settles the row by hand.
 */
export type RefundStatus = 'started' | 'sent' | 'failed' | 'unknown';

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
		// The wallet the transfer was addressed to. Always a PRIMARY wallet, never an agent wallet.
		primaryWalletHostname: text('primary_wallet_hostname').$type<PrimaryWalletHostname>().notNull(),
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
		index('refunds_milestone_idx').on(table.campaignId, table.milestoneId)
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
	Assert<Same<typeof deposits.$inferSelect, Deposit>>
];
