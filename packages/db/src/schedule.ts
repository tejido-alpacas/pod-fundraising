/**
 * What is due, from whom, and what is overdue: the one definition the cadence scheduler uses.
 *
 * Plain functions. Nothing here reads the database or the clock: the caller passes the
 * campaign's records and "now". Track C owns this file.
 *
 * Every date here is a calendar day in UTC, written `YYYY-MM-DD`, the way milestone due dates
 * are stored. "Today" is the UTC day of `now`, so a day begins and ends at midnight UTC
 * whatever the time zone of the server or the reader. Something due on a day is on time for
 * the whole of that day and overdue from the next one.
 *
 * Milestones (any campaign that is not a draft)
 * - A confirmed milestone asks nothing of anyone.
 * - An `open` milestone is owed by the party doing the work, who must claim it. It falls due
 *   one reporting period before its due date (the cadence's longest: 7 days for weekly, 14
 *   for fortnightly, 1 for daily, and for chosen days the longest wait between two of them),
 *   and is overdue from the day after its due date.
 * - A `claimed` milestone is owed by its confirmer, who must confirm it. It is due from the
 *   moment it is claimed, and overdue from the day after the milestone's due date.
 * - Days overdue are counted exactly as the pages count them (`daysOverdue` in @tejido/ui):
 *   whole days past the due date.
 *
 * Work logs (only while work is under way: status `reporting` or `overdue`)
 * - Owed by each party with at least one `open` milestone of a kind whose work logs run on
 *   the cadence: construction and service. Once every such milestone of theirs is claimed or
 *   confirmed, they owe no more work logs, late ones included.
 * - One work log per party per period. What a period is for each cadence (weekly,
 *   fortnightly, daily, chosen days of the week) is defined once, in the contracts
 *   (`cadence.ts`). Periods are counted from the day the work-log schedule started for the
 *   campaign, which the caller passes. With no start day, no work log is due.
 * - A work log fills the earliest period still open at the time it was filed. So a late log
 *   settles the missed period, and the current period is still owed.
 * - The current period's log is due by the period's last day. A period that ended unfilled
 *   is overdue, by the whole days since its last day.
 */
import {
	cadenceLongestPeriodDays,
	cadencePeriod,
	cadencePeriodOn,
	isConfirmed,
	type Cadence,
	type CadencePeriod,
	type Campaign,
	type EntryItem,
	type Milestone
} from '@tejido/contracts';

/** A calendar day in UTC, `YYYY-MM-DD`. */
export type UtcDay = string;

const DAY_MS = 86_400_000;

/** The UTC calendar day of a moment: `2026-11-14T23:59:59.999Z` is `2026-11-14`. */
export function utcDay(at: Date | string): UtcDay {
	return new Date(at).toISOString().slice(0, 10);
}

function dayNumber(day: UtcDay): number {
	return Math.round(Date.parse(`${day}T00:00:00.000Z`) / DAY_MS);
}

