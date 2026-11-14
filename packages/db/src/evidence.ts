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
 *
 * In this package, next to checkin-rules.ts, because both apps apply the check.
 * apps/web/src/lib/server/backend/evidence.ts passes it on under its old path.
 */
import type { Config } from '@tejido/config';

// The check itself is in @tejido/contracts, next to the type that says what a donor is told
// about each file. It is passed on here so everything that imported it from this package
// still does.
export { checkEvidence, type EvidenceVerdict } from '@tejido/contracts';

/**
 * The origin evidence URLs are on. Evidence lives in the App, and so does the sign-in
 * callback, so the App's origin is the origin of OIDC_REDIRECT_URI. There is no separate
 * configuration value for it.
 */
export function evidenceStoreOrigin(config: Pick<Config, 'OIDC_REDIRECT_URI'>): string {
	return new URL(config.OIDC_REDIRECT_URI).origin;
}
