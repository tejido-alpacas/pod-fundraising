/**
 * Fixtures: one campaign, three parties, three milestones, five entries and their deposits.
 *
 * These seed OUR database so every page has something to show from the first minute. They are
 * our own data. They are not a stand-in for Qatom and nothing here is sent to Qatom.
 *
 * Wallet hostnames and email addresses are deliberately unreal, so that fixture data can never
 * move money or reach a real person: they use the reserved `.example` domain. Qatom only
 * transfers to twins under `biz.todaq.net`, so a refund aimed at a fixture party is refused.
 *
 * One exception: the contractor's email is the project owner's own address, so that a real
 * Qatom sign-in from the contractor's invite link matches the invite and can be tested. Once
 * someone signs in as the contractor, that party's wallets in the local database are real.
 *
 * The campaign's two commodity ids are real. They are the catalog items the project owner
 * created for this campaign, and they exist in one Qatom environment only: the one those items
 * were created in. Against any other environment the ids are unknown, so the reconciler
 * reports that it could not read the ledgers and stamps nothing.
 */
import type { Campaign, Milestone } from './campaign.ts';
import type { Deposit } from './deposit.ts';
import type { Entry } from './entry.ts';
import { DEPOSIT_AMOUNT } from './money.ts';
import type { Party } from './party.ts';
import { agentWalletHostnameSchema, primaryWalletHostnameSchema } from './primitives.ts';

const CAMPAIGN_ID = 'library-wing';

// ---------------------------------------------------------------------------
// The campaign
// ---------------------------------------------------------------------------

export const fixtureCampaign: Campaign = {
	id: CAMPAIGN_ID,
	title: 'Rebuild the library wing',
	summary:
		'The hurricane took the roof and two walls off the library wing at Mangrove Bay Primary School. ' +
		'This campaign pays to rebuild the wing on a new foundation and to restock its shelves.',
	beneficiary: 'The 214 pupils of Mangrove Bay Primary School',
	creatorName: 'Mangrove Bay Parent-Teacher Association',
	creatorEmail: 'pta@mangrovebayprimary.example',
	status: 'reporting',
	cadence: 'weekly',
	logWorkCommodityId: 3152,
	milestoneHitCommodityId: 3153,
	createdAt: '2026-10-05T14:00:00.000Z'
};

// ---------------------------------------------------------------------------
// Three parties: a contractor, a supplier, and the head teacher as confirmer
// ---------------------------------------------------------------------------

const contractor: Party = {
	id: 'contractor',
	campaignId: CAMPAIGN_ID,
	role: 'third_party',
	name: 'Coral Ridge Builders',
	title: 'Contractor',
	// A real address, on purpose: the project owner signs in as this party to test the App.
	email: 'matthew.mihok@todaq.net',
	reporterCode: 'rc_k7m2q9x4w8n5b3t6v2zj',
	agentWalletHostname: agentWalletHostnameSchema.parse('coral-ridge-agent.wallets.tejido.example'),
	primaryWalletHostname: primaryWalletHostnameSchema.parse('coral-ridge.wallets.tejido.example'),
	createdAt: '2026-10-05T14:10:00.000Z'
};

const supplier: Party = {
	id: 'supplier',
	campaignId: CAMPAIGN_ID,
	role: 'third_party',
	name: 'Island Schoolbooks Co-operative',
	title: 'Book supplier',
	email: 'orders@islandschoolbooks.example',
	reporterCode: 'rc_h4d8s2f6g9j3k7m5n2p8',
	agentWalletHostname: agentWalletHostnameSchema.parse(
		'island-schoolbooks-agent.wallets.tejido.example'
	),
	primaryWalletHostname: primaryWalletHostnameSchema.parse(
		'island-schoolbooks.wallets.tejido.example'
	),
	createdAt: '2026-10-05T14:12:00.000Z'
};

const headTeacher: Party = {
	id: 'head-teacher',
	campaignId: CAMPAIGN_ID,
	role: 'confirmer',
	name: 'Yvonne Campbell',
	title: 'Head teacher, Mangrove Bay Primary School',
	email: 'y.campbell@mangrovebayprimary.example',
	reporterCode: 'rc_t3y7u2e9r5w8q4a6c3x9',
	agentWalletHostname: agentWalletHostnameSchema.parse(
		'yvonne-campbell-agent.wallets.tejido.example'
	),
	primaryWalletHostname: primaryWalletHostnameSchema.parse(
		'yvonne-campbell.wallets.tejido.example'
	),
	createdAt: '2026-10-05T14:15:00.000Z'
};

export const fixtureParties: Party[] = [contractor, supplier, headTeacher];

// ---------------------------------------------------------------------------
// Three milestones, one in each of three states
// ---------------------------------------------------------------------------

