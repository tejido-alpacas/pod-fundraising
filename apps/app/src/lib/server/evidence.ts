/**
 * Stores one evidence file. Used by `POST /api/evidence` (agents) and by the upload page's
 * form action (people), so both name a file the same way: by the SHA-256 of its bytes.
 *
 * The caller has already checked who is asking and that the file is an allowed type and size.
 */
import type { R2Bucket } from '@cloudflare/workers-types';
import {
	EVIDENCE_CONTENT_TYPES,
	type EvidenceContentType,
	type EvidenceUploadResponse
} from '@tejido/contracts';
import { createHash } from 'node:crypto';

export async function storeEvidence(
	evidence: R2Bucket,
	file: File,
	type: EvidenceContentType,
	origin: string
): Promise<EvidenceUploadResponse> {
	const bytes = Buffer.from(await file.arrayBuffer());
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const name = `${sha256}.${EVIDENCE_CONTENT_TYPES[type]}`;

	await evidence.put(name, bytes, { httpMetadata: { contentType: type } });

	return { url: `${origin}/evidence/${name}`, sha256 };
}
