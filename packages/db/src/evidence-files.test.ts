// Who uploaded a file, who may see it and who may change that, against the real local D1.
import type { Entry } from '@tejido/contracts';
import { fixtures } from '@tejido/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	evidenceAccess,
	getEvidenceFile,
	listNotPublicEvidence,
	recordEvidenceUpload,
	type EvidenceVisibilityChoice
} from './index.ts';
import { campaigns, entries, milestones, parties } from './schema.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
// The fixtures: the contractor and the supplier do the work, the head teacher confirms.
const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const NOW = '2026-11-14T12:00:00.000Z';
const LATER = '2026-11-15T12:00:00.000Z';

const PUBLIC: EvidenceVisibilityChoice = { visibility: 'public' };
const CLASS_LIST: EvidenceVisibilityChoice = {
	visibility: 'not_public',
	kind: 'Class list',
	reason: 'It has pupils’ names on it.'
};

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test?.destroy());

const upload = (
	partyId: string,
	choice: EvidenceVisibilityChoice | null,
	more: { sha256?: string; alreadyStored?: boolean; now?: string } = {}
) =>
	recordEvidenceUpload(test.db, {
		sha256: more.sha256 ?? A,
		partyId,
		choice,
		alreadyStored: more.alreadyStored ?? false,
		now: more.now ?? NOW
	});

/** Saves a work log by `partyId` that names the file `sha256`. */
async function fileEntryNaming(sha256: string, partyId: string) {
	const entry: Entry = {
		id: `ent-names-${sha256.slice(0, 4)}-${partyId}`,
		campaignId: CAMPAIGN,
		milestoneId: 'm2-walls',
		partyId,
		item: 'log_work',
		inputs: {
			reporter_code: contractor.reporterCode,
			milestone_id: 'm2-walls',
			summary: 'Walls.',
			photos: [{ url: `http://localhost:5174/evidence/${sha256}.jpg`, sha256 }]
		},
		status: 'filed',
		statusReason: null,
		payingWallet: null,
		twistId: null,
		filedAt: NOW,
		stampedAt: null,
		updatedAt: NOW
	};
	await test.db.insert(entries).values(entry);
}

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

describe('recording an upload', () => {
	it('records a new file as its uploader’s, public unless they say otherwise', async () => {
		expect(await upload(contractor.id, null)).toEqual({ accepted: true, visibility: 'public' });
		expect(await getEvidenceFile(test.db, A)).toEqual({
			sha256: A,
			uploadedByPartyId: contractor.id,
			visibility: 'public',
			notPublicKind: null,
			notPublicReason: null,
			createdAt: NOW,
			updatedAt: NOW
		});
	});

	it('records a new file as not public, with what donors are told instead', async () => {
		expect(await upload(contractor.id, CLASS_LIST)).toEqual({
			accepted: true,
			visibility: 'not_public'
		});
		expect(await getEvidenceFile(test.db, A)).toMatchObject({
			uploadedByPartyId: contractor.id,
			visibility: 'not_public',
			notPublicKind: 'Class list',
			notPublicReason: 'It has pupils’ names on it.'
		});
	});

	it('keeps a not-public file not public when its uploader sends it again without saying', async () => {
		await upload(contractor.id, CLASS_LIST);

		expect(await upload(contractor.id, null, { now: LATER })).toEqual({
			accepted: true,
			visibility: 'not_public'
		});
		expect(await getEvidenceFile(test.db, A)).toMatchObject({
			visibility: 'not_public',
			notPublicKind: 'Class list',
			updatedAt: NOW
		});
	});

	it('lets the uploader, and only the uploader, make a not-public file public', async () => {
		await upload(contractor.id, CLASS_LIST);

		for (const other of [supplier.id, headTeacher.id]) {
			expect(await upload(other, PUBLIC, { alreadyStored: true })).toEqual({
				accepted: false,
				why: 'not_the_uploader'
			});
		}
		expect((await getEvidenceFile(test.db, A))?.visibility).toBe('not_public');

		expect(await upload(contractor.id, PUBLIC, { alreadyStored: true, now: LATER })).toEqual({
			accepted: true,
			visibility: 'public'
		});
		expect(await getEvidenceFile(test.db, A)).toMatchObject({
			visibility: 'public',
			notPublicKind: null,
			notPublicReason: null,
			updatedAt: LATER
		});
	});

	it('lets the uploader, and only the uploader, make a public file not public', async () => {
		await upload(contractor.id, null);

		expect(await upload(supplier.id, CLASS_LIST, { alreadyStored: true })).toEqual({
			accepted: false,
			why: 'not_the_uploader'
		});
		expect((await getEvidenceFile(test.db, A))?.visibility).toBe('public');

		expect(await upload(contractor.id, CLASS_LIST, { alreadyStored: true })).toEqual({
			accepted: true,
			visibility: 'not_public'
		});
	});

	it('changes nothing when someone else sends the same bytes without asking for a change', async () => {
		await upload(contractor.id, CLASS_LIST);

		expect(await upload(supplier.id, null, { alreadyStored: true })).toEqual({
			accepted: true,
			visibility: 'not_public'
		});
		expect(
			await upload(supplier.id, { ...CLASS_LIST, kind: 'Mine now' }, { alreadyStored: true })
		).toEqual({ accepted: true, visibility: 'not_public' });
		expect(await getEvidenceFile(test.db, A)).toMatchObject({
			uploadedByPartyId: contractor.id,
			notPublicKind: 'Class list'
		});
	});

	it('lets the uploader reword what donors are told', async () => {
		await upload(contractor.id, CLASS_LIST);
		await upload(contractor.id, { ...CLASS_LIST, kind: 'Register' }, { alreadyStored: true });

		expect((await getEvidenceFile(test.db, A))?.notPublicKind).toBe('Register');
	});

	describe('a file stored before records were kept', () => {
		it('stays public, with no record, when sent again without asking for a change', async () => {
			expect(await upload(supplier.id, null, { alreadyStored: true })).toEqual({
				accepted: true,
				visibility: 'public'
			});
			expect(await upload(supplier.id, PUBLIC, { alreadyStored: true })).toEqual({
				accepted: true,
				visibility: 'public'
			});
			expect(await getEvidenceFile(test.db, A)).toBeUndefined();
		});

		it('can be made not public by the party whose entry names it', async () => {
			await fileEntryNaming(A, contractor.id);

			expect(await upload(supplier.id, CLASS_LIST, { alreadyStored: true })).toEqual({
				accepted: false,
				why: 'not_the_uploader'
			});
			expect(await getEvidenceFile(test.db, A)).toBeUndefined();

			expect(await upload(contractor.id, CLASS_LIST, { alreadyStored: true })).toEqual({
				accepted: true,
				visibility: 'not_public'
			});
			expect((await getEvidenceFile(test.db, A))?.uploadedByPartyId).toBe(contractor.id);
		});

		it('can be made not public by whoever sends it, when no entry names it', async () => {
			await fileEntryNaming(B, contractor.id);

			expect(await upload(supplier.id, CLASS_LIST, { alreadyStored: true })).toEqual({
				accepted: true,
				visibility: 'not_public'
			});
		});
	});
});