export const fixtureMilestones: Milestone[] = [
	{
		campaignId: CAMPAIGN_ID,
		id: 'm1-foundation',
		position: 1,
		title: 'Foundation and floor slab',
		description:
			'Clear the storm debris, excavate, and pour a reinforced foundation and floor slab for the new wing.',
		kind: 'construction',
		ownerPartyId: contractor.id,
		confirmerPartyId: headTeacher.id,
		dueDate: '2026-10-30',
		state: 'confirmed_independent',
		confirmedAt: '2026-10-30T09:41:07.000Z'
	},
	{
		campaignId: CAMPAIGN_ID,
		id: 'm2-walls',
		position: 2,
		title: 'Walls up to roof height',
		description:
			'Block walls on all four sides to ring-beam height, with window and door openings formed.',
		kind: 'construction',
		ownerPartyId: contractor.id,
		confirmerPartyId: headTeacher.id,
		dueDate: '2026-11-27',
		state: 'open',
		confirmedAt: null
	},
	{
		campaignId: CAMPAIGN_ID,
		id: 'm3-books-delivered',
		position: 3,
		title: 'Books delivered',
		description:
			'Six hundred reading books for ages five to eleven, delivered to the school and signed for.',
		kind: 'goods_delivery',
		ownerPartyId: supplier.id,
		confirmerPartyId: headTeacher.id,
		dueDate: '2026-11-20',
		state: 'claimed',
		confirmedAt: null
	}
];

// ---------------------------------------------------------------------------
// Five entries, covering both items and all four statuses
// ---------------------------------------------------------------------------

const EVIDENCE = 'https://evidence.tejido.example';
const SITE = 'Mangrove Bay Primary School, library wing';

