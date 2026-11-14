import { DEPOSIT_AMOUNT, partySchema, type Deposit, type Entry } from '@tejido/contracts';
import { sql } from 'drizzle-orm';
import { fixtures } from '@tejido/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hasCampaigns, runMigrations, seedFixtures, seedFixturesSql } from './admin.ts';
import {
	countWorkLogs,
	findPartyByReporterCode,
	getCampaign,
	getEntry,
	getMilestone,
	getParty,
	insertEntryAdvancingMilestone,
	insertEntryWithDeposit,
	linkPartyWallets,
	listCampaigns,
	listDeposits,
	listEntries,
	listMilestones,
	listParties,
	setPartyRelationship
} from './index.ts';
import { deposits, entries } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const byId = <T extends { id: string }>(records: T[]) =>
	[...records].sort((a, b) => a.id.localeCompare(b.id));

let test: TestDatabase;

afterEach(() => test?.destroy());

describe('a seeded database', () => {
	beforeEach(async () => {
		test = await createTestDatabase({ seed: true });
	});

	it('returns the fixtures exactly as the contracts define them', async () => {
		const { db } = test;
		const { campaign } = fixtures;

		expect(await listCampaigns(db)).toEqual([campaign]);
		expect(await getCampaign(db, campaign.id)).toEqual(campaign);
		expect(await listParties(db, campaign.id)).toEqual(fixtures.parties);
		expect(await listMilestones(db, campaign.id)).toEqual(fixtures.milestones);
		expect(byId(await listEntries(db, campaign.id))).toEqual(byId(fixtures.entries));
		expect(byId(await listDeposits(db, campaign.id))).toEqual(byId(fixtures.deposits));
	});

	it('lists entries newest first', async () => {
		const filedAt = (await listEntries(test.db, fixtures.campaign.id)).map(
			(entry) => entry.filedAt
		);
		expect(filedAt).toEqual([...filedAt].sort().reverse());
		expect(filedAt).toHaveLength(5);
	});

	it('lists milestones in their campaign order', async () => {
		const ids = (await listMilestones(test.db, fixtures.campaign.id)).map((m) => m.id);
		expect(ids).toEqual(['m1-foundation', 'm2-walls', 'm3-books-delivered']);
	});

	it('finds single records, and nothing for unknown ids', async () => {
		const { db } = test;
		const [party] = fixtures.parties;
		const [entry] = fixtures.entries;

		expect(await getParty(db, party?.id ?? '')).toEqual(party);
		expect(await getEntry(db, entry?.id ?? '')).toEqual(entry);
		expect(await getMilestone(db, fixtures.campaign.id, 'm2-walls')).toEqual(
			fixtures.milestones[1]
		);

		expect(await getCampaign(db, 'nope')).toBeUndefined();
		expect(await getParty(db, 'nope')).toBeUndefined();
		expect(await getEntry(db, 'nope')).toBeUndefined();
		expect(await getMilestone(db, fixtures.campaign.id, 'nope')).toBeUndefined();
		expect(await getMilestone(db, 'nope', 'm2-walls')).toBeUndefined();
	});

	it('resolves a reporter code to its one party', async () => {
		for (const party of fixtures.parties) {
			expect(await findPartyByReporterCode(test.db, party.reporterCode)).toEqual(party);
		}
		expect(await findPartyByReporterCode(test.db, 'rc_22222222222222222222')).toBeUndefined();
	});

	it('refuses to seed twice', async () => {
		expect(await hasCampaigns(test.db)).toBe(true);
		await expect(seedFixtures(test.db)).rejects.toThrow();
		expect(await listCampaigns(test.db)).toHaveLength(1);
	});
});

