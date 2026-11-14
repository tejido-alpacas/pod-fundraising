/**
 * Checks on the `photos` list of a check-in. Track C owns them.
 *
 * The checks themselves are in packages/db/src/evidence.ts, unchanged. They moved there with
 * the check-in rules so the App can apply the same ones; see checkin-rules.ts in this folder.
 * This file passes them on, so everything in the Campaign Site imports them as before.
 */
export { checkEvidence, evidenceStoreOrigin, type EvidenceVerdict } from '@tejido/db';
