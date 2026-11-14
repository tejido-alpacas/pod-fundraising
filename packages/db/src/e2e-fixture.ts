/**
 * The end-to-end suite's own campaign, for the DEPLOYED database: one small test campaign, the
 * two fixed test people, and three milestones. See e2e/README.md.
 *
 * It is not part of the seed and not a migration. A person prints it as SQL with
 * `npm run db:seed:e2e:sql` and loads it once.
 *
 * - The campaign is a `draft`, so the Campaign Site's home page does not list it. Anyone who
 *   has its address can still open it, and its title and summary say what it is.
 * - The two parties' wallets are empty: each is linked by that person's first real sign-in.
 * - Reporter codes are private to a party, so none is written in this repository: new ones are
 *   minted each time the SQL is printed. Loading the SQL again never replaces a code, a wallet
 *   or anything else already in the database (see `e2eFixtureSql`).
 */
import {
	campaignSchema,
	commodityIdSchema,
	generateReporterCode,
	milestoneSchema,
	partySchema,
	type Campaign,
	type Milestone,
	type Party
} from '@tejido/contracts';

export const E2E_CAMPAIGN_ID = 'e2e-smoke';
export const E2E_CONTRACTOR_PARTY_ID = 'e2e-contractor';
export const E2E_CONFIRMER_PARTY_ID = 'e2e-confirmer';

export interface E2eFixtureInput {
	/** The domain the test people's mail is received on, e.g. `e2e.m.todaq.net`. */
	inboxDomain: string;
	/** The campaign's two catalog items in Qatom. Null until a person has created them. */
	logWorkCommodityId: number | null;
	milestoneHitCommodityId: number | null;
}

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export interface E2eFixture {
	campaign: Campaign;
	parties: Party[];
	milestones: Milestone[];
}

export function e2eFixture(input: E2eFixtureInput, now: Date = new Date()): E2eFixture {
	const { inboxDomain } = input;
	if (!DOMAIN.test(inboxDomain)) {
		throw new Error('The inbox domain must be a bare domain, such as e2e.m.todaq.net.');
	}
	const commodityId = commodityIdSchema.nullable();
	const logWorkCommodityId = commodityId.parse(input.logWorkCommodityId);
	const milestoneHitCommodityId = commodityId.parse(input.milestoneHitCommodityId);
	const createdAt = now.toISOString();

	const campaign = campaignSchema.parse({
		id: E2E_CAMPAIGN_ID,
		title: 'Automated test campaign (not a real fundraiser)',
		summary:
			'This is not a real project and it is not raising money. Tejido’s automated checks sign ' +
			'in here and file test entries to make sure the site is working. Please do not donate.',
		beneficiary: 'Nobody. This is an automated test.',
		creatorName: 'Tejido automated tests',
		creatorEmail: `e2e-creator@${inboxDomain}`,
		status: 'draft',
		cadence: 'weekly',
		logWorkCommodityId,
		milestoneHitCommodityId,
		fundingGoal: null,
		donationCommodityId: null,
		createdAt
	} satisfies Campaign);

	const party = (id: string, role: Party['role'], name: string, title: string): Party =>
		partySchema.parse({
			id,
			campaignId: E2E_CAMPAIGN_ID,
			role,
			name,
			title,
			// The suite reads this person's sign-in code from the inbox on this domain.
			email: `${id}@${inboxDomain}`,
			reporterCode: generateReporterCode(),
			relationship: 'participant',
			relationshipReason: 'An automated test account run by Tejido.',
			agentWalletHostname: null,
			primaryWalletHostname: null,
			createdAt
		} satisfies Party);

	const milestone = (
		position: number,
		id: string,
		title: string,
		kind: Milestone['kind']
	): Milestone =>
		milestoneSchema.parse({
			campaignId: E2E_CAMPAIGN_ID,
			id,
			position,
			title,
			description: 'An automated test milestone. Nothing is being built or delivered.',
			kind,
			ownerPartyId: E2E_CONTRACTOR_PARTY_ID,
			confirmerPartyId: E2E_CONFIRMER_PARTY_ID,
			// Far ahead, so the test campaign never reads as overdue.
			dueDate: '2030-12-31',
			state: 'open',
			confirmedAt: null
		} satisfies Milestone);

	return {
		campaign,
		parties: [
			party(E2E_CONTRACTOR_PARTY_ID, 'third_party', 'E2E Test Contractor', 'Test contractor'),
			party(E2E_CONFIRMER_PARTY_ID, 'confirmer', 'E2E Test Confirmer', 'Test confirmer')
		],
		milestones: [
			milestone(1, 'test-m1-work', 'Test milestone 1: work', 'service'),
			milestone(2, 'test-m2-delivery', 'Test milestone 2: a delivery', 'goods_delivery'),
			milestone(3, 'test-m3-build', 'Test milestone 3: a build', 'construction')
		]
	};
}
