/**
 * Tejido's trust vocabulary: five layers, each state with a tone, an icon shape, a label and a
 * sentence. Components read from here; nothing else decides how a state looks or reads.
 */
import type { Entry, Milestone, Party, Deposit } from '@tejido/contracts';
import { isConfirmed } from '@tejido/contracts';
import type { IconName } from './icons.ts';

export type Tone = 'neutral' | 'record' | 'progress' | 'confirmed' | 'attention' | 'critical';
export type Layer = 'Filing' | 'Milestone' | 'Confirmation' | 'Evidence' | 'Deposit';

export interface StateDef {
	layer: Layer;
	tone: Tone;
	icon: IconName;
	label: string;
	text: string;
	/** Only a confirmed milestone is drawn solid. */
	solid?: boolean;
	/** Claimed complete is always dashed, never filled. */
	dashed?: boolean;
	/** Confirmation strength: 1 participant, 2 stakeholder, 3 independent. A category, not a score. */
	threads?: 1 | 2 | 3;
}

export const STATES = {
	// A. Filing and receipt
	verified: {
		layer: 'Filing',
		tone: 'record',
		icon: 'receipt-check',
		label: 'Receipt verified',
		text: 'Recorded and matched to its public receipt, paid from the registered wallet. This shows the filing happened. It does not prove the work.'
	},
	pending: {
		layer: 'Filing',
		tone: 'neutral',
		icon: 'receipt-clock',
		label: 'Receipt pending',
		text: 'Filed with Tejido. We haven’t matched it to its public receipt yet.'
	},
	flagged: {
		layer: 'Filing',
		tone: 'critical',
		icon: 'receipt-flag',
		label: 'Flagged',
		text: 'This filing was recorded, but the payment came from a different wallet.'
	},
	incomplete: {
		layer: 'Filing',
		tone: 'attention',
		icon: 'receipt-missing',
		label: 'Incomplete',
		text: 'Saved, but something this milestone needs is missing.'
	},
	// B. Milestone
	'not-started': {
		layer: 'Milestone',
		tone: 'neutral',
		icon: 'ms-not-started',
		label: 'Not started',
		text: 'No work has been reported yet.'
	},
	'in-progress': {
		layer: 'Milestone',
		tone: 'progress',
		icon: 'ms-in-progress',
		label: 'In progress',
		text: 'Work is being reported. Nobody has claimed it complete.'
	},
	claimed: {
		layer: 'Milestone',
		tone: 'neutral',
		icon: 'ms-claimed',
		label: 'Claimed complete',
		dashed: true,
		text: 'Work has been reported. Confirmation is still pending.'
	},
	confirmed: {
		layer: 'Milestone',
		tone: 'confirmed',
		icon: 'ms-confirmed',
		label: 'Confirmed',
		solid: true,
		text: 'An authorized reviewer has confirmed the milestone.'
	},
	overdue: {
		layer: 'Milestone',
		tone: 'critical',
		icon: 'ms-overdue',
		label: 'Overdue',
		text: 'The due date has passed and the milestone is not confirmed.'
	},
	// C. Confirmation strength
	participant: {
		layer: 'Confirmation',
		tone: 'neutral',
		icon: 'conf-participant',
		threads: 1,
		label: 'Participant confirmation',
		text: 'Confirmed by someone involved in the work or paid by the project, such as the organizer.'
	},
	stakeholder: {
		layer: 'Confirmation',
		tone: 'neutral',
		icon: 'conf-stakeholder',
		threads: 2,
		label: 'Stakeholder confirmation',
		text: 'Confirmed by the beneficiary or a local stakeholder. Not paid by the project, but not neutral.'
	},
	independent: {
		layer: 'Confirmation',
		tone: 'neutral',
		icon: 'conf-independent',
		threads: 3,
		label: 'Independent confirmation',
		text: 'Confirmed by a third party with no stake in the project.'
	},
	// D. Evidence
	'ev-photo': {
		layer: 'Evidence',
		tone: 'neutral',
		icon: 'image',
		label: 'Photo',
		text: 'Available to view. Its fingerprint is on the receipt.'
	},
	'ev-document': {
		layer: 'Evidence',
		tone: 'neutral',
		icon: 'file-text',
		label: 'Document',
		text: 'Available to open. Its fingerprint is on the receipt.'
	},
	'ev-uploading': {
		layer: 'Evidence',
		tone: 'progress',
		icon: 'upload',
		label: 'Uploading',
		text: 'Sending to Tejido. Keep this screen open.'
	},
	'ev-failed': {
		layer: 'Evidence',
		tone: 'attention',
		icon: 'alert-triangle',
		label: 'Upload failed',
		text: 'Not sent. The file is still on this phone.'
	},
	'ev-queued': {
		layer: 'Evidence',
		tone: 'neutral',
		icon: 'device',
		label: 'Waiting to sync',
		text: 'Saved on this phone. It will upload when you’re back online.'
	},
	'ev-excluded': {
		layer: 'Evidence',
		tone: 'neutral',
		icon: 'excluded',
		label: 'Left out',
		text: 'Not counted as evidence because we couldn’t verify it belongs to this project.'
	},
	'ev-private': {
		layer: 'Evidence',
		tone: 'neutral',
		icon: 'eye-off',
		label: 'Not public',
		text: 'Seen by the reviewer, kept off the public page.'
	},
	// E. Filing deposit
	'dep-held': {
		layer: 'Deposit',
		tone: 'neutral',
		icon: 'deposit',
		label: 'Deposit held',
		text: 'Paid by the filer. Returned when the milestone is confirmed.'
	},
	'dep-refunded': {
		layer: 'Deposit',
		tone: 'confirmed',
		icon: 'return',
		label: 'Deposit refunded',
		text: 'Returned to the filer’s wallet. Donations are not affected.'
	},
	'dep-outstanding': {
		layer: 'Deposit',
		tone: 'attention',
		icon: 'clock',
		label: 'Refund outstanding',
		text: 'The milestone is confirmed but this refund hasn’t arrived yet.'
	}
} as const satisfies Record<string, StateDef>;

