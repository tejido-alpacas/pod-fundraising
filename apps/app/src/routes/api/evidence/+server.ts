/**
 * POST /api/evidence: accepts one file, stores it in R2, answers { url, sha256 }.
 * Track B owns this file.
 *
 * Send multipart/form-data with the file in the `file` field. Files are stored under their
 * own SHA-256, so uploading the same bytes twice gives the same URL.
 *
 * WHO MAY SEE THE FILE. Add the field `visibility` to choose:
 *
 * - `public`: donors are shown the file.
 * - `not_public`: only you and the campaign's confirmers can open it. Then `not_public_kind`
 *   (what it is, at most 80 characters) and `not_public_reason` (why donors are not shown it,
 *   at most 200) are required. BOTH ARE SHOWN TO DONORS: put no names in them.
 * - left out: a new file is stored as `public`; a file you uploaded before stays as it is.
 *
 * The answer's `visibility` says what the file is now. Only the party who first uploaded a
 * file can change who may see it; anyone else asking for a change is answered 409.
 * None of this is part of a check-in: the `photos` list still takes `{ url, sha256 }` only.
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
	EVIDENCE_NOT_PUBLIC_KIND_MAX,
	EVIDENCE_NOT_PUBLIC_REASON_MAX,
	isEvidenceContentType,
	type EvidenceUploadResponse
} from '@tejido/contracts';
import { readVisibilityChoice, storeEvidence } from '#lib/server/evidence.ts';
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

	const chosen = readVisibilityChoice(form);
	if (!chosen.ok) {
		error(
			422,
			`"visibility" must be "public" or "not_public". With "not_public", send "not_public_kind" (what the file is, at most ${EVIDENCE_NOT_PUBLIC_KIND_MAX} characters) and "not_public_reason" (why donors are not shown it, at most ${EVIDENCE_NOT_PUBLIC_REASON_MAX}). Both are shown to donors, so put no names in them.`
		);
	}

	// The upload page's form action stores files through the same function.
	const outcome = await storeEvidence({
		evidence: locals.ctx.evidence,
		db: locals.ctx.db,
		file,
		type: file.type,
		origin: url.origin,
		partyId: locals.session.partyId,
		choice: chosen.choice
	});
	if (!outcome.stored) {
		error(
			409,
			'This exact file was uploaded before by someone else, and only they can change who may see it. Nothing was changed.'
		);
	}
	const { stored: _stored, ...answer } = outcome;

	return json(answer satisfies EvidenceUploadResponse, { status: 201 });
};
