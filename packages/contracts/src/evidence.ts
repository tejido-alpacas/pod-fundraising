import { z } from 'zod';
import type { Photo } from './items.ts';
import { idSchema, sha256Schema, timestampSchema } from './primitives.ts';

/**
 * A stored file as a check-in names it: where it is, and the SHA-256 of its bytes. This is
 * what goes into a check-in's `photos` list.
 */
export const evidenceReferenceSchema = z.object({
	url: z.url({ protocol: /^https?$/ }),
	sha256: sha256Schema
});
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;

/**
 * What `POST /api/evidence` answers: the file's reference, and who may see the file now.
 * `visibility` is not part of a check-in: it is kept with the file, never sent through Qatom.
 */
export const evidenceUploadResponseSchema = evidenceReferenceSchema.extend({
	visibility: z.enum(['public', 'not_public'])
});
export type EvidenceUploadResponse = z.infer<typeof evidenceUploadResponseSchema>;

/** The name of the file field in the multipart upload. */
export const EVIDENCE_FILE_FIELD = 'file';

export const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;

/** The file types accepted as evidence, and the extension each is stored under. */
export const EVIDENCE_CONTENT_TYPES = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp',
	'application/pdf': 'pdf'
} as const;
export type EvidenceContentType = keyof typeof EVIDENCE_CONTENT_TYPES;

export function isEvidenceContentType(value: string): value is EvidenceContentType {
	return Object.hasOwn(EVIDENCE_CONTENT_TYPES, value);
}

// ---------------------------------------------------------------------------
// Checking a file named in a check-in
// ---------------------------------------------------------------------------

/** The path the App serves evidence under: `/evidence/{sha256}.{extension}`. */
const EVIDENCE_PATH = /^\/evidence\/([0-9a-f]{64})\.([a-z0-9]+)$/;

const TYPE_BY_EXTENSION = new Map<string, string>(
	Object.entries(EVIDENCE_CONTENT_TYPES).map(([type, extension]) => [extension, type])
);

/**
 * - `photo`: a picture from our store.
 * - `document`: a PDF from our store.
 * - `foreign`: the URL is not a file in our evidence store.
 * - `hash_mismatch`: the URL is ours, but the hash given is not that file's.
 */
export type EvidenceVerdict = 'photo' | 'document' | 'foreign' | 'hash_mismatch';

/**
 * Checks one item of a check-in's `photos` list. A file is stored under its own SHA-256, so
 * "the hash matches the file we stored" is checked by comparing the hash with the file name
 * in the URL.
 *
 * @param storeOrigin the origin evidence URLs are on (`evidenceStoreOrigin` in @tejido/db).
 */
export function checkEvidence(
	photo: Pick<Photo, 'url' | 'sha256'>,
	storeOrigin: string
): EvidenceVerdict {
	const url = URL.parse(photo.url);
	if (!url || url.origin !== storeOrigin || url.search !== '' || url.hash !== '') return 'foreign';

	const match = EVIDENCE_PATH.exec(url.pathname);
	const type = match?.[2] ? TYPE_BY_EXTENSION.get(match[2]) : undefined;
	if (!match || !type) return 'foreign';

	if (match[1] !== photo.sha256) return 'hash_mismatch';
	return type === 'application/pdf' ? 'document' : 'photo';
}

// ---------------------------------------------------------------------------
// Who may see a file
// ---------------------------------------------------------------------------

/**
 * - `public`: anyone with its address can fetch the file. Donors are shown it.
 * - `not_public`: only the party who uploaded it and the confirmers of that party's campaign
 *   can fetch it, signed in to the App. Donors are told what it is and why it is hidden, and
 *   may be shown its SHA-256, but never its address and never a preview.
 */
export const evidenceVisibilitySchema = z.enum(['public', 'not_public']);
export type EvidenceVisibility = z.infer<typeof evidenceVisibilitySchema>;

export const EVIDENCE_NOT_PUBLIC_KIND_MAX = 80;
export const EVIDENCE_NOT_PUBLIC_REASON_MAX = 200;

/**
 * What the uploader says about a file they mark not public. BOTH ARE SHOWN TO DONORS, so
 * neither may carry a name or anything else the file is being hidden to protect.
 */
export const evidenceNotPublicSchema = z.object({
	/** What kind of material it is: "Class list", "Fee receipt". */
	kind: z.string().trim().min(1).max(EVIDENCE_NOT_PUBLIC_KIND_MAX),
	/** Why donors are not shown it: "It has pupils' names on it." */
	reason: z.string().trim().min(1).max(EVIDENCE_NOT_PUBLIC_REASON_MAX)
});
export type EvidenceNotPublic = z.infer<typeof evidenceNotPublicSchema>;

/**
 * The form fields sent with the file to `POST /api/evidence` (and the upload page) to say who
 * may see it. `visibility` is optional: leaving it out stores a new file as `public` and
 * leaves a file that is already stored as it is. The other two are required with
 * `not_public` and ignored otherwise.
 */
export const EVIDENCE_VISIBILITY_FIELD = 'visibility';
export const EVIDENCE_NOT_PUBLIC_KIND_FIELD = 'not_public_kind';
export const EVIDENCE_NOT_PUBLIC_REASON_FIELD = 'not_public_reason';

/**
 * What we keep about one stored file, by the SHA-256 of its bytes: who uploaded it and who
 * may see it. A file with no record was uploaded before records were kept, and is public.
 *
 * `notPublicKind` and `notPublicReason` are set exactly when `visibility` is `not_public`.
 */
