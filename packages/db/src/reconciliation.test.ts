// The record functions the reconciler uses, against a real seeded D1.
import { fixtures } from '@tejido/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getEntry,
	listEntries,
	listUnreconciledEntries,
	listUsedTwistIds,
	stampEntries,
	type EntryStamp
} from './index.ts';
import { campaigns, deposits, entries, milestones, parties } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const unstamped = fixtures.entries.filter((entry) => entry.twistId === null);
const alreadyStamped = fixtures.entries.find((entry) => entry.twistId !== null)!;

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test.destroy());

function stamp(entryId: string, twistId: string): EntryStamp {
	return {
		entryId,
		twistId,
		payingWallet: 'payer.wallets.tejido.example',
		stampedAt: '2026-11-13T17:02:10.000Z',
		status: 'verified',
		statusReason: null,
		updatedAt: '2026-11-14T12:00:00.000Z'
	};
}

describe('listUnreconciledEntries', () => {
	it('returns only entries without a ledger transaction, oldest first, with party and deposit', async () => {
		const waiting = await listUnreconciledEntries(test.db, CAMPAIGN);

		expect(unstamped).toHaveLength(2);
		expect(waiting.map((row) => row.entry.id)).toEqual(
			[...unstamped].sort((a, b) => a.filedAt.localeCompare(b.filedAt)).map((entry) => entry.id)
		);
		for (const row of waiting) {
			expect(row.entry).toEqual(fixtures.entries.find((entry) => entry.id === row.entry.id));
			expect(row.party).toEqual(fixtures.parties.find((party) => party.id === row.entry.partyId));
			expect(row.depositAmount).toBe(
				fixtures.deposits.find((deposit) => deposit.entryId === row.entry.id)!.amount
			);
		}
	});

	it('returns nothing for a campaign it does not know', async () => {
		expect(await listUnreconciledEntries(test.db, 'no-such-campaign')).toEqual([]);
	});

	it('with no campaign named, returns every campaign’s waiting entries at once, oldest first', async () => {
		// A second campaign with one waiting entry of its own, filed before the fixtures' two.
		const other = 'harbour-clinic';
		const party = { ...fixtures.parties[0]!, id: 'harbour-joinery', campaignId: other };
		const milestone = { ...fixtures.milestones[0]!, campaignId: other, ownerPartyId: party.id };
		await test.db.insert(campaigns).values({ ...fixtures.campaign, id: other });
		await test.db.insert(parties).values({ ...party, reporterCode: 'rc_22222222222222222222' });
		await test.db.insert(milestones).values({ ...milestone, confirmerPartyId: party.id });
		const template = unstamped[0]!;
		const entry = {
			...template,
			id: 'ent-harbour-1',
			campaignId: other,
			milestoneId: milestone.id,
			partyId: party.id,
			filedAt: '2026-01-01T00:00:00.000Z'
		};
		await test.db.insert(entries).values(entry);
		await test.db
			.insert(deposits)
			.values({ id: 'dep-harbour-1', entryId: entry.id, amount: 100, refundedAt: null });

		const all = await listUnreconciledEntries(test.db);
		expect(all.map((row) => [row.entry.campaignId, row.entry.id])).toEqual([
			[other, 'ent-harbour-1'],
			...[...unstamped]
				.sort((a, b) => a.filedAt.localeCompare(b.filedAt))
				.map((waiting) => [CAMPAIGN, waiting.id])
		]);
		// Asking for one campaign still gives only that campaign's.
		expect((await listUnreconciledEntries(test.db, other)).map((row) => row.entry.id)).toEqual([
			'ent-harbour-1'
		]);
		expect(await listUnreconciledEntries(test.db, CAMPAIGN)).toHaveLength(2);
	});
});

describe('listUsedTwistIds', () => {
	it('answers which transactions already prove an entry', async () => {
		const used = await listUsedTwistIds(test.db, [alreadyStamped.twistId!, '41unused']);
		expect([...used]).toEqual([alreadyStamped.twistId]);
	});

	it('copes with more ids than one statement can bind', async () => {
		const many = Array.from({ length: 250 }, (_, index) => `41free${index}`);
		const used = await listUsedTwistIds(test.db, [...many, alreadyStamped.twistId!]);
		expect([...used]).toEqual([alreadyStamped.twistId]);
	});

	it('answers an empty set for no ids', async () => {
		expect((await listUsedTwistIds(test.db, [])).size).toBe(0);
	});
});

describe('stampEntries', () => {
	it('records the transaction, payer, time and status on the entry', async () => {
		const target = unstamped[0]!;
		const written = stamp(target.id, '41new');

		expect(await stampEntries(test.db, [written])).toEqual([target.id]);
		expect(await getEntry(test.db, target.id)).toEqual({
			...target,
			twistId: '41new',
			payingWallet: written.payingWallet,
			stampedAt: written.stampedAt,
			status: 'verified',
			statusReason: null,
			updatedAt: written.updatedAt
		});
	});

	it('does nothing for an empty list', async () => {
		expect(await stampEntries(test.db, [])).toEqual([]);
	});

	it('leaves an entry that already has a transaction as it is', async () => {
		expect(await stampEntries(test.db, [stamp(alreadyStamped.id, '41other')])).toEqual([]);
		expect(await getEntry(test.db, alreadyStamped.id)).toEqual(alreadyStamped);
	});

	it('does not give one transaction to a second entry, in the same batch or a later one', async () => {
		const [first, second] = unstamped as [(typeof unstamped)[0], (typeof unstamped)[0]];

		expect(
			await stampEntries(test.db, [stamp(first.id, '41same'), stamp(second.id, '41same')])
		).toEqual([first.id]);
		expect(await stampEntries(test.db, [stamp(second.id, '41same')])).toEqual([]);
		expect(await stampEntries(test.db, [stamp(second.id, alreadyStamped.twistId!)])).toEqual([]);
		expect(await getEntry(test.db, second.id)).toEqual(second);
	});

	it('changes nothing when the same stamps are recorded twice', async () => {
		const stamps = [stamp(unstamped[0]!.id, '41a'), stamp(unstamped[1]!.id, '41b')];
		await stampEntries(test.db, stamps);
		const after = await listEntries(test.db, CAMPAIGN);

		expect(await stampEntries(test.db, stamps)).toEqual([]);
		expect(await listEntries(test.db, CAMPAIGN)).toEqual(after);
	});
});
