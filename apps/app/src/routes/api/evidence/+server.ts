/**
 * POST /api/evidence: accepts one file, stores it in R2, answers { url, sha256 }.
 * Track B owns this file.
 *
 * Send multipart/form-data with the file in the `file` field. Files are stored under their
 * own SHA-256, so uploading the same bytes twice gives the same URL.
 *
 * SvelteKit refuses form posts from another origin. A script or agent calling this from
 * outside a browser must send an `Origin` header equal to the app's own origin.
 *
 * Only a signed-in party may upload: someone who followed their invite link and signed in
 * with Qatom. The session cookie from that sign-in must come with the request.
 */
import { error, json } from '@sveltejs/kit';
import {
	EVIDENCE_CONTENT_TYPES,
	EVIDENCE_FILE_FIELD,
	EVIDENCE_MAX_BYTES,
	isEvidenceContentType,
	type EvidenceUploadResponse
} from '@tejido/contracts';
import { createHash } from 'node:crypto';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	// Before anything is read or stored.
	if (!locals.session) {
		error(401, 'Sign in from your invite link before uploading evidence.');
	}
	if (!locals.session.partyId) {
		error(
			403,
			'Only a party invited to a campaign can upload evidence. Sign in from your invite link.'
		);
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		error(400, 'Send multipart/form-data with the file in a field named "file".');
	}

	const file = form.get(EVIDENCE_FILE_FIELD);
	if (!(file instanceof File)) error(400, 'No file in the field named "file".');
	if (!isEvidenceContentType(file.type)) {
		error(415, `Evidence must be one of: ${Object.keys(EVIDENCE_CONTENT_TYPES).join(', ')}.`);
	}
	if (file.size === 0) error(400, 'The file is empty.');
	if (file.size > EVIDENCE_MAX_BYTES) {
		error(413, `Evidence can be at most ${EVIDENCE_MAX_BYTES / 1024 / 1024} MB.`);
	}

	const bytes = Buffer.from(await file.arrayBuffer());
	const sha256 = createHash('sha256').update(bytes).digest('hex');
	const name = `${sha256}.${EVIDENCE_CONTENT_TYPES[file.type]}`;

	await locals.ctx.evidence.put(name, bytes, { httpMetadata: { contentType: file.type } });

	return json({ url: `${url.origin}/evidence/${name}`, sha256 } satisfies EvidenceUploadResponse, {
		status: 201
	});
};
