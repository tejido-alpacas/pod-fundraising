/**
 * Where each milestone of a campaign stands, for the delivery track and the milestone rows.
 *
 * Delivery is counted in milestones and never as a percentage. A milestone's status comes from
 * its stored state and whether any work has been reported on it; "overdue" is worked out from
 * its due date and is an exception shown beside the status, never a status of its own.
 */
import { isConfirmed, type Entry, type Milestone } from '@tejido/contracts';
import { daysOverdue, milestoneState } from '@tejido/ui/states';

export type MilestoneStatus = ReturnType<typeof milestoneState>;

export interface MilestoneStanding {
	id: string;
	position: number;
	title: string;
	status: MilestoneStatus;
	/** Whole days past the due date. 0 when it is not late, and always 0 once confirmed. */
	overdueDays: number;
}

/** Today as a calendar date in UTC, the way due dates are stored: `2026-11-14`. */
export function todayUtc(now: Date = new Date()): string {
	return now.toISOString().slice(0, 10);
}

/**
 * @param entries every entry of the campaign. Only which milestones they are on is read.
 * @param today a calendar date, `YYYY-MM-DD`.
 */
export function milestoneStandings(
	milestones: readonly Milestone[],
	entries: readonly Pick<Entry, 'milestoneId'>[],
	today: string
): MilestoneStanding[] {
	const reportedOn = new Set(entries.map((entry) => entry.milestoneId));
	return milestones.map((milestone) => ({
		id: milestone.id,
		position: milestone.position,
		title: milestone.title,
		status: milestoneState(milestone, reportedOn.has(milestone.id)),
		overdueDays: daysOverdue(milestone, today)
	}));
}

export function confirmedCount(milestones: readonly Pick<Milestone, 'state'>[]): number {
	return milestones.filter(isConfirmed).length;
}
