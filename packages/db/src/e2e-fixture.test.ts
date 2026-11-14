import { agentWalletHostnameSchema, primaryWalletHostnameSchema } from '@tejido/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { e2eFixtureSql } from './admin.ts';
import type { Database } from './client.ts';
import {
	E2E_CAMPAIGN_ID,
	E2E_CONFIRMER_PARTY_ID,
	E2E_CONTRACTOR_PARTY_ID,
	e2eFixture,
	type E2eFixtureInput
} from './e2e-fixture.ts';
import {
	getCampaign,
	getParty,
	linkPartyWallets,
	listCampaigns,
	listMilestones,
	listParties
} from './records.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const input: E2eFixtureInput = {
	inboxDomain: 'e2e.m.todaq.net',
	logWorkCommodityId: null,
	milestoneHitCommodityId: null
};

async function load(db: Database, sql: string): Promise<void> {
	for (const statement of sql.split(';\n')) await db.run(statement);
}

describe('the end-to-end fixture', () => {
	let test: TestDatabase;
	afterEach(() => test.destroy());

	it('is a draft campaign with the two test people, unlinked, and three open milestones', async () => {
		test = await createTestDatabase();
		await load(test.db, e2eFixtureSql(test.db, input));

		const campaign = await getCampaign(test.db, E2E_CAMPAIGN_ID);
		// A draft is what the Campaign Site's home page leaves out.
		expect(campaign?.status).toBe('draft');
		expect(campaign?.logWorkCommodityId).toBeNull();
		expect(campaign?.milestoneHitCommodityId).toBeNull();

		const parties = await listParties(test.db, E2E_CAMPAIGN_ID);
		expect(parties.map((party) => [party.id, party.role, party.email]).sort()).toEqual([
			[E2E_CONFIRMER_PARTY_ID, 'confirmer', 'e2e-confirmer@e2e.m.todaq.net'],
			[E2E_CONTRACTOR_PARTY_ID, 'third_party', 'e2e-contractor@e2e.m.todaq.net']
		]);
		for (const party of parties) {
			expect(party.agentWalletHostname).toBeNull();
			expect(party.primaryWalletHostname).toBeNull();
		}

		const milestones = await listMilestones(test.db, E2E_CAMPAIGN_ID);
		expect(milestones).toHaveLength(3);
		for (const milestone of milestones) {
			expect(milestone.state).toBe('open');
			expect(milestone.ownerPartyId).toBe(E2E_CONTRACTOR_PARTY_ID);
			expect(milestone.confirmerPartyId).toBe(E2E_CONFIRMER_PARTY_ID);
		}
	});

	it('sits beside the demo fixtures without touching them', async () => {
		test = await createTestDatabase({ seed: true });
		await load(test.db, e2eFixtureSql(test.db, input));
		expect((await listCampaigns(test.db)).map((campaign) => campaign.id).sort()).toEqual([
			E2E_CAMPAIGN_ID,
			'library-wing'
		]);
	});

	it('loaded again, only fills in the commodity ids: codes and linked wallets stay', async () => {
		test = await createTestDatabase();
		await load(test.db, e2eFixtureSql(test.db, input));
		const before = await getParty(test.db, E2E_CONTRACTOR_PARTY_ID);
		const wallets = {
			agentWalletHostname: agentWalletHostnameSchema.parse('agent.wallets.tejido.example'),
			primaryWalletHostname: primaryWalletHostnameSchema.parse('primary.wallets.tejido.example')
		};
		await linkPartyWallets(test.db, E2E_CONTRACTOR_PARTY_ID, wallets);

		// Once with one id, as a person might, then with nothing: neither undoes anything.
		await load(test.db, e2eFixtureSql(test.db, { ...input, logWorkCommodityId: 4101 }));
		await load(test.db, e2eFixtureSql(test.db, { ...input, milestoneHitCommodityId: 4102 }));
		await load(test.db, e2eFixtureSql(test.db, input));

		const campaign = await getCampaign(test.db, E2E_CAMPAIGN_ID);
		expect(campaign?.logWorkCommodityId).toBe(4101);
		expect(campaign?.milestoneHitCommodityId).toBe(4102);
		const after = await getParty(test.db, E2E_CONTRACTOR_PARTY_ID);
		expect(after?.reporterCode).toBe(before?.reporterCode);
		expect(after).toMatchObject(wallets);
		expect(await listMilestones(test.db, E2E_CAMPAIGN_ID)).toHaveLength(3);
	});

	it('mints new reporter codes each time, and refuses a malformed domain or id', () => {
		const codes = [e2eFixture(input), e2eFixture(input)].flatMap((fixture) =>
			fixture.parties.map((party) => party.reporterCode)
		);
		expect(new Set(codes).size).toBe(4);
		expect(() => e2eFixture({ ...input, inboxDomain: 'https://e2e.m.todaq.net' })).toThrow();
		expect(() => e2eFixture({ ...input, logWorkCommodityId: -1 })).toThrow();
	});
});
