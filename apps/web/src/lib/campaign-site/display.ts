/**
 * How the proof, milestone and report pages write dates, counts and the three-question summary.
 * The wording follows docs/design-system/source/02-voice-and-microcopy.md.
 *
 * No server-only import here: pages use this in the browser too.
 */
import type {
	EntryStatus,
	MilestoneClaim,
	MilestoneKind,
	MilestoneState,
	PartyRelationship,
	WorkLogStatus
} from '@tejido/contracts';
import { STATES, type IconName, type StateKey, type Tone } from '@tejido/ui';

// ---------------------------------------------------------------------------
// Dates and times. The public record is always written in UTC, and says so.
// ---------------------------------------------------------------------------

const part = (iso: string, options: Intl.DateTimeFormatOptions) =>
	new Date(iso.length === 10 ? `${iso}T00:00:00.000Z` : iso).toLocaleString('en-GB', {
		timeZone: 'UTC',
		...options
	});

/**
 * A day: "14 Nov" within the current year, "22 Jan 2027" otherwise. `today` is the server's
 * date (`YYYY-MM-DD`), so the page reads the same on the server and in the browser.
 */
export function day(iso: string, today: string): string {
	const sameYear = iso.slice(0, 4) === today.slice(0, 4);
	return part(iso, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** A day with its year, for a page heading: "6 Nov 2026". */
export function fullDay(iso: string): string {
	return part(iso, { day: 'numeric', month: 'short', year: 'numeric' });
}

/** 24-hour time, labelled: "16:20 UTC". */
export function time(iso: string): string {
	return `${part(iso, { hour: '2-digit', minute: '2-digit' })} UTC`;
}

/** The short stamp beside an event: "6 Nov 16:20". The list it sits in says the times are UTC. */
export function stamp(iso: string, today: string): string {
	return `${day(iso, today)} ${part(iso, { hour: '2-digit', minute: '2-digit' })}`;
}

/** Whole days from one calendar date to a later one. Takes dates or timestamps. */
export function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / 86_400_000);
}

// ---------------------------------------------------------------------------
// Counting in words
// ---------------------------------------------------------------------------

/** "1 photo", "2 photos". */
export function count(n: number, one: string, many: string = `${one}s`): string {
	return `${n} ${n === 1 ? one : many}`;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];

/** A count that starts a sentence: "Two photos", "12 photos". */
export function countWord(n: number, one: string, many: string = `${one}s`): string {
	return `${NUMBER_WORDS[n] ?? n} ${n === 1 ? one : many}`;
}

