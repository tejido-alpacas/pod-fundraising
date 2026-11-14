// The "fix an incomplete entry" page (B5): its own load function and form action, run against
// a real, migrated, seeded local D1. The evidence store is a recording stand-in made here in
// the test file.
//
// Nothing reaches the network: `fetch` is replaced by a stub that fails the test if anything
// calls it, and the Qatom clients are replaced by one that fails the test if anything touches
// them. Adding evidence must never buy, pay or transfer anything.
import { isActionFailure } from '@sveltejs/kit';
import { EVIDENCE_FILE_FIELD, type Entry, type MilestoneKind } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import {
	deposits,
	entries,
	getEntry,
	getEvidenceFile,
	getMilestone,
	listDeposits,
	milestones,
	recordEvidenceUpload,
	refunds
} from '@tejido/db';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { and, eq } from 'drizzle-orm';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROBLEM_SENTENCES } from '#lib/evidence.ts';
import type { Session } from '#lib/server/session.ts';
import { actions, load } from './+page.server.ts';

const ORIGIN = 'http://localhost:5174';
const CAMPAIGN = fixtures.campaign.id;
const WALLS = 'm2-walls';
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.7\n%%EOF\n');
const png = (name = 'wall.png') => new File([PNG], name, { type: 'image/png' });
const pdf = (name = 'certificate.pdf') => new File([PDF], name, { type: 'application/pdf' });
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const PNG_FILE = { url: `${ORIGIN}/evidence/${sha256(PNG)}.png`, sha256: sha256(PNG) };
const PDF_FILE = { url: `${ORIGIN}/evidence/${sha256(PDF)}.pdf`, sha256: sha256(PDF) };

const sessionFor = (party: typeof contractor): Session => ({
	sub: `qatom-user-${party.id}`,
	email: party.email,
	partyId: party.id
});
const noParty: Session = { sub: 'qatom-user-9', email: 'someone@else.example', partyId: null };

// The contractor claimed the walls done, with no photo. The check-in endpoint saves that as
// incomplete and moves the milestone to `claimed`. This is what it leaves behind.
const CLAIM = 'ent-m2-claim';
const NEEDS_PHOTO = 'A construction claim needs at least one photo.';
const claim: Entry = {
	id: CLAIM,
	campaignId: CAMPAIGN,
	milestoneId: WALLS,
	partyId: contractor.id,
	item: 'milestone_hit',
	inputs: {
		reporter_code: contractor.reporterCode,
		milestone_id: WALLS,
		claim: 'completed',
		summary: 'All four walls are up to roof height.'
	},
	status: 'incomplete',
	statusReason: NEEDS_PHOTO,
	payingWallet: null,
	twistId: null,
	filedAt: '2026-11-13T10:00:00.000Z',
	stampedAt: null,
	updatedAt: '2026-11-13T10:00:00.000Z'
};
// The supplier's incomplete delivery claim in the fixtures: one photo, no quantity.
const DELIVERY = 'ent-m3-delivery';

let test: TestDatabase;
let stored: Map<string, Buffer>;
const fetchStub = vi.fn(() => Promise.reject(new Error('a test reached the network')));
const touchedQatom = vi.fn();
/** Any use of a Qatom client is recorded, then fails. */
const qatom = new Proxy(
	{},
	{
		get: (_, name) => {
			touchedQatom(name);
			throw new Error(`a test touched Qatom: ${String(name)}`);
		}
	}
);

async function setWalls(change: { kind?: MilestoneKind; state?: 'open' | 'claimed' }) {
	await test.db
		.update(milestones)
		.set(change)
		.where(and(eq(milestones.campaignId, CAMPAIGN), eq(milestones.id, WALLS)));
}

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	stored = new Map();
	fetchStub.mockClear();
	touchedQatom.mockClear();
	vi.stubGlobal('fetch', fetchStub);

	await test.db.batch([
		test.db.insert(entries).values(claim),
		test.db.insert(deposits).values({ id: 'dep-m2-claim', entryId: CLAIM, amount: 1000 })
	]);
	await setWalls({ state: 'claimed' });
});
afterEach(async () => {
	// Whatever a test did, it bought nothing, paid nothing and transferred nothing.
	expect(fetchStub).not.toHaveBeenCalled();
	expect(touchedQatom).not.toHaveBeenCalled();
	vi.unstubAllGlobals();
	await test?.destroy();
});

