// Who may see a file, and what a donor is told about each file of an entry.
import { describe, expect, it } from 'vitest';
import {
	checkEvidence,
	EVIDENCE_LEFT_OUT_SENTENCES,
	EVIDENCE_NOT_PUBLIC_KIND_MAX,
	EVIDENCE_NOT_PUBLIC_REASON_MAX,
	evidenceFileRecordSchema,
	evidenceFileState,
	evidenceFileStates,
	evidenceFileStateSchema,
	evidenceLeftOutReasonSchema,
	evidenceNotPublicSchema,
	evidenceReferenceSchema,
	itemInputJsonSchema,
	photoSchema,
	type EvidenceNotPublic,
	type EvidenceStateContext
} from './index.ts';

const STORE = 'https://app.tejido.example';
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

const stored = (sha256: string, extension: string, caption?: string) => ({
	url: `${STORE}/evidence/${sha256}.${extension}`,
	sha256,
	...(caption ? { caption } : {})
});

const CLASS_LIST: EvidenceNotPublic = { kind: 'Class list', reason: 'It has pupils’ names on it.' };

function context(overrides: Partial<EvidenceStateContext> = {}): EvidenceStateContext {
	return { storeOrigin: STORE, documentsOnly: false, notPublic: new Map(), ...overrides };
}

describe('checking a file named in a check-in', () => {
	it('tells a picture from a document by the stored file’s extension', () => {
		expect(checkEvidence(stored(A, 'jpg'), STORE)).toBe('photo');
		expect(checkEvidence(stored(A, 'png'), STORE)).toBe('photo');
		expect(checkEvidence(stored(A, 'webp'), STORE)).toBe('photo');
		expect(checkEvidence(stored(A, 'pdf'), STORE)).toBe('document');
	});

	it('calls anything that is not a file in our store foreign', () => {
		expect(
			checkEvidence({ url: `https://elsewhere.example/evidence/${A}.jpg`, sha256: A }, STORE)
		).toBe('foreign');
		expect(checkEvidence({ url: `${STORE}/evidence/${A}.exe`, sha256: A }, STORE)).toBe('foreign');
		expect(checkEvidence({ url: `${STORE}/evidence/${A}.jpg?x=1`, sha256: A }, STORE)).toBe(
			'foreign'
		);
		expect(checkEvidence({ url: `${STORE}/auth/callback`, sha256: A }, STORE)).toBe('foreign');
	});

	it('notices a hash that is not the stored file’s', () => {
		expect(checkEvidence({ url: stored(A, 'jpg').url, sha256: B }, STORE)).toBe('hash_mismatch');
	});
});

describe('what the uploader says about a not-public file', () => {
	it('needs both what it is and why it is hidden', () => {
		expect(evidenceNotPublicSchema.parse(CLASS_LIST)).toEqual(CLASS_LIST);
		expect(evidenceNotPublicSchema.safeParse({ kind: 'Class list' }).success).toBe(false);
		expect(evidenceNotPublicSchema.safeParse({ kind: ' ', reason: 'Names.' }).success).toBe(false);
		expect(evidenceNotPublicSchema.safeParse({ kind: 'Class list', reason: '' }).success).toBe(
			false
		);
	});

	it('caps both, because donors read them', () => {
		const kind = 'k'.repeat(EVIDENCE_NOT_PUBLIC_KIND_MAX);
		const reason = 'r'.repeat(EVIDENCE_NOT_PUBLIC_REASON_MAX);
		expect(evidenceNotPublicSchema.safeParse({ kind, reason }).success).toBe(true);
		expect(evidenceNotPublicSchema.safeParse({ kind: `${kind}k`, reason }).success).toBe(false);
		expect(evidenceNotPublicSchema.safeParse({ kind, reason: `${reason}r` }).success).toBe(false);
	});

	it('is kept in a record by the file’s SHA-256', () => {
		const record = {
			sha256: A,
			uploadedByPartyId: 'contractor',
			visibility: 'not_public',
			notPublicKind: CLASS_LIST.kind,
			notPublicReason: CLASS_LIST.reason,
			createdAt: '2026-11-14T08:00:00.000Z',
			updatedAt: '2026-11-14T08:00:00.000Z'
		};
		expect(evidenceFileRecordSchema.parse(record)).toEqual(record);
		expect(evidenceFileRecordSchema.safeParse({ ...record, visibility: 'secret' }).success).toBe(
			false
		);
	});
});

