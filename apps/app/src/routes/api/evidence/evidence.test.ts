// Calls the endpoint's own handler against a real, migrated, seeded local D1. The evidence
// store is a recording stand-in made here in the test file, so a test can see whether
// anything was stored. Nothing reaches the network.
import {
	EVIDENCE_FILE_FIELD,
	EVIDENCE_NOT_PUBLIC_KIND_FIELD,
	EVIDENCE_NOT_PUBLIC_KIND_MAX,
	EVIDENCE_NOT_PUBLIC_REASON_FIELD,
	EVIDENCE_VISIBILITY_FIELD,
	evidenceUploadResponseSchema
} from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { getEvidenceFile } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '#lib/server/session.ts';
import { outcome } from '#lib/server/test-helpers.ts';
import { POST } from './+server.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const SHA256 = createHash('sha256').update(PNG).digest('hex');

const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const sessionFor = (party: typeof contractor): Session => ({
	sub: `qatom-user-${party.id}`,
	email: party.email,
	partyId: party.id
});

const NOT_PUBLIC = {
	[EVIDENCE_VISIBILITY_FIELD]: 'not_public',
	[EVIDENCE_NOT_PUBLIC_KIND_FIELD]: 'Class list',
	[EVIDENCE_NOT_PUBLIC_REASON_FIELD]: 'It has pupils’ names on it.'
};

let test: TestDatabase;
let stored: Map<string, Buffer>;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	stored = new Map();
});
afterEach(() => test?.destroy());

function upload(session: Session | null, fields: Record<string, string> = {}) {
	const form = new FormData();
	form.set(EVIDENCE_FILE_FIELD, new File([PNG], 'site.png', { type: 'image/png' }));
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	const request = new Request('http://localhost:5174/api/evidence', { method: 'POST', body: form });
	const evidence = {
		put: (name: string, bytes: Buffer) => Promise.resolve(void stored.set(name, bytes)),
		head: (name: string) => Promise.resolve(stored.has(name) ? { key: name } : null)
	};
	const locals = { ctx: { evidence, db: test.db }, session };
	return outcome(() =>
		// A whole RequestEvent cannot be built outside SvelteKit; the handler uses only these parts.
		POST({ request, locals, url: new URL(request.url) } as unknown as Parameters<typeof POST>[0])
	);
}

/** The answer of an upload that must be accepted. */
async function answer(session: Session, fields: Record<string, string> = {}) {
	const result = await upload(session, fields);
	if (result.kind !== 'response') throw new Error(`expected a response, got ${result.kind}`);
	expect(result.response.status).toBe(201);
	return evidenceUploadResponseSchema.parse(await result.response.json());
}

describe('POST /api/evidence', () => {
	it('refuses a caller who is not signed in, and stores nothing', async () => {
		const result = await upload(null);

		expect(result).toMatchObject({ kind: 'error', status: 401 });
		expect(stored.size).toBe(0);
	});

	it('refuses someone signed in who is not a party on a campaign', async () => {
		const result = await upload({
			sub: 'qatom-user-9',
			email: 'someone@else.example',
			partyId: null
		});

		expect(result).toMatchObject({ kind: 'error', status: 403 });
		expect(stored.size).toBe(0);
	});

	it('stores a file from a signed-in party and answers with its URL and SHA-256', async () => {
		expect(await answer(sessionFor(contractor))).toEqual({
			url: `http://localhost:5174/evidence/${SHA256}.png`,
			sha256: SHA256,
			visibility: 'public'
		});
		expect(stored.get(`${SHA256}.png`)?.equals(PNG)).toBe(true);
		// Who uploaded it is on record, so only they can later change who may see it.
		expect(await getEvidenceFile(test.db, SHA256)).toMatchObject({
			uploadedByPartyId: contractor.id,
			visibility: 'public'
		});
	});
});

describe('choosing who may see the file', () => {
	it('stores a file as not public, with what donors are told instead', async () => {
		expect(await answer(sessionFor(contractor), NOT_PUBLIC)).toEqual({
			url: `http://localhost:5174/evidence/${SHA256}.png`,
			sha256: SHA256,
			visibility: 'not_public'
		});
		expect(stored.has(`${SHA256}.png`)).toBe(true);
		expect(await getEvidenceFile(test.db, SHA256)).toMatchObject({
			uploadedByPartyId: contractor.id,
			visibility: 'not_public',
			notPublicKind: 'Class list',
			notPublicReason: 'It has pupils’ names on it.'
		});
	});

	it('refuses not public without saying what the file is and why, and stores nothing', async () => {
		const incomplete = [
			{ [EVIDENCE_VISIBILITY_FIELD]: 'not_public' },
			{ ...NOT_PUBLIC, [EVIDENCE_NOT_PUBLIC_KIND_FIELD]: '   ' },
			{ ...NOT_PUBLIC, [EVIDENCE_NOT_PUBLIC_REASON_FIELD]: '' },
			{
				...NOT_PUBLIC,
				[EVIDENCE_NOT_PUBLIC_KIND_FIELD]: 'k'.repeat(EVIDENCE_NOT_PUBLIC_KIND_MAX + 1)
			},
			{ [EVIDENCE_VISIBILITY_FIELD]: 'secret' }
		];
		for (const fields of incomplete) {
			expect(await upload(sessionFor(contractor), fields)).toMatchObject({
				kind: 'error',
				status: 422
			});
		}
		expect(stored.size).toBe(0);
		expect(await getEvidenceFile(test.db, SHA256)).toBeUndefined();
	});

	it('keeps a not-public file not public when its uploader sends it again without saying', async () => {
		await answer(sessionFor(contractor), NOT_PUBLIC);

		expect((await answer(sessionFor(contractor))).visibility).toBe('not_public');
	});

	it('makes it public again only when its uploader says so', async () => {
		await answer(sessionFor(contractor), NOT_PUBLIC);

		// Someone else who holds the same bytes cannot.
		expect(
			await upload(sessionFor(supplier), { [EVIDENCE_VISIBILITY_FIELD]: 'public' })
		).toMatchObject({ kind: 'error', status: 409 });
		expect((await getEvidenceFile(test.db, SHA256))?.visibility).toBe('not_public');

		expect(
			(await answer(sessionFor(contractor), { [EVIDENCE_VISIBILITY_FIELD]: 'public' })).visibility
		).toBe('public');
	});

	it('does not let someone else hide a file another party uploaded', async () => {
		await answer(sessionFor(contractor));

		expect(await upload(sessionFor(supplier), NOT_PUBLIC)).toMatchObject({
			kind: 'error',
			status: 409
		});
		expect((await getEvidenceFile(test.db, SHA256))?.visibility).toBe('public');
	});
});
