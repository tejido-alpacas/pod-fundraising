import { fixtures } from '@tejido/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	deleteSealedSignInTokens,
	readSealedSignInTokens,
	saveSealedSignInTokens,
	type SealedSignInTokens
} from './index.ts';
import { partySignInTokens } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

// Stand-ins for what the App's sealing produces. The database treats them as opaque text.
const SEALED_FIRST = 'sealed.v1.first-opaque-text';
const SEALED_SECOND = 'sealed.v1.second-opaque-text';

const [contractor, supplier] = fixtures.parties;
if (!contractor || !supplier) throw new Error('The fixtures need at least two parties.');

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test?.destroy());

describe('sealed sign-in tokens', () => {
	it('has nothing for a party that has not signed in', async () => {
		expect(await readSealedSignInTokens(test.db, contractor.id)).toBeUndefined();
	});

	it('saves a row and reads back exactly what was given', async () => {
		const record: SealedSignInTokens = {
			partyId: contractor.id,
			sealedTokens: SEALED_FIRST,
			updatedAt: '2026-11-14T10:00:00.000Z'
		};
		await saveSealedSignInTokens(test.db, record);

		expect(await readSealedSignInTokens(test.db, contractor.id)).toEqual(record);
	});

	it('replaces the row on a later save, keeping one row per party', async () => {
		await saveSealedSignInTokens(test.db, {
			partyId: contractor.id,
			sealedTokens: SEALED_FIRST,
			updatedAt: '2026-11-14T10:00:00.000Z'
		});
		const later: SealedSignInTokens = {
			partyId: contractor.id,
			sealedTokens: SEALED_SECOND,
			updatedAt: '2026-11-14T11:00:00.000Z'
		};
		await saveSealedSignInTokens(test.db, later);

		expect(await readSealedSignInTokens(test.db, contractor.id)).toEqual(later);
		expect(await test.db.select().from(partySignInTokens)).toHaveLength(1);
	});

	it('keeps each party separate', async () => {
		await saveSealedSignInTokens(test.db, {
			partyId: contractor.id,
			sealedTokens: SEALED_FIRST,
			updatedAt: '2026-11-14T10:00:00.000Z'
		});
		await saveSealedSignInTokens(test.db, {
			partyId: supplier.id,
			sealedTokens: SEALED_SECOND,
			updatedAt: '2026-11-14T10:05:00.000Z'
		});

		expect((await readSealedSignInTokens(test.db, contractor.id))?.sealedTokens).toBe(SEALED_FIRST);
		expect((await readSealedSignInTokens(test.db, supplier.id))?.sealedTokens).toBe(SEALED_SECOND);
	});

	it('deletes one party’s row and says whether there was one', async () => {
		await saveSealedSignInTokens(test.db, {
			partyId: contractor.id,
			sealedTokens: SEALED_FIRST,
			updatedAt: '2026-11-14T10:00:00.000Z'
		});
		await saveSealedSignInTokens(test.db, {
			partyId: supplier.id,
			sealedTokens: SEALED_SECOND,
			updatedAt: '2026-11-14T10:05:00.000Z'
		});

		expect(await deleteSealedSignInTokens(test.db, contractor.id)).toBe(true);
		expect(await readSealedSignInTokens(test.db, contractor.id)).toBeUndefined();
		expect(await readSealedSignInTokens(test.db, supplier.id)).toBeDefined();

		expect(await deleteSealedSignInTokens(test.db, contractor.id)).toBe(false);
	});

	it('refuses a row for a party that does not exist', async () => {
		await expect(
			saveSealedSignInTokens(test.db, {
				partyId: 'party_nobody',
				sealedTokens: SEALED_FIRST,
				updatedAt: '2026-11-14T10:00:00.000Z'
			})
		).rejects.toThrow();
		expect(await test.db.select().from(partySignInTokens)).toHaveLength(0);
	});
});
