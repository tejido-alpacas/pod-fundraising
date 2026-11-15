/**
 * The campaign builder's draft: what the organiser has typed so far, exactly as typed.
 *
 * The browser keeps it between steps (see store.ts) and sends it whole to the server, which is
 * the only place it is checked (server/builder.ts). Nothing here is trusted: `reviveDraft`
 * turns anything at all into a draft of the right shape, and the server validates that.
 */
import {
	DAYS_CADENCE_PREFIX,
	FIXED_CADENCES,
	type Cadence,
	type DaysCadence,
	type MilestoneKind,
	type PartyRelationship,
	type PartyRole
} from '@tejido/contracts';

export const STEPS = ['project', 'funding', 'milestones', 'people', 'schedule', 'review'] as const;
export type Step = (typeof STEPS)[number];

export function isStep(value: string | null): value is Step {
	return (STEPS as readonly string[]).includes(value ?? '');
}

/** The most milestones and the most people one campaign can be created with here. */
export const MAX_MILESTONES = 20;
export const MAX_PEOPLE = 20;

export interface DraftMilestone {
	/** Names this milestone inside the draft only. The server mints the real id. */
	key: string;
	title: string;
	description: string;
	kind: MilestoneKind | '';
	/** `2026-11-27`, as a date input gives it. */
	dueDate: string;
	/** The key of the person who does the work, and of the person who confirms it. */
	ownerKey: string;
	confirmerKey: string;
}

export interface DraftPerson {
	key: string;
	role: PartyRole;
	name: string;
	/** What they do on the project: "Contractor", "Head teacher". */
	title: string;
	email: string;
	/** Asked of confirmers only. */
	relationship: PartyRelationship | '';
	relationshipReason: string;
}

export interface BuilderDraft {
	project: {
		title: string;
		summary: string;
		beneficiary: string;
		creatorName: string;
		creatorEmail: string;
	};
	funding: {
		/** The goal as typed, in USD-TDN: "12,000" or "12000.50". Empty means no goal. */
		goal: string;
	};
	milestones: DraftMilestone[];
	people: DraftPerson[];
	/**
	 * Empty until chosen. Chosen days are written as the contract writes them, `days:mon,thu`;
	 * while "On chosen days" is picked and no day is yet, this is `days:` alone, which is not
	 * a cadence and is refused by the check.
	 */
	schedule: { cadence: Cadence | '' };
}

/** True for text that starts the way chosen days are written, whatever follows. */
export function isChosenDays(cadence: string): cadence is DaysCadence {
	return cadence.startsWith(DAYS_CADENCE_PREFIX);
}

export function emptyDraft(): BuilderDraft {
	return {
		project: { title: '', summary: '', beneficiary: '', creatorName: '', creatorEmail: '' },
		funding: { goal: '' },
		milestones: [],
		people: [],
		schedule: { cadence: '' }
	};
}

let minted = 0;
/** A key for a new milestone or person. Unique within one draft; not a secret and not an id. */
export function newKey(): string {
	minted += 1;
	return `k${Date.now().toString(36)}${minted.toString(36)}`;
}

export function emptyMilestone(): DraftMilestone {
	return {
		key: newKey(),
		title: '',
		description: '',
		kind: '',
		dueDate: '',
		ownerKey: '',
		confirmerKey: ''
	};
}

export function emptyPerson(role: PartyRole): DraftPerson {
	return {
		key: newKey(),
		role,
		name: '',
		title: '',
		email: '',
		relationship: '',
		relationshipReason: ''
	};
}

// ---------------------------------------------------------------------------
// Reading a draft back from storage, or from a request
// ---------------------------------------------------------------------------

// Longer than any field the contracts allow, so nothing valid is cut; short enough that a
// hostile draft cannot be large.
const MAX_TEXT = 4000;
const KEY = /^[a-z0-9]{1,24}$/;

const record = (value: unknown): Record<string, unknown> =>
	typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
const text = (value: unknown): string =>
	typeof value === 'string' ? value.slice(0, MAX_TEXT) : '';
const key = (value: unknown): string => (typeof value === 'string' && KEY.test(value) ? value : '');
const list = (value: unknown, most: number): unknown[] =>
	Array.isArray(value) ? value.slice(0, most) : [];
