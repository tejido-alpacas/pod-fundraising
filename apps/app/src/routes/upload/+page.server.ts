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
import { readVisibilityChoice, storeEvidence } from '#lib/server/evidence.ts';
import type { Actions, PageServerLoad } from './$types';

/** What the layout draws above the page: the design's field header, with a way back. */
const header = { title: 'Add evidence', subtitle: 'Photos and documents', backHref: '/' };

export const load: PageServerLoad = ({ locals }) => {
	const { session } = locals;
	if (!session) return { header, viewer: 'signed_out' as const, email: null };
	// Only a party on a campaign may upload, exactly as `POST /api/evidence` decides.
	return {
		header,
		viewer: session.partyId ? ('party' as const) : ('no_party' as const),
		email: session.email
	};
};

export const actions = {
	upload: async ({ request, locals, url }) => {
		// Before anything is read or stored.
		if (!locals.session) return fail(401, { refused: PROBLEM_SENTENCES.not_signed_in });
		const partyId = locals.session.partyId;
		if (!partyId) return fail(403, { refused: PROBLEM_SENTENCES.not_a_party });

		const form = await request.formData();
		// A file input left untouched still sends one nameless, empty file. That is not a choice.
		const files = form
			.getAll(EVIDENCE_FILE_FIELD)
			.filter((entry): entry is File => entry instanceof File)
			.filter((file) => !(file.name === '' && file.size === 0));
		if (files.length === 0) {
			return fail(400, { refused: 'No file was chosen. Choose a photo or a document first.' });
		}

		// One choice of who may see them covers every file sent together.
		const chosen = readVisibilityChoice(form);
		if (!chosen.ok) return fail(422, { refused: PROBLEM_SENTENCES.not_public_words });

		// Each file stands on its own: one that fails does not stop the ones after it.
		const results: UploadResult[] = [];
		for (const file of files) {
			const check = checkEvidenceFile(file);
			if (!check.ok) {
				results.push({ name: file.name, ok: false, problem: PROBLEM_SENTENCES[check.problem] });
				continue;
			}
			try {
				const outcome = await storeEvidence({
					evidence: locals.ctx.evidence,
					db: locals.ctx.db,
					file,
					type: check.type,
					origin: url.origin,
					partyId,
					choice: chosen.choice
				});
				if (!outcome.stored) {
					results.push({
						name: file.name,
						ok: false,
						problem: PROBLEM_SENTENCES.not_yours_to_change
					});
					continue;
				}
				const { url: address, sha256, visibility } = outcome;
				results.push({
					name: file.name,
					ok: true,
					url: address,
					sha256,
					visibility,
					picture: isPicture(check.type)
				});
			} catch {
				results.push({ name: file.name, ok: false, problem: PROBLEM_SENTENCES.unexpected });
			}
		}
		return { results };
	}
} satisfies Actions;
