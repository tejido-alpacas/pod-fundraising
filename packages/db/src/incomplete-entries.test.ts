// Adding evidence to an incomplete entry, against the real local D1. Nothing is paid for it:
// this package cannot reach Qatom, and these functions write no deposit.
import type { Entry, Photo } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	addEvidenceToIncompleteEntry,
	getEntry,
	getMilestone,
	listDeposits,
	listIncompleteEntries
} from './index.ts';
import { entries } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
// The fixtures' one incomplete entry: the supplier's delivery claim, with one photo already.
const DELIVERY = 'ent-m3-delivery';
const LATER = '2026-11-14T12:00:00.000Z';

const file = (fill: string, extension = 'jpg'): Photo => ({
	url: `http://localhost:5174/evidence/${fill.repeat(64)}.${extension}`,
	sha256: fill.repeat(64)
});

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test?.destroy());

const read = async (id = DELIVERY) => (await getEntry(test.db, id))!;
const add = (entry: Entry, added: Photo[], complete: boolean, partyId = supplier.id) =>
	addEvidenceToIncompleteEntry(test.db, partyId, {
		entry,
		added,
		complete,
		stillMissing: complete ? null : 'Still something.',
		updatedAt: LATER
	});

describe('a party’s incomplete entries', () => {
	it('lists only that party’s entries, and only the incomplete ones', async () => {
		expect((await listIncompleteEntries(test.db, supplier.id)).map((entry) => entry.id)).toEqual([
			DELIVERY
		]);
		expect(await listIncompleteEntries(test.db, contractor.id)).toEqual([]);
		expect(await listIncompleteEntries(test.db, 'nobody')).toEqual([]);
	});
});

describe('adding evidence to an incomplete entry', () => {
	it('adds the files after the ones already there and changes nothing else', async () => {
		const before = await read();

		expect(await add(before, [file('a'), file('b', 'pdf')], false)).toBe('incomplete');

		const after = await read();
		expect(after.inputs.photos).toEqual([...before.inputs.photos!, file('a'), file('b', 'pdf')]);
		expect(after).toEqual({
			...before,
			inputs: { ...before.inputs, photos: after.inputs.photos },
			statusReason: 'Still something.',
			updatedAt: LATER
		});
	});

	it('makes a complete entry `filed` while it has no ledger transaction', async () => {
		expect(await add(await read(), [file('a')], true)).toBe('filed');

		expect(await read()).toMatchObject({ status: 'filed', statusReason: null, twistId: null });
		expect(await listIncompleteEntries(test.db, supplier.id)).toEqual([]);
	});

	it('makes a complete entry `verified` when the reconciler had already stamped it', async () => {
		await test.db
			.update(entries)
			.set({
				twistId: '41stamped',
				payingWallet: supplier.agentWalletHostname,
				stampedAt: '2026-11-11T11:05:40.000Z'
			})
			.where(eq(entries.id, DELIVERY));

		expect(await add(await read(), [file('a')], true)).toBe('verified');
		expect(await read()).toMatchObject({
			status: 'verified',
			statusReason: null,
			twistId: '41stamped',
			payingWallet: supplier.agentWalletHostname,
			stampedAt: '2026-11-11T11:05:40.000Z'
		});
	});

	it('writes no deposit and moves no milestone', async () => {
		const deposits = await listDeposits(test.db, CAMPAIGN);
		const milestone = await getMilestone(test.db, CAMPAIGN, 'm3-books-delivered');

		await add(await read(), [file('a')], true);

		expect(await listDeposits(test.db, CAMPAIGN)).toEqual(deposits);
		expect(await getMilestone(test.db, CAMPAIGN, 'm3-books-delivered')).toEqual(milestone);
	});

	it('changes nothing for a party who did not file the entry', async () => {
		const before = await read();

		expect(await add(before, [file('a')], true, contractor.id)).toBeNull();
		expect(await read()).toEqual(before);
	});

	it('changes nothing on an entry that is not incomplete', async () => {
		const filed = await read('ent-m2-log-2');
		expect(filed.status).toBe('filed');

		expect(await add(filed, [file('a')], true, contractor.id)).toBeNull();
		expect(await read('ent-m2-log-2')).toEqual(filed);
	});

	it('changes nothing if the entry changed after it was read', async () => {
		const stale = await read();
		expect(await add(stale, [file('a')], false)).toBe('incomplete');

		// A second write decided from the same, now out-of-date, reading.
		expect(await add(stale, [file('b')], true)).toBeNull();
		expect((await read()).inputs.photos).toEqual([...stale.inputs.photos!, file('a')]);
		expect((await read()).status).toBe('incomplete');
	});

	it('refuses an eleventh file, and to add nothing', async () => {
		const before = await read();
		const ten = 'abcdef0123'.split('').map((fill) => file(fill));

		await expect(add(before, ten, true)).rejects.toThrow();
		await expect(add(before, [], true)).rejects.toThrow(RangeError);
		expect(await read()).toEqual(before);
	});
});