/** The day `days` after `day` (before it, when negative). */
export function addDays(day: UtcDay, days: number): UtcDay {
	return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export function daysBetween(from: UtcDay, to: UtcDay): number {
	return dayNumber(to) - dayNumber(from);
}

/** One reporting period. Both days belong to it; a work log is on time until `end`. */
export type WorkLogPeriod = CadencePeriod;

/** Period `number` (from 1) of a schedule that started on `startedOn`. */
export function workLogPeriod(cadence: Cadence, startedOn: UtcDay, number: number): WorkLogPeriod {
	return cadencePeriod(cadence, startedOn, number);
}

/** The period `day` falls in, or null when the schedule had not started by then. */
export function workLogPeriodOn(
	cadence: Cadence,
	startedOn: UtcDay,
	day: UtcDay
): WorkLogPeriod | null {
	return cadencePeriodOn(cadence, startedOn, day);
}

/** Whether something can still be done on time (`due`) or its day has passed (`overdue`). */
export type DueKind = 'due' | 'overdue';

interface DueBase {
	/** The party responsible. */
	partyId: string;
	kind: DueKind;
	/** The last day it is on time. */
	dueDate: UtcDay;
	/** Whole days past `dueDate`. 0 while it is `due`. */
	overdueDays: number;
}

export interface WorkLogDue extends DueBase {
	what: 'work_log';
	period: WorkLogPeriod;
}

export interface MilestoneDue extends DueBase {
	what: 'milestone';
	milestoneId: string;
	/** `claim`: the party doing the work says it is done. `confirm`: its confirmer signs it off. */
	action: 'claim' | 'confirm';
}

export type DueItem = WorkLogDue | MilestoneDue;

/** The milestone kinds whose work logs run on the cadence. For the others they are optional. */
const WORK_LOG_KINDS: ReadonlySet<Milestone['kind']> = new Set(['construction', 'service']);

/** The campaign statuses in which work is under way, so work logs are owed. */
const WORK_UNDER_WAY: ReadonlySet<Campaign['status']> = new Set(['reporting', 'overdue']);

export interface ScheduleInput {
	campaign: Pick<Campaign, 'status' | 'cadence'>;
	milestones: readonly Pick<
		Milestone,
		'id' | 'kind' | 'ownerPartyId' | 'confirmerPartyId' | 'dueDate' | 'state'
	>[];
	/** Every entry of the campaign. Only who filed it, which item it is and when are read. */
	entries: readonly { partyId: string; item: EntryItem; filedAt: string }[];
	/** The first day of the campaign's first work-log period, or null when it has not started. */
	workLogsStartedOn: UtcDay | null;
	now: Date;
}

/**
 * Everything due or overdue on one campaign at `now`. Milestones first, in the order given,
 * then work logs by party and period. A draft campaign answers nothing.
 */
export function whatIsDue(input: ScheduleInput): DueItem[] {
	const { campaign, milestones } = input;
	if (campaign.status === 'draft') return [];
	const today = utcDay(input.now);

	const due: DueItem[] = [];
	for (const milestone of milestones) {
		const item = milestoneDue(milestone, campaign.cadence, today);
		if (item) due.push(item);
	}
	due.push(...workLogsDue(input, today));
	return due;
}

function milestoneDue(
	milestone: ScheduleInput['milestones'][number],
	cadence: Cadence,
	today: UtcDay
): MilestoneDue | null {
	if (isConfirmed(milestone)) return null;
	const late = daysBetween(milestone.dueDate, today);
	const claimed = milestone.state === 'claimed';
	// An open milestone is not raised until one reporting period before its date.
	if (!claimed && late < -cadenceLongestPeriodDays(cadence)) return null;
	return {
		what: 'milestone',
		milestoneId: milestone.id,
		partyId: claimed ? milestone.confirmerPartyId : milestone.ownerPartyId,
		action: claimed ? 'confirm' : 'claim',
		kind: late > 0 ? 'overdue' : 'due',
		dueDate: milestone.dueDate,
		overdueDays: late > 0 ? late : 0
	};
}

function workLogsDue(input: ScheduleInput, today: UtcDay): WorkLogDue[] {
	const { campaign, milestones, entries, workLogsStartedOn: startedOn } = input;
	if (!WORK_UNDER_WAY.has(campaign.status) || startedOn === null) return [];
	const current = workLogPeriodOn(campaign.cadence, startedOn, today);
	if (!current) return [];

	const owing = new Set(
		milestones
			.filter((milestone) => milestone.state === 'open' && WORK_LOG_KINDS.has(milestone.kind))
			.map((milestone) => milestone.ownerPartyId)
	);

	const due: WorkLogDue[] = [];
	for (const partyId of owing) {
		// The period each of this party's work logs was filed in, oldest first. A log dated
		// after "now" (a clock that disagrees) counts as filed in the current period.
		const filedIn = entries
			.filter((entry) => entry.partyId === partyId && entry.item === 'log_work')
			.map((entry) => workLogPeriodOn(campaign.cadence, startedOn, utcDay(entry.filedAt))?.number)
			.filter((number) => number !== undefined)
			.map((number) => Math.min(number, current.number))
			.sort((a, b) => a - b);

		// Each log fills the earliest period still open when it was filed.
		const filled = new Set<number>();
		for (const number of filedIn) {
			for (let slot = 1; slot <= number; slot++) {
				if (!filled.has(slot)) {
					filled.add(slot);
					break;
				}
			}
		}

		for (let number = 1; number <= current.number; number++) {
			if (filled.has(number)) continue;
			const period = workLogPeriod(campaign.cadence, startedOn, number);
			const late = daysBetween(period.end, today);
			due.push({
				what: 'work_log',
				partyId,
				period,
				kind: late > 0 ? 'overdue' : 'due',
				dueDate: period.end,
				overdueDays: late > 0 ? late : 0
			});
		}
	}
	return due;
}