function parts(session: Session | null, body?: FormData) {
	const request = new Request(`${ORIGIN}/fix?/attach`, { method: 'POST', body });
	const evidence = {
		put: (name: string, bytes: Buffer) => Promise.resolve(void stored.set(name, bytes)),
		head: (name: string) => Promise.resolve(stored.has(name) ? { key: name } : null)
	};
	const config = { OIDC_REDIRECT_URI: `${ORIGIN}/auth/callback` };
	return {
		request,
		locals: { ctx: { db: test.db, config, evidence, qatom }, session },
		url: new URL(request.url)
	};
}

// A whole RequestEvent cannot be built outside SvelteKit; the page's server code uses only
// the parts above.
async function view(session: Session | null) {
	const page = await load(parts(session) as unknown as Parameters<typeof load>[0]);
	if (!page) throw new Error('the page loaded nothing');
	return page;
}

interface Sent {
	files?: File[];
	/** What a person pasted from the upload page. */
	pasted?: unknown;
}

function attach(session: Session | null, entryId: string, { files = [], pasted }: Sent) {
	const form = new FormData();
	form.set('entry', entryId);
	for (const file of files) form.append(EVIDENCE_FILE_FIELD, file);
	if (pasted !== undefined) {
		form.set('uploaded', typeof pasted === 'string' ? pasted : JSON.stringify(pasted));
	}
	return actions.attach(parts(session, form) as unknown as Parameters<typeof actions.attach>[0]);
}

/** What an accepted addition answered. */
async function done(session: Session | null, entryId: string, sent: Sent) {
	const answer = await attach(session, entryId, sent);
	if (!('done' in answer)) throw new Error(`expected it to be added: ${answer.data.refused}`);
	return answer.done;
}

/** The status and sentences of a refusal. */
async function refusal(session: Session | null, entryId: string, sent: Sent) {
	const answer = await attach(session, entryId, sent);
	expect(isActionFailure(answer)).toBe(true);
	if ('done' in answer) throw new Error('expected a refusal');
	return { status: answer.status, problems: [], ...answer.data };
}

const read = async (id: string) => (await getEntry(test.db, id))!;
const walls = async () => (await getMilestone(test.db, CAMPAIGN, WALLS))!;

/** Runs something that must leave the database exactly as it was. */
async function unchanged(run: () => Promise<unknown>) {
	const before = {
		claim: await read(CLAIM),
		delivery: await read(DELIVERY),
		deposits: await listDeposits(test.db, CAMPAIGN),
		walls: await walls()
	};
	await run();
	expect(await read(CLAIM)).toEqual(before.claim);
	expect(await read(DELIVERY)).toEqual(before.delivery);
	expect(await listDeposits(test.db, CAMPAIGN)).toEqual(before.deposits);
	expect(await walls()).toEqual(before.walls);
}

describe('the page', () => {
	it('shows nothing to someone who is not signed in, or not on a campaign', async () => {
		expect(await view(null)).toEqual({ viewer: 'signed_out', email: null, entries: [] });
		expect(await view(noParty)).toEqual({ viewer: 'no_party', email: noParty.email, entries: [] });
	});

	it('shows a party their own incomplete reports and what is missing', async () => {
		const page = await view(sessionFor(contractor));

		expect(page.entries).toEqual([
			{
				id: CLAIM,
				milestoneTitle: (await walls()).title,
				report: 'claim',
				summary: 'All four walls are up to roof height.',
				filedAt: claim.filedAt,
				missing: NEEDS_PHOTO,
				attached: 0,
				room: 10,
				documentsOnly: false
			}
		]);
		// The reporter code is what proves who files. It never goes to the browser.
		expect(JSON.stringify(page)).not.toContain(contractor.reporterCode);
	});

	it('shows each party only their own', async () => {
		expect(
			(await view(sessionFor(supplier))).entries.map((entry: { id: string }) => entry.id)
		).toEqual([DELIVERY]);
		expect((await view(sessionFor(headTeacher))).entries).toEqual([]);
	});
});