describe('what a donor is told about one file', () => {
	it('shows a file from our store, with its address, hash and caption', () => {
		expect(evidenceFileState(stored(A, 'jpg', 'East wall'), context())).toEqual({
			state: 'shown',
			kind: 'photo',
			url: `${STORE}/evidence/${A}.jpg`,
			sha256: A,
			caption: 'East wall'
		});
		expect(evidenceFileState(stored(B, 'pdf'), context())).toEqual({
			state: 'shown',
			kind: 'document',
			url: `${STORE}/evidence/${B}.pdf`,
			sha256: B,
			caption: null
		});
	});

	it('gives a not-public file as the uploader’s words and its hash, and nothing else', () => {
		const state = evidenceFileState(
			stored(A, 'pdf', 'Form 3, every pupil by name'),
			context({ notPublic: new Map([[A, CLASS_LIST]]) })
		);

		expect(state).toEqual({
			state: 'not_public',
			kind: 'Class list',
			reason: 'It has pupils’ names on it.',
			sha256: A
		});
		// No address that fetches it, and not the caption filed with it.
		expect(JSON.stringify(state)).not.toContain('/evidence/');
		expect(JSON.stringify(state)).not.toContain('every pupil');
	});

	it('leaves out what fails a check, with a reason code and a sentence, and no address', () => {
		const cases = [
			[{ url: `https://elsewhere.example/${A}.jpg`, sha256: A }, false, 'not_in_our_store'],
			[{ url: stored(A, 'jpg').url, sha256: B }, false, 'hash_mismatch'],
			[stored(A, 'jpg', 'A pupil at the gate'), true, 'picture_on_documents_only']
		] as const;

		for (const [photo, documentsOnly, reason] of cases) {
			const state = evidenceFileState(photo, context({ documentsOnly }));
			expect(state).toEqual({
				state: 'left_out',
				reason,
				sentence: EVIDENCE_LEFT_OUT_SENTENCES[reason],
				sha256: photo.sha256
			});
			expect(JSON.stringify(state)).not.toContain('http');
			expect(JSON.stringify(state)).not.toContain('A pupil');
		}
	});

	it('keeps a document on a documents-only milestone', () => {
		expect(evidenceFileState(stored(A, 'pdf'), context({ documentsOnly: true }))).toMatchObject({
			state: 'shown',
			kind: 'document'
		});
	});

	it('leaves a failing file out even when its hash is marked not public', () => {
		const notPublic = new Map([[A, CLASS_LIST]]);
		// A check-in can name any hash: this one names a private file's hash on someone else's URL.
		expect(
			evidenceFileState(
				{ url: `https://elsewhere.example/${A}.jpg`, sha256: A },
				context({ notPublic })
			)
		).toMatchObject({ state: 'left_out', reason: 'not_in_our_store' });
		expect(
			evidenceFileState({ url: stored(B, 'jpg').url, sha256: A }, context({ notPublic }))
		).toMatchObject({ state: 'left_out', reason: 'hash_mismatch' });
		expect(
			evidenceFileState(stored(A, 'jpg'), context({ notPublic, documentsOnly: true }))
		).toMatchObject({ state: 'left_out', reason: 'picture_on_documents_only' });
	});

	it('has a sentence for every reason', () => {
		for (const reason of evidenceLeftOutReasonSchema.options) {
			expect(EVIDENCE_LEFT_OUT_SENTENCES[reason]).toMatch(/^Left out: /);
		}
	});

	it('answers for every file of an entry, in the order filed, in the shape of the schema', () => {
		const states = evidenceFileStates(
			[stored(A, 'jpg'), stored(B, 'pdf'), { url: 'https://elsewhere.example/x.jpg', sha256: C }],
			context({ notPublic: new Map([[B, CLASS_LIST]]) })
		);

		expect(states.map((file) => file.state)).toEqual(['shown', 'not_public', 'left_out']);
		for (const state of states) expect(evidenceFileStateSchema.parse(state)).toEqual(state);
		expect(evidenceFileStates(undefined, context())).toEqual([]);
	});
});

describe('who may see a file is not part of a check-in', () => {
	it('keeps a photo in a check-in to its address, hash and caption', () => {
		expect(Object.keys(photoSchema.shape).sort()).toEqual(['caption', 'sha256', 'url']);
		expect(Object.keys(evidenceReferenceSchema.shape).sort()).toEqual(['sha256', 'url']);
	});

	it('leaves the photos input of both Qatom items as it was entered in Qatom', () => {
		for (const item of ['log_work', 'milestone_hit'] as const) {
			const schema = itemInputJsonSchema(item, ['m1']) as {
				properties: { photos: unknown };
			};
			expect(schema.properties.photos).toEqual({
				description: 'Up to 10 photos or documents. Upload each one first.',
				maxItems: 10,
				type: 'array',
				items: {
					type: 'object',
					required: ['url', 'sha256'],
					properties: {
						url: {
							type: 'string',
							format: 'uri',
							description: 'URL returned by the Tejido evidence upload.'
						},
						sha256: {
							type: 'string',
							pattern: '^[0-9a-f]{64}$',
							description: 'SHA-256 of the file, as returned by the evidence upload.'
						},
						caption: {
							type: 'string',
							maxLength: 500,
							description: 'One line saying what the photo shows.'
						}
					}
				}
			});
		}
	});
});
