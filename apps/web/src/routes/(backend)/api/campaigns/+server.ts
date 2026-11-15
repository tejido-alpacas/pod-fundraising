/**
 * POST /api/campaigns: checks a whole campaign as the campaign builder sends it, then creates
 * it. Track C owns this file. The request and every answer are in docs/campaign-api.md.
 *
 * This is the builder page's "create" behind a JSON endpoint: the same check
 * (#lib/campaign-site/builder/check.ts) and the same create
 * (#lib/campaign-site/server/create-campaign.ts), unchanged. So the campaign is created as a
 * draft with an unguessable id, at most CREATED_PER_HOUR are created in any hour, and the
 * answer holds no email address and no filing code.
 *
 * Nothing here calls Qatom, moves money or sends email.
 */
import { checkDraft } from '#lib/campaign-site/builder/check.ts';
import { reviveDraft } from '#lib/campaign-site/builder/draft.ts';
import { CREATED_PER_HOUR, createCampaign } from '#lib/campaign-site/server/create-campaign.ts';
import { answer, readJsonObject, refuse } from '#lib/server/backend/campaign-api.ts';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, locals }) => {
	const { db, config } = locals.ctx;

	const read = await readJsonObject(request);
	if (!read.ok) return read.response;

	const checked = checkDraft(reviveDraft(read.body));
	if (checked.value === null) {
		return refuse(
			400,
			'invalid_campaign',
			'Some answers are missing or need changing. Nothing was saved.',
			{ fields: checked.errors, notices: checked.notices }
		);
	}

	const outcome = await createCampaign(db, config, checked.value);
	if (!outcome.created) {
		return refuse(
			429,
			'too_many',
			`Tejido creates at most ${String(CREATED_PER_HOUR)} campaigns an hour, and that many have just been created. Nothing was saved. Try again in an hour.`
		);
	}
	return answer(
		201,
		{ campaign: outcome.campaign, notices: checked.notices },
		{ location: outcome.campaign.path }
	);
};
