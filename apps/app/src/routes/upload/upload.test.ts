// Calls the upload page's own load function and form action. The evidence store is a recording
// stand-in made here in the test file, so a test can see what was stored. Nothing reaches the
// network.
import { isActionFailure } from '@sveltejs/kit';
import {
	EVIDENCE_FILE_FIELD,
	EVIDENCE_MAX_BYTES,
	evidenceUploadResponseSchema,
	photoSchema
} from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { agentEntry, agentList, PROBLEM_SENTENCES, problemFromStatus } from '#lib/evidence.ts';
import type { Session } from '#lib/server/session.ts';
import { actions, load } from './+page.server.ts';

const ORIGIN = 'http://localhost:5174';
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.7\n%%EOF\n');

const png = (name = 'site.png') => new File([PNG], name, { type: 'image/png' });
const pdf = (name = 'receipt.pdf') => new File([PDF], name, { type: 'application/pdf' });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const contractor = fixtures.parties[0]!;
const party: Session = {
	sub: 'qatom-user-123',
	email: contractor.email,
	partyId: contractor.id
};
const noParty: Session = { sub: 'qatom-user-9', email: 'someone@else.example', partyId: null };

let stored: Map<string, Buffer>;
/** Names the store refuses, to stand in for the evidence store failing on one file. */
let failing: Set<string>;

beforeEach(() => {
	stored = new Map();
	failing = new Set();
});

function parts(session: Session | null, body?: FormData) {
	const request = new Request(`${ORIGIN}/upload?/upload`, { method: 'POST', body });
	const evidence = {
		put: (name: string, bytes: Buffer) => {
			if (failing.has(name)) return Promise.reject(new Error('the store is down'));
			return Promise.resolve(void stored.set(name, bytes));
		}
	};
	return { request, locals: { ctx: { evidence }, session }, url: new URL(request.url) };
}

// A whole RequestEvent cannot be built outside SvelteKit; the page's server code uses only
// the parts above.
const view = (session: Session | null) =>
	load(parts(session) as unknown as Parameters<typeof load>[0]);

function upload(session: Session | null, ...files: File[]) {
	const form = new FormData();
	for (const file of files) form.append(EVIDENCE_FILE_FIELD, file);
	return actions.upload(parts(session, form) as unknown as Parameters<typeof actions.upload>[0]);
}

/** The results of an upload the action accepted. */
async function results(session: Session | null, ...files: File[]) {
	const answer = await upload(session, ...files);
	if (!('results' in answer)) throw new Error('expected results, got a refusal');
	return answer.results;
}

/** The status and sentence of an upload the action refused outright. */
async function refusal(session: Session | null, ...files: File[]) {
	const answer = await upload(session, ...files);
	expect(isActionFailure(answer)).toBe(true);
	if ('results' in answer) throw new Error('expected a refusal');
	return { status: answer.status, refused: answer.data.refused };
}

describe('the upload page', () => {
	it('tells someone who is not signed in that they cannot upload', async () => {
		expect(await view(null)).toEqual({ viewer: 'signed_out', email: null });
	});

	it('tells someone signed in without a party that they are not on a campaign', async () => {
		expect(await view(noParty)).toEqual({ viewer: 'no_party', email: noParty.email });
	});

	it('shows the form to a signed-in party', async () => {
		expect(await view(party)).toEqual({ viewer: 'party', email: party.email });
	});
});

