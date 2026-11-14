/**
 * The upload page (B3). Track B owns this file.
 *
 * The form on the page posts here, so one or several files can be uploaded with JavaScript
 * off. With JavaScript on, the page sends each file to `POST /api/evidence` instead. Both
 * store a file the same way (`storeEvidence`) and both require a signed-in party.
 */
import { fail } from '@sveltejs/kit';
import { EVIDENCE_FILE_FIELD } from '@tejido/contracts';
import {
	checkEvidenceFile,
	isPicture,
	PROBLEM_SENTENCES,
	type UploadResult
} from '#lib/evidence.ts';
import { storeEvidence } from '#lib/server/evidence.ts';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = ({ locals }) => {
	const { session } = locals;
	if (!session) return { viewer: 'signed_out' as const, email: null };
	// Only a party on a campaign may upload, exactly as `POST /api/evidence` decides.
	return {
		viewer: session.partyId ? ('party' as const) : ('no_party' as const),
		email: session.email
	};
};

export const actions = {
	upload: async ({ request, locals, url }) => {
		// Before anything is read or stored.
		if (!locals.session) return fail(401, { refused: PROBLEM_SENTENCES.not_signed_in });
		if (!locals.session.partyId) return fail(403, { refused: PROBLEM_SENTENCES.not_a_party });

		const form = await request.formData();
		// A file input left untouched still sends one nameless, empty file. That is not a choice.
		const files = form
			.getAll(EVIDENCE_FILE_FIELD)
			.filter((entry): entry is File => entry instanceof File)
			.filter((file) => !(file.name === '' && file.size === 0));
		if (files.length === 0) {
			return fail(400, { refused: 'No file was chosen. Choose a photo or a document first.' });
		}

		// Each file stands on its own: one that fails does not stop the ones after it.
		const results: UploadResult[] = [];
		for (const file of files) {
			const check = checkEvidenceFile(file);
			if (!check.ok) {
				results.push({ name: file.name, ok: false, problem: PROBLEM_SENTENCES[check.problem] });
				continue;
			}
			try {
				const stored = await storeEvidence(locals.ctx.evidence, file, check.type, url.origin);
				results.push({ name: file.name, ok: true, ...stored, picture: isPicture(check.type) });
			} catch {
				results.push({ name: file.name, ok: false, problem: PROBLEM_SENTENCES.unexpected });
			}
		}
		return { results };
	}
} satisfies Actions;
