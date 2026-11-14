/**
 * Stores one evidence file, and decides who may fetch one. Used by `POST /api/evidence`
 * (agents), the upload page's form action (people), the "fix an incomplete entry" page and
 * `GET /evidence/{file}`, so all of them name a file the same way, by the SHA-256 of its
 * bytes, and apply the same rule about who may see it.
 *
 * WHO MAY SEE A FILE is kept per file, in the `evidence_files` table, not in a check-in: the
 * uploader says so here, when uploading, and it never travels through Qatom.
 *
 * The caller has already checked who is asking and that the file is an allowed type and size.
 */
import type { R2Bucket } from '@cloudflare/workers-types';
import {
	EVIDENCE_CONTENT_TYPES,
	EVIDENCE_NOT_PUBLIC_KIND_FIELD,
	EVIDENCE_NOT_PUBLIC_REASON_FIELD,
	EVIDENCE_VISIBILITY_FIELD,
	evidenceNotPublicSchema,
	evidenceVisibilitySchema,
	type EvidenceContentType,
	type EvidenceUploadResponse
} from '@tejido/contracts';
import { recordEvidenceUpload, type Database, type EvidenceVisibilityChoice } from '@tejido/db';
import { createHash } from 'node:crypto';

const EXTENSIONS = Object.values(EVIDENCE_CONTENT_TYPES);

export type VisibilityChoiceRead =
	| { ok: true; choice: EvidenceVisibilityChoice | null }
	/** `visibility` is not a value we know, or not public was asked for without both texts. */
	| { ok: false };

/**
 * Reads the uploader's choice from the form sent with the file. No `visibility` field, or an
 * empty one, means they did not say: null.
 */
export function readVisibilityChoice(form: FormData): VisibilityChoiceRead {
	const stated = form.get(EVIDENCE_VISIBILITY_FIELD);
	if (stated === null || stated === '') return { ok: true, choice: null };

	const visibility = evidenceVisibilitySchema.safeParse(stated);
	if (!visibility.success) return { ok: false };
	if (visibility.data === 'public') return { ok: true, choice: { visibility: 'public' } };

	const words = evidenceNotPublicSchema.safeParse({
		kind: form.get(EVIDENCE_NOT_PUBLIC_KIND_FIELD),
		reason: form.get(EVIDENCE_NOT_PUBLIC_REASON_FIELD)
	});
	if (!words.success) return { ok: false };
	return { ok: true, choice: { visibility: 'not_public', ...words.data } };
}

export interface EvidenceToStore {
	evidence: R2Bucket;
	db: Database;
	file: File;
	type: EvidenceContentType;
	/** The App's own origin: the file's address is built on it. */
	origin: string;
	/** The signed-in party uploading the file. */
	partyId: string;
	/** Who may see it, as the uploader chose, or null if they did not say. */
	choice: EvidenceVisibilityChoice | null;
}

export type StoreOutcome =
	| ({ stored: true } & EvidenceUploadResponse)
	/**
	 * The same file was uploaded before by someone else, and the choice made here would change
	 * who may see it. Only its first uploader can do that. Nothing was stored or changed.
	 */
	| { stored: false; why: 'not_the_uploader' };

export async function storeEvidence(upload: EvidenceToStore): Promise<StoreOutcome> {
	const { evidence, db, file, type, origin, partyId, choice } = upload;
	const bytes = Buffer.from(await file.arrayBuffer());
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const name = `${sha256}.${EVIDENCE_CONTENT_TYPES[type]}`;

	// The same bytes may be in the store already, under any of the extensions.
	const held = await Promise.all(
		EXTENSIONS.map((extension) => evidence.head(`${sha256}.${extension}`))
	);

	// Who may see it is written BEFORE the bytes, so a not-public file is never in the store
	// without its record, not even for a moment.
	const recorded = await recordEvidenceUpload(db, {
		sha256,
		partyId,
		choice,
		alreadyStored: held.some((object) => object !== null),
		now: new Date().toISOString()
	});
	if (!recorded.accepted) return { stored: false, why: recorded.why };

	await evidence.put(name, bytes, { httpMetadata: { contentType: type } });

	return {
		stored: true,
		url: `${origin}/evidence/${name}`,
		sha256,
		visibility: recorded.visibility
	};
}