describe('the party who filed a report adds what is missing', () => {
	it('completes the report with a photo, without paying again', async () => {
		const deposits = await listDeposits(test.db, CAMPAIGN);

		expect(await done(sessionFor(contractor), CLAIM, { files: [png()] })).toEqual({
			entryId: CLAIM,
			milestoneTitle: (await walls()).title,
			added: 1,
			complete: true,
			stillMissing: null
		});

		const after = await read(CLAIM);
		// Not reconciled yet, so it is `filed`: the reconciler picks it up as any other entry.
		expect(after).toEqual({
			...claim,
			inputs: { ...claim.inputs, photos: [PNG_FILE] },
			status: 'filed',
			statusReason: null,
			updatedAt: after.updatedAt
		});
		expect(after.updatedAt > claim.updatedAt).toBe(true);
		expect(stored.get(`${sha256(PNG)}.png`)?.equals(PNG)).toBe(true);

		// No new deposit, no refund, and the milestone stays where the claim left it.
		expect(await listDeposits(test.db, CAMPAIGN)).toEqual(deposits);
		expect(await test.db.select().from(refunds)).toEqual([]);
		expect((await walls()).state).toBe('claimed');
		expect((await view(sessionFor(contractor))).entries).toEqual([]);
	});

	it('takes files already uploaded, pasted from the upload page', async () => {
		stored.set(`${sha256(PNG)}.png`, PNG);

		expect(await done(sessionFor(contractor), CLAIM, { pasted: [PNG_FILE] })).toMatchObject({
			added: 1,
			complete: true
		});
		expect((await read(CLAIM)).inputs.photos).toEqual([PNG_FILE]);
	});

	it('makes it `verified` when the reconciler had already matched its payment', async () => {
		const stamp = {
			twistId: '41stamped',
			payingWallet: contractor.agentWalletHostname,
			stampedAt: '2026-11-13T09:59:50.000Z'
		};
		await test.db.update(entries).set(stamp).where(eq(entries.id, CLAIM));

		await done(sessionFor(contractor), CLAIM, { files: [png()] });

		expect(await read(CLAIM)).toMatchObject({ status: 'verified', statusReason: null, ...stamp });
	});

	it('keeps the files already attached, and stays incomplete while something else is missing', async () => {
		const before = await read(DELIVERY);

		const answer = await done(sessionFor(supplier), DELIVERY, { files: [png()] });

		expect(answer).toMatchObject({ added: 1, complete: false });
		expect(answer.stillMissing).toContain('A delivery needs a quantity and a unit.');
		const after = await read(DELIVERY);
		expect(after).toEqual({
			...before,
			inputs: { ...before.inputs, photos: [...before.inputs.photos!, PNG_FILE] },
			statusReason: answer.stillMissing,
			updatedAt: after.updatedAt
		});
		expect(after.status).toBe('incomplete');
	});

	it('does not attach the same file twice', async () => {
		await done(sessionFor(supplier), DELIVERY, { files: [png()] });

		await unchangedDelivery(async () => {
			expect(await refusal(sessionFor(supplier), DELIVERY, { files: [png()] })).toMatchObject({
				status: 400
			});
		});
	});
});

async function unchangedDelivery(run: () => Promise<unknown>) {
	const before = await read(DELIVERY);
	await run();
	expect(await read(DELIVERY)).toEqual(before);
}

