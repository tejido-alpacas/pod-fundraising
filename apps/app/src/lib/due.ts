/**
 * What is due from one party: the single definition the home page, the reminder page and the
 * reminder message share. Track B owns this file.
 *
 * Safe in the browser: no server-only import.
 */
import { isConfirmed, type Milestone } from '@tejido/contracts';
import { daysOverdue, milestoneState } from '@tejido/ui';

/**
 * What one milestone asks of the person looking at it.
 * - `claim`: they owe it and have not said it is done.
 * - `confirm`: it has been claimed and they are the one named to sign it off.
 * - `waiting`: someone else acts next (the confirmer, or the party doing the work).
 * - `done`: confirmed.
 */
export type Step = 'claim' | 'confirm' | 'waiting' | 'done';

export function stepFor(milestone: Milestone, partyId: string): Step {
	if (isConfirmed(milestone)) return 'done';
	const owes = milestone.ownerPartyId === partyId;
	if (milestone.state === 'open') return owes ? 'claim' : 'waiting';
	return owes ? 'waiting' : 'confirm';
}

/** True when the next move on a milestone is this person's own. */
export function needsYou(step: Step): boolean {
	return step === 'claim' || step === 'confirm';
}

/** One of a party's milestones, as their own pages show it. Nothing private is on it. */
export interface PartyMilestone {
	id: string;
	position: number;
	title: string;
	dueDate: string;
	part: 'owes' | 'confirms';
	step: Step;
	/** The milestone's own state, in the words donors are shown. */
	status: ReturnType<typeof milestoneState>;
	/** Whole days past its date without being confirmed. 0 when it is not late. */
	overdueDays: number;
	/** Past its date and still theirs to claim. */
	overdue: boolean;
}

/**
 * The milestones a party owes or confirms, soonest first. Other parties' milestones are left
 * out. `reportedOn` holds the ids of the milestones something has been filed on; `today` is
 * `YYYY-MM-DD`.
 */
export function partyMilestones(
	milestones: Milestone[],
	partyId: string,
	reportedOn: ReadonlySet<string>,
	today: string
): PartyMilestone[] {
	return milestones
		.filter(
			(milestone) => milestone.ownerPartyId === partyId || milestone.confirmerPartyId === partyId
		)
		.map((milestone) => {
			const step = stepFor(milestone, partyId);
			return {
				id: milestone.id,
				position: milestone.position,
				title: milestone.title,
				dueDate: milestone.dueDate,
				part: milestone.ownerPartyId === partyId ? ('owes' as const) : ('confirms' as const),
				step,
				status: milestoneState(milestone, reportedOn.has(milestone.id)),
				overdueDays: daysOverdue(milestone, today),
				overdue: step === 'claim' && milestone.dueDate < today
			};
		})
		.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