describe('writing', () => {
	const party = fixtures.parties[0];
	const now = '2026-11-14T12:00:00.000Z';

	const entry: Entry = {
		id: 'ent-new',
		campaignId: fixtures.campaign.id,
		milestoneId: 'm2-walls',
		partyId: party?.id ?? '',
		item: 'log_work',
		inputs: {
			reporter_code: party?.reporterCode ?? '',
			milestone_id: 'm2-walls',
			summary: 'East wall at lintel height.'
		},
		status: 'filed',
		statusReason: null,
		payingWallet: null,
		twistId: null,
		filedAt: now,
		stampedAt: null,
		updatedAt: now
	};
	const deposit: Deposit = {
		id: 'dep-new',
		entryId: entry.id,
		amount: DEPOSIT_AMOUNT.log_work,
		refundedAt: null
	};

	beforeEach(async () => {
		test = await createTestDatabase({ seed: true });
	});

	it('saves an entry together with its deposit', async () => {
		await insertEntryWithDeposit(test.db, entry, deposit);

		expect(await getEntry(test.db, entry.id)).toEqual(entry);
		expect(await listDeposits(test.db, fixtures.campaign.id)).toContainEqual(deposit);
		expect((await listEntries(test.db, fixtures.campaign.id))[0]).toEqual(entry);
	});

	it('saves neither when the deposit cannot be saved', async () => {
		const clash = { ...deposit, id: fixtures.deposits[0]?.id ?? '' };

		await expect(insertEntryWithDeposit(test.db, entry, clash)).rejects.toThrow();
		expect(await getEntry(test.db, entry.id)).toBeUndefined();
	});

	it('refuses an entry for a milestone that is not in its campaign', async () => {
		const stray = { ...entry, milestoneId: 'm9-nowhere' };

		await expect(insertEntryWithDeposit(test.db, stray, deposit)).rejects.toThrow();
		expect(await getEntry(test.db, entry.id)).toBeUndefined();
	});

	it('moves the milestone to its next state together with the entry', async () => {
		const moved = await insertEntryAdvancingMilestone(test.db, entry, deposit, {
			from: 'open',
			to: 'claimed',
			confirmedAt: null
		});

		expect(moved).toBe(true);
		expect(await getEntry(test.db, entry.id)).toEqual(entry);
		expect(await getMilestone(test.db, fixtures.campaign.id, 'm2-walls')).toMatchObject({
			state: 'claimed',
			confirmedAt: null
		});
	});

	it('saves the entry but leaves a milestone that is not in the expected state', async () => {
		// m2-walls is open, so nothing can take it from claimed to confirmed.
		const moved = await insertEntryAdvancingMilestone(test.db, entry, deposit, {
			from: 'claimed',
			to: 'confirmed_independent',
			confirmedAt: now
		});

		expect(moved).toBe(false);
		expect(await getEntry(test.db, entry.id)).toEqual(entry);
		expect(await getMilestone(test.db, fixtures.campaign.id, 'm2-walls')).toMatchObject({
			state: 'open',
			confirmedAt: null
		});
	});

	it('moves no milestone when the entry cannot be saved', async () => {
		const clash = { ...deposit, id: fixtures.deposits[0]?.id ?? '' };
		const advance = { from: 'open', to: 'claimed', confirmedAt: null } as const;

		await expect(insertEntryAdvancingMilestone(test.db, entry, clash, advance)).rejects.toThrow();
		expect(await getEntry(test.db, entry.id)).toBeUndefined();
		expect((await getMilestone(test.db, fixtures.campaign.id, 'm2-walls'))?.state).toBe('open');
	});

	it('counts the work logs one party has filed on one milestone', async () => {
		const { id } = fixtures.campaign;

		expect(await countWorkLogs(test.db, id, 'm2-walls', party?.id ?? '')).toBe(2);
		// The contractor's entries on the foundation are milestone hits, not work logs.
		expect(await countWorkLogs(test.db, id, 'm1-foundation', party?.id ?? '')).toBe(0);
		expect(await countWorkLogs(test.db, id, 'm2-walls', fixtures.parties[1]?.id ?? '')).toBe(0);
	});

	it('refuses a second deposit on one entry, and a twist id used twice', async () => {
		const [first, second] = fixtures.entries;

		await expect(
			test.db.insert(deposits).values({ ...deposit, entryId: first?.id ?? '' })
		).rejects.toThrow();
		await expect(
			test.db.insert(entries).values({ ...entry, twistId: second?.twistId ?? null })
		).rejects.toThrow();
	});

	it('stores both wallet hostnames on the party, each in its own column', async () => {
		const id = party?.id ?? '';
		const agent = fixtures.parties[1]?.agentWalletHostname;
		const primary = fixtures.parties[1]?.primaryWalletHostname;
		if (!agent || !primary) throw new Error('fixture parties have wallets');

		await linkPartyWallets(test.db, id, {
			agentWalletHostname: agent,
			primaryWalletHostname: primary
		});

		const linked = await getParty(test.db, id);
		expect(linked?.agentWalletHostname).toBe(agent);
		expect(linked?.primaryWalletHostname).toBe(primary);
	});
});

