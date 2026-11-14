/**
 * POST /api/campaigns/check: checks a campaign as the campaign builder sends it, and saves
 * nothing. Track C owns this file. The request and the answer are in docs/campaign-api.md.
 *
 * `?step=project|funding|milestones|people|schedule` answers that step's problems only, so a
 * form can check one screen at a time. The check itself is #lib/old/builder/check.ts,
 * unchanged. Nothing here touches the database or calls Qatom.
 */
import { checkDraft } from '#lib/old/builder/check.ts';
import { isStep, reviveDraft, stepOf, type FieldErrors } from '#lib/old/builder/draft.ts';
import { answer, readJsonObject, refuse } from '#lib/server/backend/campaign-api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, url }) => {
	const step = url.searchParams.get('step');
	// "review" is the builder's last screen. It has no fields of its own to check.
	if (step !== null && (!isStep(step) || step === 'review')) {
		return refuse(
			400,
			'invalid_step',
			'The step must be one of: project, funding, milestones, people, schedule. Leave it out to check everything.'
		);
	}

	const read = await readJsonObject(request);
	if (!read.ok) return read.response;

	const checked = checkDraft(reviveDraft(read.body));
	const fields: FieldErrors =
		step === null
			? checked.errors
			: Object.fromEntries(
					Object.entries(checked.errors).filter(([name]) => stepOf(name) === step)
				);
	return answer(200, {
		ok: Object.keys(fields).length === 0,
		fields,
		notices: checked.notices
	});
};