export const evidenceFileRecordSchema = z.object({
	sha256: sha256Schema,
	/** The party who uploaded it. Only they can change `visibility`. */
	uploadedByPartyId: idSchema,
	visibility: evidenceVisibilitySchema,
	notPublicKind: z.string().min(1).max(EVIDENCE_NOT_PUBLIC_KIND_MAX).nullable(),
	notPublicReason: z.string().min(1).max(EVIDENCE_NOT_PUBLIC_REASON_MAX).nullable(),
	createdAt: timestampSchema,
	updatedAt: timestampSchema
});
export type EvidenceFileRecord = z.infer<typeof evidenceFileRecordSchema>;

// ---------------------------------------------------------------------------
// What a donor is told about each file of an entry
// ---------------------------------------------------------------------------

/**
 * Why a file that was filed is deliberately not shown.
 *
 * - `not_in_our_store`: its address is not a file in Tejido's evidence store.
 * - `hash_mismatch`: the SHA-256 filed with it is not the hash of the stored file.
 * - `picture_on_documents_only`: it is a picture, and the milestone takes documents only.
 */
export const evidenceLeftOutReasonSchema = z.enum([
	'not_in_our_store',
	'hash_mismatch',
	'picture_on_documents_only'
]);
export type EvidenceLeftOutReason = z.infer<typeof evidenceLeftOutReasonSchema>;

/** One plain sentence per reason, for donors. */
export const EVIDENCE_LEFT_OUT_SENTENCES: Record<EvidenceLeftOutReason, string> = {
	not_in_our_store:
		'Left out: we couldn’t verify that it belonged to this project. The file is not held by Tejido, so we cannot check what it is.',
	hash_mismatch:
		'Left out: we couldn’t verify that it belonged to this project. The fingerprint (SHA-256) filed with it does not match the file we hold.',
	picture_on_documents_only: 'Left out: it is a picture, and this milestone takes documents only.'
};

const captionSchema = z.string().nullable();

/**
 * One file of an entry, as a donor may be told about it. Exactly one of three states:
 *
 * - `shown`: donors see it. The only state that carries the file's address.
 * - `not_public`: the uploader marked it not public. Donors get the uploader's stated kind
 *   and reason and the file's SHA-256. No address, no caption, no preview.
 * - `left_out`: it was filed but is deliberately not shown, with the reason as a code and as
 *   a sentence. `sha256` is the hash as filed, which for `hash_mismatch` is not the file's.
 *   No address and no caption: the caption of a picture that may not be shown can say as
 *   much as the picture.
 *
 * Everything in this type is safe to send to a donor's browser.
 */
export const evidenceFileStateSchema = z.discriminatedUnion('state', [
	z.object({
		state: z.literal('shown'),
		kind: z.enum(['photo', 'document']),
		url: z.url({ protocol: /^https?$/ }),
		sha256: sha256Schema,
		caption: captionSchema
	}),
	z.object({
		state: z.literal('not_public'),
		/** What the uploader says it is. */
		kind: z.string(),
		/** Why the uploader says donors are not shown it. */
		reason: z.string(),
		sha256: sha256Schema
	}),
	z.object({
		state: z.literal('left_out'),
		reason: evidenceLeftOutReasonSchema,
		/** `EVIDENCE_LEFT_OUT_SENTENCES[reason]`, ready to show. */
		sentence: z.string(),
		sha256: sha256Schema
	})
]);
export type EvidenceFileState = z.infer<typeof evidenceFileStateSchema>;

export interface EvidenceStateContext {
	/** The origin evidence URLs are on (`evidenceStoreOrigin` in @tejido/db). */
	storeOrigin: string;
	/** True when the entry's milestone takes documents only, so no picture may be shown. */
	documentsOnly: boolean;
	/** The files marked not public, by SHA-256 (`listNotPublicEvidence` in @tejido/db). */
	notPublic: ReadonlyMap<string, EvidenceNotPublic>;
}

/**
 * Says which state one filed file is in. "Left out" is worked out here from the file and the
 * milestone; only "not public" comes from something stored.
 *
 * A file that fails a check is left out even if it is also marked not public: a check-in can
 * name any hash, so the hash is trusted only once it is known to be the stored file's.
 */
export function evidenceFileState(photo: Photo, context: EvidenceStateContext): EvidenceFileState {
	const leftOut = (reason: EvidenceLeftOutReason): EvidenceFileState => ({
		state: 'left_out',
		reason,
		sentence: EVIDENCE_LEFT_OUT_SENTENCES[reason],
		sha256: photo.sha256
	});

	const verdict = checkEvidence(photo, context.storeOrigin);
	if (verdict === 'foreign') return leftOut('not_in_our_store');
	if (verdict === 'hash_mismatch') return leftOut('hash_mismatch');
	if (verdict === 'photo' && context.documentsOnly) return leftOut('picture_on_documents_only');

	const hidden = context.notPublic.get(photo.sha256);
	if (hidden) {
		return { state: 'not_public', kind: hidden.kind, reason: hidden.reason, sha256: photo.sha256 };
	}
	return {
		state: 'shown',
		kind: verdict,
		url: photo.url,
		sha256: photo.sha256,
		caption: photo.caption ?? null
	};
}

/** `evidenceFileState` for every file of an entry, in the order they were filed. */
export function evidenceFileStates(
	photos: readonly Photo[] | undefined,
	context: EvidenceStateContext
): EvidenceFileState[] {
	return (photos ?? []).map((photo) => evidenceFileState(photo, context));
}