export type StateKey = keyof typeof STATES;

// ---------------------------------------------------------------------------
// From the contracts to the vocabulary
// ---------------------------------------------------------------------------

/** entryStatusSchema → filing state. `filed` is shown as "Receipt pending". */
export function filingState(entry: Pick<Entry, 'status'>): StateKey {
	return entry.status === 'filed' ? 'pending' : entry.status;
}

/** milestoneStateSchema (+ whether any work has been logged) → milestone state. */
export function milestoneState(
	milestone: Pick<Milestone, 'state'>,
	hasEntries: boolean
): 'not-started' | 'in-progress' | 'claimed' | 'confirmed' {
	if (isConfirmed(milestone)) return 'confirmed';
	if (milestone.state === 'claimed') return 'claimed';
	return hasEntries ? 'in-progress' : 'not-started';
}

/** Overdue is an exception shown beside the status, never instead of it. Dates are ISO `YYYY-MM-DD`. */
export function daysOverdue(
	milestone: Pick<Milestone, 'state' | 'dueDate'>,
	today: string
): number {
	if (isConfirmed(milestone)) return 0;
	const late = (Date.parse(today) - Date.parse(milestone.dueDate)) / 86_400_000;
	return late > 0 ? Math.floor(late) : 0;
}

/**
 * Confirmation strength comes from the confirmer's relationship to the project, recorded in the
 * campaign builder. Proposed addition to `partySchema`: `relationship: 'participant' |
 * 'stakeholder' | 'independent'`. A creator sign-off (`confirmed_creator`) is always a participant.
 */
export type Relationship = 'participant' | 'stakeholder' | 'independent';
export function confirmationStrength(
	milestone: Pick<Milestone, 'state'>,
	confirmer: (Pick<Party, 'id'> & { relationship?: Relationship }) | undefined
): Relationship | null {
	if (milestone.state === 'confirmed_creator') return 'participant';
	if (milestone.state !== 'confirmed_independent') return null;
	return confirmer?.relationship ?? 'stakeholder'; // unknown is never assumed independent
}

/** depositSchema → deposit state. A refund is outstanding when its milestone is confirmed but the transfer hasn't settled. */
export function depositState(
	deposit: Pick<Deposit, 'refundedAt'>,
	milestoneConfirmed: boolean
): StateKey {
	if (deposit.refundedAt !== null) return 'dep-refunded';
	return milestoneConfirmed ? 'dep-outstanding' : 'dep-held';
}

/** Shortens an identifier for display: first 8 and last 6 characters. Always pair with a copy button and the full value. */
export function shortId(value: string): string {
	return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}