function oneOf<const T extends string>(value: unknown, allowed: readonly T[]): T | '' {
	return allowed.find((candidate) => candidate === value) ?? '';
}

const KINDS = ['construction', 'goods_delivery', 'funds_handover', 'service'] as const;
const RELATIONSHIPS = ['participant', 'stakeholder', 'independent'] as const;

/** Longer than every day of the week written out (`days:mon,tue,wed,thu,fri,sat,sun`). */
const MAX_CHOSEN_DAYS_TEXT = 64;

/**
 * A cadence as stored or sent: one of the single words, or anything that starts like chosen
 * days, kept as written for the check to read. Anything else is empty.
 */
function cadenceAsSent(value: unknown): Cadence | '' {
	const fixed = oneOf(value, FIXED_CADENCES);
	if (fixed !== '') return fixed;
	if (typeof value !== 'string' || value.length > MAX_CHOSEN_DAYS_TEXT) return '';
	return isChosenDays(value) ? value : '';
}

/**
 * Rebuilds a draft from anything: a stored string that was edited by hand, an old shape, or a
 * request body. Unknown fields are dropped, missing ones are empty, and a milestone or person
 * without a usable key is left out. It never throws. It reads one more than the most
 * milestones and people allowed, so the server can still say "too many".
 */
export function reviveDraft(value: unknown): BuilderDraft {
	const source = record(value);
	const project = record(source['project']);
	const seen = new Set<string>();
	const fresh = (candidate: string): boolean => {
		if (candidate === '' || seen.has(candidate)) return false;
		seen.add(candidate);
		return true;
	};

	const people = list(source['people'], MAX_PEOPLE + 1)
		.map(record)
		.map((person): DraftPerson => ({
			key: key(person['key']),
			role: person['role'] === 'confirmer' ? 'confirmer' : 'third_party',
			name: text(person['name']),
			title: text(person['title']),
			email: text(person['email']),
			relationship: oneOf(person['relationship'], RELATIONSHIPS),
			relationshipReason: text(person['relationshipReason'])
		}))
		.filter((person) => fresh(person.key));

	const milestones = list(source['milestones'], MAX_MILESTONES + 1)
		.map(record)
		.map((milestone): DraftMilestone => ({
			key: key(milestone['key']),
			title: text(milestone['title']),
			description: text(milestone['description']),
			kind: oneOf(milestone['kind'], KINDS),
			dueDate: text(milestone['dueDate']),
			ownerKey: key(milestone['ownerKey']),
			confirmerKey: key(milestone['confirmerKey'])
		}))
		.filter((milestone) => fresh(milestone.key));

	return {
		project: {
			title: text(project['title']),
			summary: text(project['summary']),
			beneficiary: text(project['beneficiary']),
			creatorName: text(project['creatorName']),
			creatorEmail: text(project['creatorEmail'])
		},
		funding: { goal: text(record(source['funding'])['goal']) },
		milestones,
		people,
		schedule: { cadence: cadenceAsSent(record(source['schedule'])['cadence']) }
	};
}

// ---------------------------------------------------------------------------
// What the server answers
// ---------------------------------------------------------------------------

/**
 * Problems by field: `project.title`, `milestones.<key>.dueDate`, `people.<key>.email`,
 * `assign.<milestone key>.confirmer`. The part before the first dot says which list a problem
 * is in; `stepOf` says which step shows it.
 */
export type FieldErrors = Record<string, string>;

export function stepOf(field: string): Step {
	const head = field.split('.')[0];
	if (head === 'project' || head === 'funding' || head === 'milestones' || head === 'schedule') {
		return head;
	}
	return 'people';
}

/** A note that does not stop the organiser: something donors will see, said before they do. */
export interface Notice {
	/** The milestone or person it is about. */
	key: string;
	kind: 'no_independent_confirmer' | 'independent_may_benefit';
	title: string;
	body: string;
}

/** What the "campaign created" page shows. It holds no email address and no filing code. */
export interface CreatedCampaign {
	id: string;
	title: string;
	/** The campaign's own page on this site. */
	path: string;
	invitations: { name: string; title: string; role: PartyRole; url: string }[];
}
