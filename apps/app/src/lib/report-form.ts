/**
 * The report form inside the chat (B6, guided collection). Track B owns this file.
 *
 * The form is a shortcut: it collects the fields one report needs, so the agent does not have
 * to ask for them one at a time. Sending it files nothing. The values go into the conversation
 * as a message, and the agent files the report with them, as the signed-in person, once that
 * person says yes.
 *
 * Safe in the browser: no server-only import. The field names are the contracts' own
 * (`packages/contracts/src/items.ts`); nothing here adds a field the two items do not declare.
 */
import {
	MAX_PHOTOS_PER_ENTRY,
	type MilestoneClaim,
	type MilestoneKind,
	type MilestoneState,
	type WorkLogStatus
} from '@tejido/contracts';

/** What the form can prepare: a work log, or one of the four claims of a milestone hit. */
export type ReportKind = 'log_work' | MilestoneClaim;

export const REPORT_KINDS: readonly ReportKind[] = [
	'log_work',
	'completed',
	'delivered',
	'funds_spent',
	'confirm'
];

/** One uploaded file, as `POST /api/evidence` answered it. */
export interface ReportFormFile {
	url: string;
	sha256: string;
}

/**
 * What the page sends when the form is submitted. `kind` picks the tool (and, for a milestone
 * hit, the claim); every other name is an input of that tool in the contracts.
 */
export interface ReportFormValues {
	kind: ReportKind;
	milestone_id: string;
	/** The note. */
	summary: string;
	/** Work log only. */
	status?: WorkLogStatus;
	/** Work log only. */
	percent_complete?: number;
	/** A delivery only. */
	quantity?: number;
	/** A delivery only. */
	unit?: string;
	/** A funds handover only. */
	amount_spent?: number;
	photos?: ReportFormFile[];
}

/** The parts of the form a problem can be about. `form` is the form as a whole. */
export type ReportFormField = keyof ReportFormValues | 'form';

/** One plain sentence per part that needs fixing. */
export type ReportFormProblems = Partial<Record<ReportFormField, string>>;

/**
 * What each type of milestone asks for. This is the table of milestone types in
 * `docs/architecture.md`, which the check-in endpoint enforces after the deposit is paid.
 */
export const MILESTONE_KIND_RULES: Record<
	MilestoneKind,
	{
		/** The claim that says this type of milestone is done. */
		claim: Exclude<MilestoneClaim, 'confirm'>;
		/** Documents only: no pictures on any report about the milestone. */
		documentsOnly: boolean;
		/** A work log needs a percent complete, unless it says the work is blocked. */
		workLogNeedsPercent: boolean;
	}
> = {
	construction: { claim: 'completed', documentsOnly: false, workLogNeedsPercent: true },
	goods_delivery: { claim: 'delivered', documentsOnly: false, workLogNeedsPercent: false },
	funds_handover: { claim: 'funds_spent', documentsOnly: true, workLogNeedsPercent: false },
	service: { claim: 'completed', documentsOnly: true, workLogNeedsPercent: false }
};

/** What the form needs to know about a milestone. Nothing private. */
export interface ReportFormMilestone {
	id: string;
	title: string;
	kind: MilestoneKind;
	state: MilestoneState;
	/** Whether the signed-in party owes this milestone or confirms it. */
	part: 'owes' | 'confirms';
}

/**
 * The reports this party can prepare on this milestone, most routine first. Empty once the
 * milestone is confirmed: there is nothing more to file on it.
 */
export function reportKindsFor(
	milestone: Pick<ReportFormMilestone, 'kind' | 'state' | 'part'>
): ReportKind[] {
	if (milestone.state === 'confirmed_independent' || milestone.state === 'confirmed_creator') {
		return [];
	}
	if (milestone.part === 'confirms') return ['confirm'];
	return ['log_work', MILESTONE_KIND_RULES[milestone.kind].claim];
}

export type ReportDetailField =
	'status' | 'percent_complete' | 'quantity' | 'unit' | 'amount_spent';

/** The fields a report of this kind takes besides the milestone, the note and the files. */
export function detailFieldsFor(kind: ReportKind): ReportDetailField[] {
	switch (kind) {
		case 'log_work':
			return ['status', 'percent_complete'];
		case 'delivered':
			return ['quantity', 'unit'];
		case 'funds_spent':
			return ['amount_spent'];
		default:
			return [];
	}
}

export const REPORT_KIND_NAMES: Record<ReportKind, string> = {
	log_work: 'Work log',
	completed: 'Milestone done',
	delivered: 'Delivery made',
	funds_spent: 'Funds spent',
	confirm: 'Confirm the milestone'
};

export const STATUS_NAMES: Record<WorkLogStatus, string> = {
	on_track: 'On track',
	delayed: 'Delayed',
	blocked: 'Blocked'
};

/** The sentence shown under a field that needs fixing. The server and the page use the same. */
export const FIELD_SENTENCES = {
	kind: 'Choose which report this is.',
	milestone_id: 'Choose one of your milestones.',
	summary: 'Write a note saying what was done. It can be up to 4,000 characters.',
	status: 'Choose whether the work is on track, delayed or blocked.',
	percent_complete: 'Give the percent complete as a number from 0 to 100.',
	percent_needed:
		'A work log on a construction milestone needs a percent complete, from 0 to 100, unless the work is blocked.',
	quantity: 'Give how many were delivered, as a number that is zero or more.',
	unit: 'Say what the quantity counts, for example “books”. Up to 50 characters.',
	amount_spent: 'Give the amount spent, as a number that is zero or more.',
	photos: `Attach at most ${MAX_PHOTOS_PER_ENTRY} files, each one uploaded here or on the upload page.`,
	documents_only:
		'This milestone takes documents only (PDF), not pictures. Remove the pictures and attach the receipt or letter instead.',
	form: 'The form could not be read. Reload the page and fill it in again.'
} as const;

/**
 * A number somebody typed. Empty is "not given"; anything that is not a plain number is
 * `null`, so the page can say so instead of sending a guess.
 */
export function typedNumber(text: string): number | undefined | null {
	const trimmed = text.trim().replace(',', '.');
	if (trimmed === '') return undefined;
	if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
	return Number(trimmed);
}

/** The form as the conversation shows it back to the person: a label and a value per line. */
export function reportFormLines(
	values: ReportFormValues,
	milestoneTitle: string | undefined
): { label: string; value: string }[] {
	const lines = [
		{ label: 'Report', value: REPORT_KIND_NAMES[values.kind] },
		{ label: 'Milestone', value: milestoneTitle ?? values.milestone_id }
	];
	if (values.status) lines.push({ label: 'Status', value: STATUS_NAMES[values.status] });
	if (values.percent_complete !== undefined) {
		lines.push({ label: 'Percent complete', value: `${values.percent_complete}%` });
	}
	if (values.quantity !== undefined) {
		lines.push({ label: 'Quantity', value: `${values.quantity} ${values.unit ?? ''}`.trim() });
	}
	if (values.amount_spent !== undefined) {
		lines.push({ label: 'Amount spent', value: String(values.amount_spent) });
	}
	lines.push({ label: 'Note', value: values.summary });
	const files = values.photos?.length ?? 0;
	if (files > 0) lines.push({ label: 'Files', value: `${files} attached` });
	return lines;
}
