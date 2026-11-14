import { z } from 'zod';
import { sha256Schema } from './primitives.ts';

/** What `POST /api/evidence` answers: where the stored file is, and the SHA-256 of its bytes. */
export const evidenceUploadResponseSchema = z.object({
	url: z.url({ protocol: /^https?$/ }),
	sha256: sha256Schema
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
