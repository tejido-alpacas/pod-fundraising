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

/** How strongly a milestone is confirmed, in the words of the brief. */
export const MILESTONE_STATE_LABEL: Record<MilestoneState, string> = {
	open: 'Not yet claimed',
	claimed: 'Reported only',
	confirmed_independent: 'Confirmed independently',
	confirmed_creator: 'Confirmed by the creator'
};

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

export const PARTY_ROLE_LABEL: Record<PartyRole, string> = {
	third_party: 'does the work',
	confirmer: 'independent confirmer'
};

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
