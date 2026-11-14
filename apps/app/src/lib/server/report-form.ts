/**
 * Checks a report form sent from the chat page, and writes the message the agent reads.
 * Track B owns this file.
 *
 * Nothing here files a report or calls Qatom. A form that passes becomes one message in the
 * conversation; the agent is still the only thing that calls the work-log or milestone tool,
 * as the signed-in person.
 *
 * The values are checked with the contracts' own schemas, narrowed to the fields this kind of
 * report takes, and then against what a schema cannot say: whose milestone it is, and what
 * that type of milestone needs (`docs/architecture.md`, the table of milestone types).
 */
import {
	EVIDENCE_CONTENT_TYPES,
	logWorkInputSchema,
	milestoneHitInputSchema,
	type LogWorkInput,
	type Milestone,
	type MilestoneHitInput,
	type Party
} from '@tejido/contracts';
import {
	FIELD_SENTENCES,
	MILESTONE_KIND_RULES,
	REPORT_KINDS,
	reportKindsFor,
	type ReportFormField,
	type ReportFormProblems,
	type ReportKind
} from '#lib/report-form.ts';

/** How a form's message starts. The agent's instructions name it. */
export const REPORT_FORM_MARKER = '[Report form]';

// Each kind of report, as the contract's schema cut down to the fields the form carries.
// `.strict()` refuses anything else, so a form cannot smuggle in a field (a reporter code, say).
const common = { milestone_id: true, summary: true, photos: true } as const;
const workLogSchema = logWorkInputSchema
	.pick({ ...common, status: true, percent_complete: true })
	.strict();
const plainClaimSchema = milestoneHitInputSchema.pick({ ...common, claim: true }).strict();
const deliverySchema = milestoneHitInputSchema
	.pick({ ...common, claim: true, quantity: true, unit: true })
	.required({ quantity: true, unit: true })
	.strict();
const fundsSchema = milestoneHitInputSchema
	.pick({ ...common, claim: true, amount_spent: true })
	.required({ amount_spent: true })
	.strict();

/** A report ready for the agent: which tool, and its inputs in the contract's shape. */
export type CheckedReport =
	| { item: 'log_work'; inputs: Omit<LogWorkInput, 'reporter_code'> }
	| { item: 'milestone_hit'; inputs: Omit<MilestoneHitInput, 'reporter_code'> };

export type ReportFormCheck =
	| { ok: true; report: CheckedReport; milestone: Milestone }
	| { ok: false; problems: ReportFormProblems };

export interface ReportFormFacts {
	/** The signed-in party. */
	party: Party;
	/** Every milestone of that party's campaign. */
	milestones: Milestone[];
	/** The origin evidence is served from: the App's own. */
	evidenceOrigin: string;
	/**
	 * True for the form the person just sent. An earlier form in the same conversation was
	 * accepted when it was sent, and its milestone may have been confirmed since.
	 */
	latest: boolean;
}

function isReportKind(value: unknown): value is ReportKind {
	return REPORT_KINDS.some((kind) => kind === value);
}

const FIELDS: readonly ReportFormField[] = [
	'milestone_id',
	'summary',
	'status',
	'percent_complete',
	'quantity',
	'unit',
	'amount_spent',
	'photos'
];

const EVIDENCE_EXTENSIONS = Object.values(EVIDENCE_CONTENT_TYPES).join('|');

/** The extension of a file in our own evidence store, or null if the URL is not one of ours. */
function evidenceExtension(photo: { url: string; sha256: string }, origin: string): string | null {
	const prefix = `${origin}/evidence/${photo.sha256}.`;
	if (!photo.url.startsWith(prefix)) return null;
	const extension = photo.url.slice(prefix.length);
	return new RegExp(`^(${EVIDENCE_EXTENSIONS})$`).test(extension) ? extension : null;
}

