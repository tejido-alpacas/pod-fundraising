// Sealing the person's tokens, and keeping them in a real, migrated local D1.
// Nothing here reaches the network.
import { fixtures } from '@tejido/contracts/fixtures';
import { readSealedSignInTokens } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import type { PersonAccessToken } from '@tejido/qatom/person';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	forgetPersonTokens,
	keepPersonTokens,
	sealPersonTokens,
	unsealPersonTokens,
	usablePersonToken,
	type PersonTokens
} from './person-tokens.ts';
import { seal } from './session.ts';

const SECRET = 'session-secret-session-secret-session';
const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const tokens: PersonTokens = {
	accessToken: 'person-access-token-do-not-leak' as PersonAccessToken,
	refreshToken: 'person-refresh-token-do-not-leak',
	expiresAtMs: NOW + 72 * HOUR
};
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;

beforeEach(() => void vi.useFakeTimers({ now: NOW, toFake: ['Date'] }));
afterEach(() => void vi.useRealTimers());

describe('sealed tokens', () => {
	it('come back exactly as they went in', () => {
		expect(unsealPersonTokens(sealPersonTokens(tokens, SECRET), SECRET)).toEqual(tokens);
	});

	it('come back when there is no refresh token', () => {
		const withoutRefresh = { ...tokens, refreshToken: null };
		expect(unsealPersonTokens(sealPersonTokens(withoutRefresh, SECRET), SECRET)).toEqual(
			withoutRefresh
		);
	});

	it('cannot be read without the key', () => {
		const sealed = sealPersonTokens(tokens, SECRET);
		const decoded = Buffer.from(sealed, 'base64url').toString('latin1');

		for (const readable of [sealed, decoded]) {
			expect(readable).not.toContain(tokens.accessToken);
			expect(readable).not.toContain(String(tokens.refreshToken));
		}
	});

	it('are refused under another secret, or once altered', () => {
		const sealed = sealPersonTokens(tokens, SECRET);
		const bytes = Buffer.from(sealed, 'base64url');
		bytes[bytes.length - 1] = (bytes.at(-1) ?? 0) ^ 1;

		expect(unsealPersonTokens(sealed, `${SECRET}-other`)).toBeNull();
		expect(unsealPersonTokens(bytes.toString('base64url'), SECRET)).toBeNull();
	});

	it('use a key of their own: a session cookie is not tokens, and tokens are not a session', () => {
		// The same secret and the same data, sealed for the session cookie's purpose.
		expect(unsealPersonTokens(seal(tokens, SECRET, 'session', 60), SECRET)).toBeNull();
		expect(unsealPersonTokens(seal(tokens, SECRET, 'sign-in', 60), SECRET)).toBeNull();
	});

	it('are refused when what was sealed is not tokens', () => {
		const sealedAs = (value: unknown) => seal(value, SECRET, 'person-tokens', 60);

		expect(unsealPersonTokens(sealedAs('a string'), SECRET)).toBeNull();
		expect(unsealPersonTokens(sealedAs({ ...tokens, accessToken: '' }), SECRET)).toBeNull();
		expect(unsealPersonTokens(sealedAs({ ...tokens, expiresAtMs: 'soon' }), SECRET)).toBeNull();
		expect(unsealPersonTokens(undefined, SECRET)).toBeNull();
	});

	it('can no longer be opened after thirty days', () => {
		const sealed = sealPersonTokens(tokens, SECRET);

		vi.setSystemTime(NOW + 29 * DAY);
		expect(unsealPersonTokens(sealed, SECRET)).toEqual(tokens);
		vi.setSystemTime(NOW + 31 * DAY);
		expect(unsealPersonTokens(sealed, SECRET)).toBeNull();
	});
});

describe('tokens kept in the database', () => {
	let test: TestDatabase;

	beforeEach(async () => {
		test = await createTestDatabase({ seed: true });
	});
	afterEach(async () => {
		await test.destroy();
	});

	it('are stored sealed, and give the chat the access token back', async () => {
		await keepPersonTokens(test.db, SECRET, contractor.id, tokens);

		const row = await readSealedSignInTokens(test.db, contractor.id);
		expect(row?.sealedTokens).toBeTruthy();
		expect(JSON.stringify(row)).not.toContain(tokens.accessToken);
		expect(JSON.stringify(row)).not.toContain(String(tokens.refreshToken));

		expect(await usablePersonToken(test.db, SECRET, contractor.id)).toEqual({
			ok: true,
			accessToken: tokens.accessToken
		});
	});

	it("are one party's only", async () => {
		await keepPersonTokens(test.db, SECRET, contractor.id, tokens);

		expect(await usablePersonToken(test.db, SECRET, supplier.id)).toEqual({
			ok: false,
			reason: 'none'
		});
	});

	it('are replaced by the next sign-in', async () => {
		await keepPersonTokens(test.db, SECRET, contractor.id, tokens);
		await keepPersonTokens(test.db, SECRET, contractor.id, {
			...tokens,
			accessToken: 'a-newer-token' as PersonAccessToken
		});

		expect(await usablePersonToken(test.db, SECRET, contractor.id)).toEqual({
			ok: true,
			accessToken: 'a-newer-token'
		});
	});

	it('are gone after sign-out', async () => {
		await keepPersonTokens(test.db, SECRET, contractor.id, tokens);
		await forgetPersonTokens(test.db, contractor.id);

		expect(await readSealedSignInTokens(test.db, contractor.id)).toBeUndefined();
		expect(await usablePersonToken(test.db, SECRET, contractor.id)).toEqual({
			ok: false,
			reason: 'none'
		});
	});

	it('are not usable once the access token has run out, or is about to', async () => {
		await keepPersonTokens(test.db, SECRET, contractor.id, tokens);

		vi.setSystemTime(tokens.expiresAtMs! - 10 * 60 * 1000);
		expect(await usablePersonToken(test.db, SECRET, contractor.id)).toMatchObject({ ok: true });
		vi.setSystemTime(tokens.expiresAtMs! - 60 * 1000);
		expect(await usablePersonToken(test.db, SECRET, contractor.id)).toEqual({
			ok: false,
			reason: 'expired'
		});
	});

	it('are not usable when Qatom never said how long the access token lasts', async () => {
		await keepPersonTokens(test.db, SECRET, contractor.id, { ...tokens, expiresAtMs: null });

		expect(await usablePersonToken(test.db, SECRET, contractor.id)).toEqual({
			ok: false,
			reason: 'expired'
		});
	});

	it('are not usable under another secret', async () => {
		await keepPersonTokens(test.db, SECRET, contractor.id, tokens);

		expect(await usablePersonToken(test.db, `${SECRET}-other`, contractor.id)).toEqual({
			ok: false,
			reason: 'none'
		});
	});
});