/** "a, b and c". */
export function list(parts: string[]): string {
	if (parts.length <= 1) return parts[0] ?? '';
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/** "Overdue · 8 days", the label of the exception badge. */
export function overdueLabel(days: number): string {
	return `Overdue · ${count(days, 'day')}`;
}

/** Initials for an avatar: "Coral Ridge Builders" becomes "CR". */
export function initials(name: string): string {
	const words = name.split(/\s+/).filter((word) => /^\p{L}/u.test(word));
	return (
		words
			.slice(0, 2)
			.map((word) => word[0])
			.join('')
			.toUpperCase() || '?'
	);
}

// ---------------------------------------------------------------------------
// Kinds of entry and milestone
// ---------------------------------------------------------------------------

export const MILESTONE_KIND_LABEL: Record<MilestoneKind, string> = {
	construction: 'Construction',
	goods_delivery: 'Goods delivery',
	funds_handover: 'Funds handover',
	service: 'Service'
};

/** What an entry is, as an eyebrow or a crumb: "Work log", "Milestone claim", "Confirmation". */
export function entryKind(
	item: 'log_work' | 'milestone_hit',
	claim: MilestoneClaim | null
): string {
	if (item === 'log_work') return 'Work log';
	return claim === 'confirm' ? 'Confirmation' : 'Milestone claim';
}

/** The filer's own word for a claim: "Reported as delivered". Never Tejido's judgement. */
export const CLAIM_REPORTED: Record<Exclude<MilestoneClaim, 'confirm'>, string> = {
	completed: 'Reported as completed',
	delivered: 'Reported as delivered',
	funds_spent: 'Reported as funds spent'
};

export const WORK_STATUS_REPORTED: Record<WorkLogStatus, string> = {
	on_track: 'Reported on track',
	delayed: 'Reported as delayed',
	blocked: 'Reported as blocked'
};

/** The first sentence of what the filer wrote, as a page title. */
export function headline(summary: string): string {
	const first = summary.split(/(?<=[.!?])\s/)[0] ?? summary;
	const trimmed = first.replace(/[.!?]$/, '');
	return trimmed.length > 90 ? `${trimmed.slice(0, 88).trimEnd()}…` : trimmed;
}

// ---------------------------------------------------------------------------
// Milestone state, in the design system's vocabulary
// ---------------------------------------------------------------------------

export type MilestoneStatusKey = 'not-started' | 'in-progress' | 'claimed' | 'confirmed';

/** The status badge for a milestone. Overdue is never one of these: it is a second badge. */
export function milestoneStatus(state: MilestoneState, hasEntries: boolean): MilestoneStatusKey {
	if (state === 'confirmed_independent' || state === 'confirmed_creator') return 'confirmed';
	if (state === 'claimed') return 'claimed';
	return hasEntries ? 'in-progress' : 'not-started';
}

export const STRENGTH_SHORT: Record<PartyRelationship, string> = {
	participant: 'Participant',
	stakeholder: 'Stakeholder',
	independent: 'Independent'
};

/** One, two or three threads. A category marker, never a score. */
export const STRENGTH_THREADS: Record<PartyRelationship, 1 | 2 | 3> = {
	participant: 1,
	stakeholder: 2,
	independent: 3
};

// ---------------------------------------------------------------------------
// Deposits
// ---------------------------------------------------------------------------

export type DepositStateKey = 'dep-held' | 'dep-refunded' | 'dep-outstanding';

// ---------------------------------------------------------------------------
// The three questions, answered separately
// ---------------------------------------------------------------------------

export interface Answer {
	tone: Tone;
	icon: IconName;
	question: string;
	answer: string;
	detail: string;
}

const FILING_KEY: Record<EntryStatus, StateKey> = {
	verified: 'verified',
	filed: 'pending',
	flagged: 'flagged',
	incomplete: 'incomplete'
};

/** The filing-layer state for an entry status. `filed` is shown as "Receipt pending". */
export function filingKey(status: EntryStatus): StateKey {
	return FILING_KEY[status];
}

/** "1 photo, 1 document, 1 file left out", or `none` when nothing was attached. */
export function evidenceCount(
	files: { photos: number; documents: number; leftOut: number },
	none: string
): string {
	const parts = [
		files.photos > 0 ? count(files.photos, 'photo') : '',
		files.documents > 0 ? count(files.documents, 'document') : '',
		files.leftOut > 0 ? `${count(files.leftOut, 'file')} left out` : ''
	].filter(Boolean);
	return parts.length > 0 ? parts.join(', ') : none;
}

/** Question 3, the same on the proof page and the milestone page. */
export function confirmationAnswer(
	question: string,
	milestone: {
		position: number;
		status: MilestoneStatusKey;
		strength: PartyRelationship | null;
		confirmedAt: string | null;
		confirmedBy: string | null;
		confirmer: { name: string; title: string } | null;
	},
	today: string
): Answer {
	const named = milestone.confirmer
		? `${milestone.confirmer.name}, ${lowerFirst(milestone.confirmer.title)},`
		: 'The named confirmer';

	if (milestone.strength) {
		const who = milestone.confirmedBy ? ` by ${milestone.confirmedBy}` : '';
		const when = milestone.confirmedAt ? ` on ${day(milestone.confirmedAt, today)}` : '';
		return {
			tone: 'confirmed',
			icon: STATES[milestone.strength].icon,
			question,
			answer: `Yes · ${STATES[milestone.strength].label.toLowerCase()}`,
			detail: `Milestone ${milestone.position} was confirmed${who}${when}.`
		};
	}
	if (milestone.status === 'claimed') {
		return {
			tone: 'neutral',
			icon: 'ms-claimed',
			question,
			answer: 'Not yet',
			detail: `Work has been reported. Confirmation is still pending. ${named} is named to confirm it.`
		};
	}
	return {
		tone: milestone.status === 'in-progress' ? 'progress' : 'neutral',
		icon: STATES[milestone.status].icon,
		question,
		answer: 'Not yet',
		detail: `Milestone ${milestone.position} is ${
			milestone.status === 'in-progress' ? 'in progress' : 'not started'
		}. ${named} confirms it once it is claimed complete.`
	};
}

/** "Head teacher" becomes "head teacher"; an acronym such as "PTA chair" is left alone. */
export function lowerFirst(text: string): string {
	return /^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}
