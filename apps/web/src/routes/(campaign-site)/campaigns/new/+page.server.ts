import { fail } from '@sveltejs/kit';
import { checkDraft } from '#lib/campaign-site/builder/check.ts';
import {
	isStep,
	reviveDraft,
	stepOf,
	type BuilderDraft,
	type FieldErrors,
	type Step
} from '#lib/campaign-site/builder/draft.ts';
import { CREATED_PER_HOUR, createCampaign } from '#lib/campaign-site/server/create-campaign.ts';
import type { Actions } from './$types';

// The campaign builder (screen A5). The draft lives in the organiser's browser; each
// "Continue" posts it here to be checked, and "Create campaign" posts it one last time to be
// checked whole and written. Nothing is stored until then, and nothing here calls Qatom.

/** A whole draft is a few thousand characters. Anything far larger is not a draft. */
const MAX_DRAFT_CHARACTERS = 200_000;

async function readDraft(request: Request): Promise<{ draft: BuilderDraft; step: string | null }> {
	const form = await request.formData();
	const sent = form.get('draft');
	const step = form.get('step');
	let parsed: unknown = null;
	if (typeof sent === 'string' && sent.length <= MAX_DRAFT_CHARACTERS) {
		try {
			parsed = JSON.parse(sent);
		} catch {
			// Not JSON: it is read as an empty draft, and every required field then says so.
			parsed = null;
		}
	}
	return { draft: reviveDraft(parsed), step: typeof step === 'string' ? step : null };
}

function only(errors: FieldErrors, step: Step): FieldErrors {
	return Object.fromEntries(Object.entries(errors).filter(([name]) => stepOf(name) === step));
}

export const actions = {
	/** Checks one step. Answers that step's problems, or nothing when it may continue. */
	check: async ({ request }) => {
		const { draft, step } = await readDraft(request);
		if (!isStep(step) || step === 'review') {
			return fail(400, { action: 'check' as const, errors: {} as FieldErrors, unknownStep: true });
		}
		const errors = only(checkDraft(draft).errors, step);
		if (Object.keys(errors).length > 0) {
			return fail(400, { action: 'check' as const, step, errors });
		}
		return { action: 'check' as const, step, passed: true };
	},

	/** Checks everything, then creates the campaign as a draft. */
	create: async ({ request, locals }) => {
		const { db, config } = locals.ctx;
		const { draft } = await readDraft(request);
		const checked = checkDraft(draft);
		if (checked.value === null) {
			return fail(400, { action: 'create' as const, errors: checked.errors });
		}

		const outcome = await createCampaign(db, config, checked.value);
		if (!outcome.created) {
			return fail(429, {
				action: 'create' as const,
				errors: {} as FieldErrors,
				refused: `Tejido creates at most ${String(CREATED_PER_HOUR)} campaigns an hour while the builder is open to everyone, and that many have just been created. Nothing was saved on Tejido. Your answers are still on this device: try again in an hour.`
			});
		}
		return { action: 'create' as const, created: outcome.campaign };
	}
} satisfies Actions;