describe('uploading from the page', () => {
	it('refuses someone who is not signed in, and stores nothing', async () => {
		expect(await refusal(null, png())).toEqual({
			status: 401,
			refused: PROBLEM_SENTENCES.not_signed_in
		});
		expect(stored.size).toBe(0);
	});

	it('refuses someone signed in who is not a party on a campaign', async () => {
		expect(await refusal(noParty, png())).toEqual({
			status: 403,
			refused: PROBLEM_SENTENCES.not_a_party
		});
		expect(stored.size).toBe(0);
	});

	it('refuses a form sent with no file chosen', async () => {
		// What a browser sends for a file input nobody touched.
		const untouched = new File([], '', { type: 'application/octet-stream' });

		expect(await refusal(party, untouched, untouched)).toMatchObject({ status: 400 });
		expect(await refusal(party)).toMatchObject({ status: 400 });
		expect(stored.size).toBe(0);
	});

	it('stores a picture and answers with its URL and SHA-256, as the API does', async () => {
		const [result, ...rest] = await results(party, png());

		expect(rest).toEqual([]);
		expect(result).toEqual({
			name: 'site.png',
			ok: true,
			url: `${ORIGIN}/evidence/${sha256(PNG)}.png`,
			sha256: sha256(PNG),
			picture: true
		});
		expect(evidenceUploadResponseSchema.safeParse(result).success).toBe(true);
		expect(stored.get(`${sha256(PNG)}.png`)?.equals(PNG)).toBe(true);
	});

	it('stores a PDF and marks it as a document, not a picture', async () => {
		const [result] = await results(party, pdf());

		expect(result).toMatchObject({ ok: true, picture: false, sha256: sha256(PDF) });
		expect(stored.get(`${sha256(PDF)}.pdf`)?.equals(PDF)).toBe(true);
	});

	it('says in plain words why a file of the wrong type was refused', async () => {
		const [result] = await results(party, new File(['hello'], 'notes.txt', { type: 'text/plain' }));

		expect(result).toEqual({ name: 'notes.txt', ok: false, problem: PROBLEM_SENTENCES.wrong_type });
		expect(stored.size).toBe(0);
	});

	it('says why an empty file was refused', async () => {
		const [result] = await results(party, new File([], 'blank.png', { type: 'image/png' }));

		expect(result).toEqual({ name: 'blank.png', ok: false, problem: PROBLEM_SENTENCES.empty });
		expect(stored.size).toBe(0);
	});

	it('says why a file over the size limit was refused, and takes one exactly at it', async () => {
		const atLimit = new File([Buffer.alloc(EVIDENCE_MAX_BYTES)], 'big.png', { type: 'image/png' });
		const over = new File([Buffer.alloc(EVIDENCE_MAX_BYTES + 1)], 'huge.png', {
			type: 'image/png'
		});

		const [first, second] = await results(party, atLimit, over);

		expect(first).toMatchObject({ name: 'big.png', ok: true });
		expect(second).toEqual({ name: 'huge.png', ok: false, problem: PROBLEM_SENTENCES.too_large });
		expect(stored.size).toBe(1);
	});

	it('keeps the files that worked when others in the same upload fail', async () => {
		failing.add(`${sha256(PDF)}.pdf`);

		const answer = await results(
			party,
			new File(['hello'], 'notes.txt', { type: 'text/plain' }),
			png('before.png'),
			pdf('receipt.pdf'),
			new File([Buffer.from('another picture')], 'after.webp', { type: 'image/webp' })
		);

		expect(answer.map((result) => [result.name, result.ok])).toEqual([
			['notes.txt', false],
			['before.png', true],
			['receipt.pdf', false],
			['after.webp', true]
		]);
		expect(answer[2]).toMatchObject({ problem: PROBLEM_SENTENCES.unexpected });
		expect([...stored.keys()].sort()).toEqual(
			[`${sha256(PNG)}.png`, `${sha256(Buffer.from('another picture'))}.webp`].sort()
		);
	});
});

describe('what the page tells the person', () => {
	it('has a sentence for every refusal POST /api/evidence can answer', () => {
		expect(problemFromStatus(401)).toBe('not_signed_in');
		expect(problemFromStatus(403)).toBe('not_a_party');
		expect(problemFromStatus(415)).toBe('wrong_type');
		expect(problemFromStatus(413)).toBe('too_large');
		expect(problemFromStatus(400)).toBe('empty');
		expect(problemFromStatus(500)).toBe('unexpected');
	});

	it('writes the block for the agent in the shape a check-in takes for photos', () => {
		const upload = { url: `${ORIGIN}/evidence/${sha256(PNG)}.png`, sha256: sha256(PNG) };
		const other = { url: `${ORIGIN}/evidence/${sha256(PDF)}.pdf`, sha256: sha256(PDF) };

		expect(photoSchema.parse(JSON.parse(agentEntry(upload)))).toEqual(upload);
		// The same file uploaded twice is listed once.
		expect(photoSchema.array().parse(JSON.parse(agentList([upload, other, upload])))).toEqual([
			upload,
			other
		]);
	});
});