export const fixtureEntries: Entry[] = [
	// The contractor claims the foundation. Reconciled: paid from their registered agent wallet.
	{
		id: 'ent-m1-claim',
		campaignId: CAMPAIGN_ID,
		milestoneId: 'm1-foundation',
		partyId: contractor.id,
		item: 'milestone_hit',
		inputs: {
			reporter_code: contractor.reporterCode,
			milestone_id: 'm1-foundation',
			claim: 'completed',
			summary:
				'Foundation and floor slab are finished. The slab was poured on 19 October, cured for seven days ' +
				"and passed the structural engineer's inspection on 28 October.",
			photos: [
				{
					url: `${EVIDENCE}/e050f7f09e99dd426ae805c77d6af314eb59903e3791a8dde7cec69df8c98725.jpg`,
					sha256: 'e050f7f09e99dd426ae805c77d6af314eb59903e3791a8dde7cec69df8c98725',
					caption: 'Finished slab, looking east from the playground'
				},
				{
					url: `${EVIDENCE}/847819bd37d2e252d3b426a4f87038cb20eb0997e368415834ad78a05d8834d6.pdf`,
					sha256: '847819bd37d2e252d3b426a4f87038cb20eb0997e368415834ad78a05d8834d6',
					caption: "Engineer's inspection certificate, 28 October"
				}
			],
			location: SITE
		},
		status: 'verified',
		statusReason: null,
		payingWallet: contractor.agentWalletHostname,
		twistId: '41b1b59a1c45c4ef28d1b10ea119c174c9ebae1fbf624c5809f776659e905b6417',
		filedAt: '2026-10-29T15:12:40.000Z',
		stampedAt: '2026-10-29T15:12:31.000Z',
		updatedAt: '2026-10-29T15:20:02.000Z'
	},

	// The head teacher confirms it from her own wallet. Reconciled.
	{
		id: 'ent-m1-confirm',
		campaignId: CAMPAIGN_ID,
		milestoneId: 'm1-foundation',
		partyId: headTeacher.id,
		item: 'milestone_hit',
		inputs: {
			reporter_code: headTeacher.reporterCode,
			milestone_id: 'm1-foundation',
			claim: 'confirm',
			summary:
				'I walked the site this morning with the chair of the school board. The slab is complete, ' +
				'level, and matches the approved drawings.',
			location: SITE
		},
		status: 'verified',
		statusReason: null,
		payingWallet: headTeacher.agentWalletHostname,
		twistId: '414c8f9aaed10dc2fb4c5b20f61cc65e80ff1395d34d36b5e33f10f074f40c26be',
		filedAt: '2026-10-30T09:41:07.000Z',
		stampedAt: '2026-10-30T09:40:58.000Z',
		updatedAt: '2026-10-30T09:45:00.000Z'
	},

	// A work log on the walls. Reconciled, but the deposit came from a wallet that is not the
	// contractor's registered agent wallet, so it is flagged.
	{
		id: 'ent-m2-log-1',
		campaignId: CAMPAIGN_ID,
		milestoneId: 'm2-walls',
		partyId: contractor.id,
		item: 'log_work',
		inputs: {
			reporter_code: contractor.reporterCode,
			milestone_id: 'm2-walls',
			status: 'on_track',
			period: 'Week of 2 November',
			summary:
				'Block work started on the north wall. Scaffolding is up on two sides and the first ' +
				'window lintels have been cast.',
			percent_complete: 15,
			photos: [
				{
					url: `${EVIDENCE}/d3af969e8ee906f3793eb853d53931b5174569e636407958c204d46c5187b474.jpg`,
					sha256: 'd3af969e8ee906f3793eb853d53931b5174569e636407958c204d46c5187b474',
					caption: 'North wall, four courses up'
				}
			],
			location: SITE
		},
		status: 'flagged',
		statusReason:
			'The deposit was paid from a wallet that is not the one registered for Coral Ridge Builders.',
		payingWallet: 'unregistered-wallet.wallets.tejido.example',
		twistId: '4167976f591288129057275224af3ef9f99c1e0dd39079960aae84bce8fee0516d',
		filedAt: '2026-11-06T16:20:11.000Z',
		stampedAt: '2026-11-06T16:20:03.000Z',
		updatedAt: '2026-11-06T16:30:00.000Z'
	},

	// The supplier claims a delivery but leaves out how many. Saved as incomplete, not refused:
	// by the time we see an entry its deposit has been paid.
	{
		id: 'ent-m3-delivery',
		campaignId: CAMPAIGN_ID,
		milestoneId: 'm3-books-delivered',
		partyId: supplier.id,
		item: 'milestone_hit',
		inputs: {
			reporter_code: supplier.reporterCode,
			milestone_id: 'm3-books-delivered',
			claim: 'delivered',
			summary:
				'First shipment of reading books delivered to the school office and signed for by the secretary.',
			photos: [
				{
					url: `${EVIDENCE}/295d168336a81e93af61e1e00432d826e684ef0c1d3acd58964e34dd6264283a.jpg`,
					sha256: '295d168336a81e93af61e1e00432d826e684ef0c1d3acd58964e34dd6264283a',
					caption: 'Signed delivery note'
				}
			],
			location: 'Mangrove Bay Primary School, front office'
		},
		status: 'incomplete',
		statusReason: 'A delivery needs a quantity and a unit.',
		payingWallet: null,
		twistId: null,
		filedAt: '2026-11-11T11:05:52.000Z',
		stampedAt: null,
		updatedAt: '2026-11-11T11:05:52.000Z'
	},

	// The latest work log. Filed, and not reconciled yet.
	{
		id: 'ent-m2-log-2',
		campaignId: CAMPAIGN_ID,
		milestoneId: 'm2-walls',
		partyId: contractor.id,
		item: 'log_work',
		inputs: {
			reporter_code: contractor.reporterCode,
			milestone_id: 'm2-walls',
			status: 'delayed',
			period: 'Week of 9 November',
			summary:
				'Rain stopped block laying for two days. The north wall is at lintel height and the east ' +
				'wall is started. We expect to recover the time next week.',
			percent_complete: 35,
			photos: [
				{
					url: `${EVIDENCE}/2afbe48b8ac32320b42b0df6e8577a0e9f116ce9aae7d7249c76898aa9351845.jpg`,
					sha256: '2afbe48b8ac32320b42b0df6e8577a0e9f116ce9aae7d7249c76898aa9351845',
					caption: 'North and east walls from the scaffold'
				},
				{
					url: `${EVIDENCE}/7a34e34a3d3c824a8b0023d6b4bbd07f03cad48bd3ae68e7bdf7c495e99b4f97.jpg`,
					sha256: '7a34e34a3d3c824a8b0023d6b4bbd07f03cad48bd3ae68e7bdf7c495e99b4f97',
					caption: 'Blocks covered against the rain'
				}
			],
			location: SITE
		},
		status: 'filed',
		statusReason: null,
		payingWallet: null,
		twistId: null,
		filedAt: '2026-11-13T17:02:19.000Z',
		stampedAt: null,
		updatedAt: '2026-11-13T17:02:19.000Z'
	}
];

// ---------------------------------------------------------------------------
// One deposit per entry. The two on the confirmed milestone have been refunded.
// ---------------------------------------------------------------------------

export const fixtureDeposits: Deposit[] = [
	{
		id: 'dep-m1-claim',
		entryId: 'ent-m1-claim',
		amount: DEPOSIT_AMOUNT.milestone_hit,
		refundedAt: '2026-10-30T09:45:00.000Z'
	},
	{
		id: 'dep-m1-confirm',
		entryId: 'ent-m1-confirm',
		amount: DEPOSIT_AMOUNT.milestone_hit,
		refundedAt: '2026-10-30T09:45:00.000Z'
	},
	{
		id: 'dep-m2-log-1',
		entryId: 'ent-m2-log-1',
		amount: DEPOSIT_AMOUNT.log_work,
		refundedAt: null
	},
	{
		id: 'dep-m3-delivery',
		entryId: 'ent-m3-delivery',
		amount: DEPOSIT_AMOUNT.milestone_hit,
		refundedAt: null
	},
	{
		id: 'dep-m2-log-2',
		entryId: 'ent-m2-log-2',
		amount: DEPOSIT_AMOUNT.log_work,
		refundedAt: null
	}
];

export const fixtures = {
	campaign: fixtureCampaign,
	parties: fixtureParties,
	milestones: fixtureMilestones,
	entries: fixtureEntries,
	deposits: fixtureDeposits
};