describe('a file kept from donors', () => {
	it('is added, but does not stand as the photo the claim owes to donors', async () => {
		// The contractor uploaded the photo on the upload page and kept it from donors.
		stored.set(`${sha256(PNG)}.png`, PNG);
		await recordEvidenceUpload(test.db, {
			sha256: sha256(PNG),
			partyId: contractor.id,
			choice: { visibility: 'not_public', kind: 'Site photo', reason: 'It shows the neighbours.' },
			alreadyStored: false,
			now: '2026-11-13T11:00:00.000Z'
		});

		const answer = await done(sessionFor(contractor), CLAIM, { pasted: PNG_FILE });

		expect(answer).toMatchObject({ added: 1, complete: false });
		expect(await read(CLAIM)).toMatchObject({
			status: 'incomplete',
			statusReason:
				'A construction claim needs at least one photo that donors can see. Every photo attached is marked not public.',
			inputs: { photos: [PNG_FILE] }
		});
		// Choosing the same file here does not make it public behind the uploader's back.
		expect((await getEvidenceFile(test.db, sha256(PNG)))?.visibility).toBe('not_public');
	});
});

describe('who may change a report', () => {
	it('refuses someone who is not signed in', async () => {
		await unchanged(async () => {
			expect(await refusal(null, CLAIM, { files: [png()] })).toMatchObject({
				status: 401,
				entryId: null,
				refused: PROBLEM_SENTENCES.not_signed_in
			});
		});
		expect(stored.size).toBe(0);
	});

	it('refuses someone signed in who is not a party on a campaign', async () => {
		await unchanged(async () => {
			expect(await refusal(noParty, CLAIM, { files: [png()] })).toMatchObject({ status: 403 });
		});
		expect(stored.size).toBe(0);
	});

	it('refuses another party, the same way as a report that does not exist', async () => {
		await unchanged(async () => {
			const other = await refusal(sessionFor(supplier), CLAIM, { files: [png()] });
			const confirmer = await refusal(sessionFor(headTeacher), CLAIM, { files: [png()] });
			const missing = await refusal(sessionFor(supplier), 'ent-nope', { files: [png()] });

			expect(other.status).toBe(404);
			expect(other.refused).toContain('not one of yours');
			expect(confirmer).toEqual(other);
			expect(missing).toEqual(other);
		});
		expect(stored.size).toBe(0);
	});

	it('refuses to change a report that is not incomplete', async () => {
		for (const id of ['ent-m2-log-2', 'ent-m2-log-1', 'ent-m1-claim']) {
			const before = await read(id);
			expect(before.status).not.toBe('incomplete');

			expect(await refusal(sessionFor(contractor), id, { files: [png()] })).toMatchObject({
				status: 409,
				entryId: id
			});
			expect(await read(id)).toEqual(before);
		}
		expect(stored.size).toBe(0);
	});

	it('refuses once the report has been completed', async () => {
		await done(sessionFor(contractor), CLAIM, { files: [png()] });
		const completed = await read(CLAIM);

		expect(await refusal(sessionFor(contractor), CLAIM, { files: [pdf()] })).toMatchObject({
			status: 409
		});
		expect(await read(CLAIM)).toEqual(completed);
	});
});

