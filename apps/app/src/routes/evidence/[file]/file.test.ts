// Calls the route's own handler against a real, migrated, seeded local D1. The evidence store
// is a stand-in made here in the test file, which also counts how often a file's bytes were
// read. Nothing reaches the network.
import { fixtures } from '@tejido/contracts/fixtures';
import { campaigns, milestones, parties, recordEvidenceUpload } from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '#lib/server/session.ts';
import { outcome } from '#lib/server/test-helpers.ts';
import { GET } from './+server.ts';

// The fixtures: the contractor and the supplier do the work, the head teacher confirms.
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

const SHA256 = 'a'.repeat(64);
const NAME = `${SHA256}.pdf`;
const BYTES = Buffer.from('%PDF-1.7\nclass list\n%%EOF\n');
const NOW = '2026-11-14T12:00:00.000Z';

const sessionFor = (partyId: string | null): Session => ({
	sub: `qatom-user-${partyId ?? 'none'}`,
	email: 'someone@tejido.example',
	partyId
});

let test: TestDatabase;
let stored: Map<string, Buffer>;
/** How many times the bytes of a file were read from the store. */
let reads: number;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	stored = new Map([[NAME, BYTES]]);
	reads = 0;
});
afterEach(() => test?.destroy());

function fetchFile(session: Session | null, file = NAME, headers: Record<string, string> = {}) {
	const evidence = {
		get: (name: string) => {
			const bytes = stored.get(name);
			if (!bytes) return Promise.resolve(null);
			reads += 1;
			return Promise.resolve({ arrayBuffer: () => Promise.resolve(new Uint8Array(bytes).buffer) });
		},
		head: (name: string) => Promise.resolve(stored.has(name) ? { key: name } : null)
	};
	const request = new Request(`http://localhost:5174/evidence/${file}`, { headers });
	const locals = { ctx: { evidence, db: test.db }, session };
	return outcome(() =>
		// A whole RequestEvent cannot be built outside SvelteKit; the handler uses only these parts.
		GET({ params: { file }, locals, request } as unknown as Parameters<typeof GET>[0])
	);
}

/** The response of a fetch that must be served. */
async function served(session: Session | null, headers: Record<string, string> = {}) {
	const result = await fetchFile(session, NAME, headers);
	if (result.kind !== 'response') throw new Error(`expected a response, got ${result.kind}`);
	return result.response;
}

const mark = (visibility: 'public' | 'not_public', partyId = contractor.id) =>
	recordEvidenceUpload(test.db, {
		sha256: SHA256,
		partyId,
		choice:
			visibility === 'public'
				? { visibility }
				: { visibility, kind: 'Class list', reason: 'It has pupils’ names on it.' },
		alreadyStored: true,
		now: NOW
	});

/** A second campaign with a third party and its own confirmer. */
async function addOtherCampaign() {
	await test.db.insert(campaigns).values({ ...fixtures.campaign, id: 'well', title: 'A well' });
	await test.db.insert(parties).values([
		{
			...contractor,
			id: 'driller',
			campaignId: 'well',
			reporterCode: 'rc_22222222222222222222',
			email: 'driller@well.example'
		},
		{
			...headTeacher,
			id: 'water-committee',
			campaignId: 'well',
			reporterCode: 'rc_33333333333333333333',
			email: 'committee@well.example'
		}
	]);
	await test.db.insert(milestones).values({
		campaignId: 'well',
		id: 'm1-drilled',
		position: 1,
		title: 'Well drilled',
		description: '',
		kind: 'construction',
		ownerPartyId: 'driller',
		confirmerPartyId: 'water-committee',
		dueDate: '2026-12-18',
		state: 'open',
		confirmedAt: null
	});
}

describe('GET /evidence/{file}: a public file', () => {
	it('is served to anyone, signed in or not', async () => {
		for (const session of [null, sessionFor(null), sessionFor(supplier.id)]) {
			const response = await served(session);

			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('application/pdf');
			expect(Buffer.from(await response.arrayBuffer()).equals(BYTES)).toBe(true);
		}
	});

	it('is served the same whether it has a record or was stored before records were kept', async () => {
		await mark('public');

		expect((await served(null)).status).toBe(200);
	});

	it('makes a browser ask again before reusing its copy', async () => {
		const response = await served(null);

		expect(response.headers.get('cache-control')).toBe('public, no-cache');
		expect(response.headers.get('etag')).toBe(`"${SHA256}"`);
	});

	it('answers a browser that already has the file without sending it again', async () => {
		const response = await served(null, { 'if-none-match': `"${SHA256}"` });

		expect(response.status).toBe(304);
		expect(reads).toBe(0);
	});

	it('answers 404 for a name it could not have written, and for a file it does not hold', async () => {
		expect(await fetchFile(null, '../secret.pdf')).toMatchObject({ kind: 'error', status: 404 });
		expect(await fetchFile(null, `${SHA256}.exe`)).toMatchObject({ kind: 'error', status: 404 });
		expect(await fetchFile(null, `${'b'.repeat(64)}.pdf`)).toMatchObject({
			kind: 'error',
			status: 404
		});
		expect(
			await fetchFile(null, `${'b'.repeat(64)}.pdf`, { 'if-none-match': `"${'b'.repeat(64)}"` })
		).toMatchObject({ kind: 'error', status: 404 });
	});
});

describe('GET /evidence/{file}: a file marked not public', () => {
	beforeEach(async () => {
		await mark('not_public');
		await addOtherCampaign();
	});

	it('is served to the party who uploaded it, and never left in a cache', async () => {
		const response = await served(sessionFor(contractor.id));

		expect(response.status).toBe(200);
		expect(Buffer.from(await response.arrayBuffer()).equals(BYTES)).toBe(true);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('is served to a confirmer of a milestone in that campaign', async () => {
		const response = await served(sessionFor(headTeacher.id));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('private, no-store');
	});

	it('is refused to someone who is not signed in', async () => {
		expect(await fetchFile(null)).toMatchObject({ kind: 'error', status: 401 });
	});

	it('is refused to someone signed in without a party', async () => {
		expect(await fetchFile(sessionFor(null))).toMatchObject({ kind: 'error', status: 403 });
	});

	it('is refused to another third party on the same campaign', async () => {
		expect(await fetchFile(sessionFor(supplier.id))).toMatchObject({ kind: 'error', status: 403 });
	});

	it('is refused to a third party and to a confirmer of another campaign', async () => {
		expect(await fetchFile(sessionFor('driller'))).toMatchObject({ kind: 'error', status: 403 });
		expect(await fetchFile(sessionFor('water-committee'))).toMatchObject({
			kind: 'error',
			status: 403
		});
	});

	it('is refused under every extension, since who may see it goes by the SHA-256', async () => {
		stored.set(`${SHA256}.jpg`, BYTES);

		expect(await fetchFile(null, `${SHA256}.jpg`)).toMatchObject({ kind: 'error', status: 401 });
	});

	it('is refused to a browser that kept a copy from when it was public', async () => {
		expect(await fetchFile(null, NAME, { 'if-none-match': `"${SHA256}"` })).toMatchObject({
			kind: 'error',
			status: 401
		});
	});

	it('never reads the file from the store for someone who is refused', async () => {
		await fetchFile(null);
		await fetchFile(sessionFor(supplier.id));
		await fetchFile(sessionFor('water-committee'));

		expect(reads).toBe(0);
	});

	it('is served to anyone again once its uploader makes it public', async () => {
		await mark('public');

		expect((await served(null)).status).toBe(200);
	});
});