describe('listing the files that are not public', () => {
	it('answers only for not-public files among those asked about', async () => {
		await upload(contractor.id, CLASS_LIST);
		await upload(contractor.id, null, { sha256: B });

		expect(await listNotPublicEvidence(test.db, [A, B, A, 'c'.repeat(64)])).toEqual(
			new Map([[A, { kind: 'Class list', reason: 'It has pupils’ names on it.' }]])
		);
		expect(await listNotPublicEvidence(test.db, [B])).toEqual(new Map());
		expect(await listNotPublicEvidence(test.db, [])).toEqual(new Map());
	});

	it('copes with more files than one statement can name', async () => {
		await upload(contractor.id, CLASS_LIST);
		const many = Array.from({ length: 130 }, (_, index) => index.toString(16).padStart(64, '0'));

		expect([...(await listNotPublicEvidence(test.db, [...many, A])).keys()]).toEqual([A]);
	});
});

describe('who may fetch a file', () => {
	it('lets anyone fetch a public file, and a file with no record', async () => {
		await upload(contractor.id, null);

		for (const viewer of [null, contractor.id, supplier.id, 'nobody']) {
			expect(await evidenceAccess(test.db, A, viewer)).toBe('public');
			expect(await evidenceAccess(test.db, B, viewer)).toBe('public');
		}
	});

	describe('a not-public file', () => {
		beforeEach(async () => {
			await upload(contractor.id, CLASS_LIST);
			await addOtherCampaign();
		});

		it('is allowed to the party who uploaded it', async () => {
			expect(await evidenceAccess(test.db, A, contractor.id)).toBe('allowed');
		});

		it('is allowed to a confirmer of a milestone in the uploader’s campaign', async () => {
			expect(await evidenceAccess(test.db, A, headTeacher.id)).toBe('allowed');
		});

		it('is refused to someone who is not signed in as a party', async () => {
			expect(await evidenceAccess(test.db, A, null)).toBe('refused');
		});

		it('is refused to another third party on the same campaign', async () => {
			expect(await evidenceAccess(test.db, A, supplier.id)).toBe('refused');
		});

		it('is refused to a third party and to a confirmer of another campaign', async () => {
			expect(await evidenceAccess(test.db, A, 'driller')).toBe('refused');
			expect(await evidenceAccess(test.db, A, 'water-committee')).toBe('refused');
		});

		it('is refused to a party id that does not exist', async () => {
			expect(await evidenceAccess(test.db, A, 'nobody')).toBe('refused');
		});

		it('is public again once its uploader says so', async () => {
			await upload(contractor.id, PUBLIC, { alreadyStored: true });

			expect(await evidenceAccess(test.db, A, null)).toBe('public');
		});
	});
});