describe('how a party relates to the project', () => {
	beforeEach(async () => {
		test = await createTestDatabase();
		await seedFixtures(test.db);
	});

	it('is read back as the fixtures recorded it', async () => {
		const headTeacher = await getParty(test.db, 'head-teacher');
		expect(headTeacher?.relationship).toBe('stakeholder');
		expect(headTeacher?.relationshipReason).toBe(
			'Head teacher of the school whose library is being rebuilt.'
		);
		expect((await getParty(test.db, 'contractor'))?.relationship).toBe('participant');
	});

	it('is null, not a default, for a party stored without one', async () => {
		// A row as it was written before the columns existed: neither value is given.
		await test.db.run(
			sql`INSERT INTO parties (id, campaign_id, role, name, title, email, reporter_code, created_at)
				VALUES ('inspector', ${fixtures.campaign.id}, 'confirmer', 'A. Inspector', 'Building inspector', 'inspector@parish.example', 'rc_22222222222222222223', '2026-10-06T09:00:00.000Z')`
		);

		const stored = await getParty(test.db, 'inspector');
		expect(stored?.relationship).toBeNull();
		expect(stored?.relationshipReason).toBeNull();
		expect(partySchema.parse(stored)).toEqual(stored);
	});

	it('is recorded, replaced and cleared by setPartyRelationship', async () => {
		const reason = 'Employed by the parish council. Not paid by the project.';
		await setPartyRelationship(test.db, 'head-teacher', {
			relationship: 'independent',
			relationshipReason: reason
		});
		// Nothing else on the party changes, and no other party is touched.
		expect(await getParty(test.db, 'head-teacher')).toEqual({
			...fixtures.parties[2],
			relationship: 'independent',
			relationshipReason: reason
		});
		expect(await getParty(test.db, 'contractor')).toEqual(fixtures.parties[0]);

		await setPartyRelationship(test.db, 'head-teacher', {
			relationship: null,
			relationshipReason: null
		});
		expect((await getParty(test.db, 'head-teacher'))?.relationship).toBeNull();
	});

	it('refuses a reason longer than the contract allows, and stores nothing', async () => {
		await expect(
			setPartyRelationship(test.db, 'head-teacher', {
				relationship: 'independent',
				relationshipReason: 'x'.repeat(301)
			})
		).rejects.toThrow();
		expect(await getParty(test.db, 'head-teacher')).toEqual(fixtures.parties[2]);
	});
});

describe('setting a database up', () => {
	it('starts empty after migrations, and migrating again changes nothing', async () => {
		test = await createTestDatabase();

		expect(await hasCampaigns(test.db)).toBe(false);
		await runMigrations(test.db);
		await seedFixtures(test.db);
		await runMigrations(test.db);
		expect(await listEntries(test.db, fixtures.campaign.id)).toHaveLength(5);
	});

	it('writes the seed as SQL that leaves a database exactly as seeding does', async () => {
		test = await createTestDatabase();
		await test.db.run(seedFixturesSql(test.db).split(';\n')[0] ?? '');
		expect(await getCampaign(test.db, fixtures.campaign.id)).toEqual(fixtures.campaign);

		const statements = seedFixturesSql(test.db).split(';\n');
		for (const statement of statements.slice(1)) await test.db.run(statement);
		expect(byId(await listParties(test.db, fixtures.campaign.id))).toEqual(byId(fixtures.parties));
		expect(byId(await listEntries(test.db, fixtures.campaign.id))).toEqual(byId(fixtures.entries));
	});
});