export function checkReportForm(input: unknown, facts: ReportFormFacts): ReportFormCheck {
	const refused = (problems: ReportFormProblems): ReportFormCheck => ({ ok: false, problems });

	if (typeof input !== 'object' || input === null || Array.isArray(input)) {
		return refused({ form: FIELD_SENTENCES.form });
	}
	const { kind, ...rest } = input as Record<string, unknown>;
	if (!isReportKind(kind)) return refused({ kind: FIELD_SENTENCES.kind });

	// Whose milestone is it? Only one this party owes or confirms.
	const { party } = facts;
	const milestone = facts.milestones.find(
		(candidate) =>
			candidate.id === rest.milestone_id &&
			(candidate.ownerPartyId === party.id || candidate.confirmerPartyId === party.id)
	);
	if (!milestone) return refused({ milestone_id: FIELD_SENTENCES.milestone_id });

	const part = milestone.ownerPartyId === party.id ? 'owes' : 'confirms';
	const rules = MILESTONE_KIND_RULES[milestone.kind];
	const offered = reportKindsFor({
		kind: milestone.kind,
		part,
		// See `latest`: only a form sent just now is held to the milestone's state today.
		state: facts.latest ? milestone.state : 'open'
	});
	if (offered.length === 0) {
		return refused({
			milestone_id: `“${milestone.title}” is already confirmed. There is nothing more to file on it.`
		});
	}
	if (!offered.includes(kind)) {
		return refused({
			kind:
				part === 'confirms'
					? `You are the confirmer of “${milestone.title}”, so the only report you can file on it is a confirmation.`
					: kind === 'confirm'
						? `You owe “${milestone.title}”, so you cannot confirm it yourself. Its confirmer does that.`
						: `“${milestone.title}” is claimed with “${rules.claim.replace('_', ' ')}”. Choose that, or a work log.`
		});
	}

	const parsed =
		kind === 'log_work'
			? workLogSchema.safeParse(rest)
			: kind === 'delivered'
				? deliverySchema.safeParse({ ...rest, claim: kind })
				: kind === 'funds_spent'
					? fundsSchema.safeParse({ ...rest, claim: kind })
					: plainClaimSchema.safeParse({ ...rest, claim: kind });

	const problems: ReportFormProblems = {};
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const field = FIELDS.find((name) => name === issue.path[0]);
			if (field) problems[field] ??= FIELD_SENTENCES[field];
			// A field this kind of report does not take, or anything else we cannot place.
			else problems.form ??= FIELD_SENTENCES.form;
		}
		return refused(problems);
	}
	const inputs = parsed.data;
	// The same values, read without asking which kind of report they belong to.
	const given: Partial<LogWorkInput & MilestoneHitInput> = inputs;

	// What a schema cannot say.
	if (given.unit === '') problems.unit = FIELD_SENTENCES.unit;
	if (
		kind === 'log_work' &&
		rules.workLogNeedsPercent &&
		given.status !== 'blocked' &&
		given.percent_complete === undefined
	) {
		problems.percent_complete = FIELD_SENTENCES.percent_needed;
	}
	const extensions = (inputs.photos ?? []).map((photo) =>
		evidenceExtension(photo, facts.evidenceOrigin)
	);
	if (extensions.includes(null)) problems.photos = FIELD_SENTENCES.photos;
	else if (rules.documentsOnly && extensions.some((extension) => extension !== 'pdf')) {
		problems.photos = FIELD_SENTENCES.documents_only;
	}
	if (Object.keys(problems).length > 0) return refused(problems);

	// An empty list of files is the same as none.
	const { photos, ...others } = inputs;
	const tidy = photos && photos.length > 0 ? { ...others, photos } : others;

	return 'claim' in tidy
		? { ok: true, milestone, report: { item: 'milestone_hit', inputs: tidy } }
		: { ok: true, milestone, report: { item: 'log_work', inputs: tidy } };
}

/**
 * The form as one message in the conversation, written for the agent. It carries no reporter
 * code: the agent already has it, and adds it when it calls the tool.
 */
export function reportFormMessage(report: CheckedReport, milestone: Milestone): string {
	return [
		`${REPORT_FORM_MARKER} I filled in the report form in the App. The App has checked these values.`,
		`Tool: the campaign's ${report.item} tool`,
		`Milestone: ${milestone.title}`,
		'Inputs:',
		JSON.stringify(report.inputs, null, 2)
	].join('\n');
}
