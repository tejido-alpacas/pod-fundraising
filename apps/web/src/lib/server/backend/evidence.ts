/**
 * Checks on the `photos` list of a check-in. Qatom does not look inside arrays, so we do.
 *
 * The contract already limits the list to ten and each hash to 64 hexadecimal characters.
 * What is left for us: every URL must point at our own evidence store, and the hash given
 * must be the hash of the file we stored there.
 *
 * The evidence store is the App's `GET /evidence/{sha256}.{ext}`. A file is stored under its
 * own SHA-256, so "the hash matches the file we stored" is checked by comparing the hash with
 * the file name in the URL. This app has no binding to the bucket itself, so it cannot check
 * that the file exists.
 */
import { EVIDENCE_CONTENT_TYPES, type Photo } from '@tejido/contracts';
import type { Config } from '@tejido/config';

/** The path the App serves evidence under. */
const EVIDENCE_PATH = /^\/evidence\/([0-9a-f]{64})\.([a-z0-9]+)$/;

const EXTENSIONS = new Map(
	Object.entries(EVIDENCE_CONTENT_TYPES).map(([type, extension]) => [extension as string, type])
);

/**
 * The origin evidence URLs are on. Evidence lives in the App, and so does the sign-in
 * callback, so the App's origin is the origin of OIDC_REDIRECT_URI. There is no separate
 * configuration value for it.
 */
export function evidenceStoreOrigin(config: Pick<Config, 'OIDC_REDIRECT_URI'>): string {
	return new URL(config.OIDC_REDIRECT_URI).origin;
}

/**
 * - `photo`: a picture from our store.
 * - `document`: a PDF from our store.
 * - `foreign`: the URL is not a file in our evidence store.
 * - `hash_mismatch`: the URL is ours, but the hash given is not that file's.
 */
export type EvidenceVerdict = 'photo' | 'document' | 'foreign' | 'hash_mismatch';

export function checkEvidence(photo: Photo, storeOrigin: string): EvidenceVerdict {
	const url = URL.parse(photo.url);
	if (!url || url.origin !== storeOrigin || url.search !== '' || url.hash !== '') return 'foreign';

	const match = EVIDENCE_PATH.exec(url.pathname);
	const type = match?.[2] ? EXTENSIONS.get(match[2]) : undefined;
	if (!match || !type) return 'foreign';

	if (match[1] !== photo.sha256) return 'hash_mismatch';
	return type === 'application/pdf' ? 'document' : 'photo';
}