describe('evidence that cannot be used', () => {
	it('refuses a file that is not in our evidence store', async () => {
		const elsewhere = { url: `https://files.example/evidence/${'a'.repeat(64)}.jpg` };
		const wrongPath = { url: `${ORIGIN}/somewhere/${'a'.repeat(64)}.jpg` };

		for (const file of [elsewhere, wrongPath]) {
			await unchanged(async () => {
				const answer = await refusal(sessionFor(contractor), CLAIM, {
					pasted: { ...file, sha256: 'a'.repeat(64) }
				});
				expect(answer.status).toBe(422);
				expect(answer.problems).toEqual([expect.stringContaining('not a file from the Tejido')]);
			});
		}
	});

	it('refuses a fingerprint that is not the file’s own', async () => {
		stored.set(`${sha256(PNG)}.png`, PNG);

		await unchanged(async () => {
			const answer = await refusal(sessionFor(contractor), CLAIM, {
				pasted: { url: PNG_FILE.url, sha256: 'b'.repeat(64) }
			});
			expect(answer.status).toBe(422);
			expect(answer.problems).toEqual([expect.stringContaining('fingerprint')]);
		});
	});

	it('refuses an address in our store that no file was ever uploaded to', async () => {
		await unchanged(async () => {
			const answer = await refusal(sessionFor(contractor), CLAIM, { pasted: PNG_FILE });
			expect(answer.status).toBe(422);
			expect(answer.problems).toEqual([expect.stringContaining('not in the Tejido evidence')]);
		});
	});

	it('refuses a photo on a milestone that takes documents only, and takes the document', async () => {
		// A service milestone is evidenced by documents: no pictures.
		await setWalls({ kind: 'service' });
		expect((await view(sessionFor(contractor))).entries[0]).toMatchObject({ documentsOnly: true });

		await unchanged(async () => {
			const answer = await refusal(sessionFor(contractor), CLAIM, { files: [pdf(), png()] });
			expect(answer.status).toBe(422);
			expect(answer.problems).toEqual([expect.stringContaining('wall.png is a picture')]);
		});

		expect(await done(sessionFor(contractor), CLAIM, { files: [pdf()] })).toMatchObject({
			complete: true
		});
		expect(await read(CLAIM)).toMatchObject({ status: 'filed', inputs: { photos: [PDF_FILE] } });
	});

	it('keeps a report incomplete when the wrong kind of file is all that is added', async () => {
		// A construction claim needs a photo. A document is allowed on it, but is not a photo.
		const answer = await done(sessionFor(contractor), CLAIM, { files: [pdf()] });

		expect(answer).toMatchObject({ complete: false, stillMissing: NEEDS_PHOTO });
		expect(await read(CLAIM)).toMatchObject({
			status: 'incomplete',
			statusReason: NEEDS_PHOTO,
			inputs: { photos: [PDF_FILE] }
		});
	});

	it('refuses a file of a type or size that is not evidence, and stores nothing', async () => {
		const text = new File(['notes'], 'notes.txt', { type: 'text/plain' });

		await unchanged(async () => {
			const answer = await refusal(sessionFor(contractor), CLAIM, { files: [png(), text] });
			expect(answer.status).toBe(400);
			expect(answer.problems).toEqual([`notes.txt: ${PROBLEM_SENTENCES.wrong_type}`]);
		});
		expect(stored.size).toBe(0);
	});

	it('refuses nothing chosen, unreadable pasted text, and more files than a report can carry', async () => {
		const untouched = new File([], '', { type: 'application/octet-stream' });
		const eleven = 'abcdef01234'.split('').map((fill) => ({
			url: `${ORIGIN}/evidence/${fill.repeat(64)}.jpg`,
			sha256: fill.repeat(64)
		}));

		await unchanged(async () => {
			const me = sessionFor(contractor);
			expect(await refusal(me, CLAIM, { files: [untouched] })).toMatchObject({ status: 400 });
			expect(await refusal(me, CLAIM, { pasted: 'not the block' })).toMatchObject({ status: 400 });
			expect(await refusal(me, CLAIM, { pasted: [{ url: 'nope' }] })).toMatchObject({
				status: 400
			});
			expect(await refusal(me, CLAIM, { pasted: eleven })).toMatchObject({ status: 400 });
		});
	});
});

describe('a confirmation filed before the milestone was claimed', () => {
	it('is not completed here, and the milestone does not become confirmed', async () => {
		// The head teacher confirmed the walls while nothing was claimed yet: saved incomplete.
		// The contractor has claimed them since.
		const confirmation: Entry = {
			...claim,
			id: 'ent-m2-early-confirm',
			partyId: headTeacher.id,
			inputs: {
				reporter_code: headTeacher.reporterCode,
				milestone_id: WALLS,
				claim: 'confirm',
				summary: 'I have seen the walls.'
			},
			statusReason:
				'Nothing has been claimed on this milestone yet, so there is nothing to confirm.'
		};
		await test.db.batch([
			test.db.insert(entries).values(confirmation),
			test.db
				.insert(deposits)
				.values({ id: 'dep-m2-early-confirm', entryId: confirmation.id, amount: 1000 })
		]);

		await unchanged(async () => {
			const answer = await refusal(sessionFor(headTeacher), confirmation.id, { files: [png()] });
			expect(answer.status).toBe(409);
			expect(answer.refused).toContain('confirm it again');
		});
		expect(await read(confirmation.id)).toEqual(confirmation);
		expect(await walls()).toMatchObject({ state: 'claimed', confirmedAt: null });
	});
});
