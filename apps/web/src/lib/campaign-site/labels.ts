/**
 * The words donors read for each status, state and kind, and how dates are written.
 * Shared by every Campaign Site page so the timeline, the proof page and the milestone page
 * say the same thing in the same words.
 *
 * No server-only import here: pages use this in the browser too.
 */
import type {
	CampaignStatus,
	EntryStatus,
	MilestoneClaim,
	MilestoneState,
	PartyRelationship,
	PartyRole,
	WorkLogStatus
} from '@tejido/contracts';

/**
 * How far an entry can be trusted. `label` is the badge, `meaning` the one sentence under it.
 * Only `verified` is proven. `filed` and `incomplete` are a party's own report and nothing more.
 */
export const ENTRY_STATUS: Record<EntryStatus, { label: string; meaning: string }> = {
	verified: {
		label: 'Verified',
		meaning: 'The deposit paid with this entry came from the wallet registered for this party.'
	},
	filed: {
		label: 'Filed, not yet verified',
		meaning: 'Saved as reported. It has not yet been matched to the payment ledger.'
	},
	incomplete: {
		label: 'Incomplete',
		meaning: 'Saved as reported, but something this milestone requires is missing.'
	},
	flagged: {
		label: 'Flagged',
		meaning:
			'The deposit paid with this entry did not come from the wallet registered for this party.'
	}
};

/**
 * The three states of a deposit ("Deposit held", "Deposit refunded", "Refund outstanding") and
 * the sentence for each reason a refund is outstanding. The words are agreed in the contracts
 * so the App says the same; the server loads already send `label` with every deposit.
 */
export { DEPOSIT_STATE_LABEL, REFUND_OUTSTANDING_MEANING } from '@tejido/contracts';

/**
 * Where a milestone stands, from its state alone. A confirmed state says WHO signed, not how
 * strong the confirmation is: for that, use `milestoneLabel` or CONFIRMATION_STRENGTH_LABEL
 * with the `strength` the server load worked out.
 */
export const MILESTONE_STATE_LABEL: Record<MilestoneState, string> = {
	open: 'Not yet claimed',
	claimed: 'Reported only',
	confirmed_independent: 'Confirmed by the named confirmer',
	confirmed_creator: 'Confirmed by the creator'
};

/**
 * The strength of a confirmation: how the person who confirmed relates to the project. It
 * describes a relationship and is never a score. The value comes from `confirmationStrength`
 * in @tejido/contracts, which never answers `independent` unless that was recorded.
 */
export const CONFIRMATION_STRENGTH_LABEL: Record<PartyRelationship, string> = {
	participant: 'Participant confirmation',
	stakeholder: 'Stakeholder confirmation',
	independent: 'Independent confirmation'
};

/** One sentence under each strength. */
export const CONFIRMATION_STRENGTH_MEANS: Record<PartyRelationship, string> = {
	participant:
		'Confirmed by someone who does the work, is paid by the project, or runs it. The campaign’s creator counts as one.',
	stakeholder:
		'Confirmed by someone who benefits from the project or represents those who do. Also shown when the confirmer’s relationship to the project is not on record.',
	independent: 'Confirmed by someone recorded as having no stake in the project.'
};

/** The three strengths, in the order a legend lists them. */
export const CONFIRMATION_STRENGTHS = ['independent', 'stakeholder', 'participant'] as const;

/** The badge for a milestone: its confirmation strength once confirmed, its state until then. */
export function milestoneLabel(milestone: {
	state: MilestoneState;
	strength: PartyRelationship | null;
}): string {
	return milestone.strength
		? CONFIRMATION_STRENGTH_LABEL[milestone.strength]
		: MILESTONE_STATE_LABEL[milestone.state];
}

/** The sentence under a milestone's badge. */
export function milestoneMeaning(milestone: {
	state: MilestoneState;
	strength: PartyRelationship | null;
}): string {
	if (milestone.state === 'confirmed_creator') {
		return 'No confirmer answered in the waiting period, so the campaign’s creator signed it off. The creator runs the project.';
	}
	if (milestone.strength) {
		return `The named confirmer signed it off from their own wallet. ${CONFIRMATION_STRENGTH_MEANS[milestone.strength]}`;
	}
	return milestone.state === 'claimed'
		? 'The party doing the work says it is done. Nobody has confirmed it yet.'
		: 'Nobody has reported this milestone as done yet.';
}

/** "2 stakeholder confirmations and 1 participant confirmation", leaving out the zeros. */
export function strengthSummary(counts: Record<PartyRelationship, number>): string {
	const parts = CONFIRMATION_STRENGTHS.filter((strength) => counts[strength] > 0).map(
		(strength) => `${counts[strength]} ${strength} confirmation${counts[strength] === 1 ? '' : 's'}`
	);
	if (parts.length <= 1) return parts[0] ?? 'no confirmations';
	return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
	draft: 'Draft',
	funding: 'Fundraising',
	funded: 'Funded',
	reporting: 'Work under way',
	overdue: 'A report is overdue',
	delivered: 'Delivered'
};

/** What a party says happened when it claims a milestone. `confirm` is the confirmer's sign-off. */
export const CLAIM_LABEL: Record<MilestoneClaim, string> = {
	completed: 'completed',
	delivered: 'delivered',
	funds_spent: 'funds spent',
	confirm: 'confirmed'
};

export const WORK_STATUS_LABEL: Record<WorkLogStatus, string> = {
	on_track: 'On track',
	delayed: 'Delayed',
	blocked: 'Blocked'
};

/** What a party does on a campaign. It says nothing about independence: see `partyLabel`. */
export const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
	third_party: 'does the work',
	confirmer: 'confirmer'
};

/**
 * The words in brackets after a person's name. A confirmer is described by the relationship
 * the server load sends, which is `stakeholder` when none is recorded and never `independent`
 * unless recorded.
 */
export function partyLabel(party: { role: PartyRole; relationship: PartyRelationship }): string {
	return party.role === 'confirmer'
		? `${party.relationship} confirmer`
		: PARTY_ROLE_LABEL[party.role];
}

/** A moment, written the same for every donor wherever they are: "13 Nov 2026, 17:02 UTC". */
export function formatDateTime(timestamp: string): string {
	return new Date(timestamp).toLocaleString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'UTC',
		timeZoneName: 'short'
	});
}

/** A calendar date with no time, such as a due date: "27 Nov 2026". */
export function formatDate(date: string): string {
	return new Date(`${date}T00:00:00.000Z`).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		timeZone: 'UTC'
	});
}
