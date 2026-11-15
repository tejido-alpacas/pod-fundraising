import { z } from 'zod';

/**
 * The cadence: how often each third party owes a work log. This file is the one definition
 * of what a cadence means: which values exist, which days a work log is due, how a reporting
 * period is counted, and how the cadence is said in words. The scheduler, the App and the
 * Campaign Site all read it from here, so they cannot disagree.
 *
 * A cadence is one short piece of text, stored as it is:
 * - `weekly`: one work log every 7 days.
 * - `fortnightly`: one work log every 14 days.
 * - `daily`: one work log every day.
 * - `days:mon,thu`: one work log on each chosen day of the week. One to seven of `mon tue
 *   wed thu fri sat sun`, each once, in that order, separated by commas.
 *
 * Every date here is a calendar day in UTC, written `YYYY-MM-DD`, as everywhere else. So
 * "Monday" is Monday in UTC.
 *
 * Reporting periods. One work log is owed per period, by the period's last day.
 * - `weekly` and `fortnightly`: periods of 7 or 14 days, counted from the day the schedule
 *   started. The first period starts on that day.
 * - `daily`: every day is a period.
 * - Chosen days: every chosen day ends a period. A period starts the day after the chosen
 *   day before it; the first starts on the day the schedule started. So with Monday and
 *   Thursday chosen, a log is due each Monday (for Friday to Monday) and each Thursday (for
 *   Tuesday to Thursday).
 */

/** The days of the week, in the order they are written and said. */
export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export const weekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof weekdaySchema>;

/** The cadences that are a single word. */
export const FIXED_CADENCES = ['weekly', 'fortnightly', 'daily'] as const;
export type FixedCadence = (typeof FIXED_CADENCES)[number];

/** What starts a chosen-days cadence: `days:mon,thu`. */
export const DAYS_CADENCE_PREFIX = 'days:';
export type DaysCadence = `${typeof DAYS_CADENCE_PREFIX}${string}`;

/** The cadence written for these days: sorted Monday to Sunday, each once. */
export function daysCadence(days: readonly Weekday[]): DaysCadence {
	return `${DAYS_CADENCE_PREFIX}${WEEKDAYS.filter((day) => days.includes(day)).join(',')}`;
}

/**
 * The days named in `days:…` text, in the order written, or null when any of them is not a
 * day of the week (or none is given). `days:tue,mon` reads as Tuesday and Monday: it names
 * days, but it is not how a cadence is written until `daysCadence` has put them in order.
 */
export function daysNamedIn(text: string): Weekday[] | null {
	if (!text.startsWith(DAYS_CADENCE_PREFIX)) return null;
	const days: Weekday[] = [];
	for (const part of text.slice(DAYS_CADENCE_PREFIX.length).split(',')) {
		const day = weekdaySchema.safeParse(part);
		if (!day.success) return null;
		days.push(day.data);
	}
	return days;
}

function isDaysCadence(text: string): boolean {
	const days = daysNamedIn(text);
	return days !== null && daysCadence(days) === text;
}

const daysCadenceSchema = z.custom<DaysCadence>(
	(value) => typeof value === 'string' && isDaysCadence(value),
	'Expected chosen days of the week, written like "days:mon,thu"'
);

/** How often each third party owes a work log. See the top of this file. */
export const cadenceSchema = z.union([z.enum(FIXED_CADENCES), daysCadenceSchema]);
export type Cadence = z.infer<typeof cadenceSchema>;

/** A cadence taken apart: either one of the single words, or the chosen days. */
export type CadenceRule = { kind: FixedCadence } | { kind: 'days'; days: readonly Weekday[] };

/**
 * Reads a cadence. It throws on text that is not a cadence, rather than treating it as some
 * other cadence: a campaign's schedule is never guessed.
 */
export function cadenceRule(cadence: Cadence): CadenceRule {
	if (cadence === 'weekly' || cadence === 'fortnightly' || cadence === 'daily') {
		return { kind: cadence };
	}
	const days = daysNamedIn(cadence);
	if (days === null || daysCadence(days) !== cadence) throw new Error('Not a cadence');
	return { kind: 'days', days };
}

// ---------------------------------------------------------------------------
// In words
// ---------------------------------------------------------------------------

const WEEKDAY_NAME: Record<Weekday, string> = {
	mon: 'Monday',
	tue: 'Tuesday',
	wed: 'Wednesday',
	thu: 'Thursday',
	fri: 'Friday',
	sat: 'Saturday',
	sun: 'Sunday'
};

/** A day of the week by name: "Monday". */
export function weekdayName(day: Weekday): string {
	return WEEKDAY_NAME[day];
}

/**
 * The cadence as the end of a sentence: "every week", "every two weeks", "every day",
 * "every Monday", "every Monday and Tuesday", "every Monday, Thursday and Saturday". All
 * seven days chosen reads "every day".
 */
export function cadencePhrase(cadence: Cadence): string {
	const rule = cadenceRule(cadence);
	switch (rule.kind) {
		case 'weekly':
			return 'every week';
		case 'fortnightly':
			return 'every two weeks';
		case 'daily':
			return 'every day';
		case 'days': {
			if (rule.days.length === WEEKDAYS.length) return 'every day';
			const names = rule.days.map(weekdayName);
			if (names.length === 1) return `every ${names.join('')}`;
			return `every ${names.slice(0, -1).join(', ')} and ${names.slice(-1).join('')}`;
		}
	}
}

/** The same, to stand alone or start a sentence: "Every day", "Every Monday and Tuesday". */
export function cadenceLabel(cadence: Cadence): string {
	const phrase = cadencePhrase(cadence);
	return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

// ---------------------------------------------------------------------------
// Reporting periods
// ---------------------------------------------------------------------------

/** A calendar day in UTC, `YYYY-MM-DD`. */
type UtcDay = string;

const DAY_MS = 86_400_000;

function dayNumber(day: UtcDay): number {
	return Math.round(Date.parse(`${day}T00:00:00.000Z`) / DAY_MS);
}

function dayAfter(day: UtcDay, days: number): UtcDay {
	return new Date((dayNumber(day) + days) * DAY_MS).toISOString().slice(0, 10);
}

/** The day of the week of a UTC calendar day: `2026-11-16` is `mon`. */
export function weekdayOf(day: UtcDay): Weekday {
	// Day 0, 1 January 1970, was a Thursday.
	const weekday = WEEKDAYS[(((dayNumber(day) + 3) % 7) + 7) % 7];
	if (weekday === undefined) throw new Error('Not a calendar day');
	return weekday;
}

/** One reporting period. Both days belong to it. */
export interface CadencePeriod {
	/** 1 for the first period of the schedule. */
	number: number;
	start: UtcDay;
	/** The day the work log is due: the last day a work log for this period is on time. */
	end: UtcDay;
}

/** How a cadence's periods are laid out: all one length, or ending on chosen days. */
type PeriodShape = { length: number } | { days: readonly Weekday[] };

function periodShape(cadence: Cadence): PeriodShape {
	const rule = cadenceRule(cadence);
	switch (rule.kind) {
		case 'weekly':
			return { length: 7 };
		case 'fortnightly':
			return { length: 14 };
		case 'daily':
			return { length: 1 };
		case 'days':
			return { days: rule.days };
	}
}

/**
 * For chosen days: how many days after the schedule's first day each work log of the first
 * seven days falls due, in order. The pattern repeats every seven days.
 */
function dueOffsets(days: readonly Weekday[], startedOn: UtcDay): number[] {
	const first = WEEKDAYS.indexOf(weekdayOf(startedOn));
	return days.map((day) => (WEEKDAYS.indexOf(day) - first + 7) % 7).sort((a, b) => a - b);
}

/** Period `number` (from 1) of a schedule that started on `startedOn`. */
export function cadencePeriod(cadence: Cadence, startedOn: UtcDay, number: number): CadencePeriod {
	const shape = periodShape(cadence);
	if ('length' in shape) {
		const start = dayAfter(startedOn, (number - 1) * shape.length);
		return { number, start, end: dayAfter(start, shape.length - 1) };
	}
	const offsets = dueOffsets(shape.days, startedOn);
	/** Days from the start to the day work log `n` (from 1) is due. */
	const dueAfter = (n: number): number => {
		const offset = offsets[(n - 1) % offsets.length];
		if (offset === undefined) throw new Error('A cadence has at least one day');
		return offset + 7 * Math.floor((n - 1) / offsets.length);
	};
	return {
		number,
		start: number <= 1 ? startedOn : dayAfter(startedOn, dueAfter(number - 1) + 1),
		end: dayAfter(startedOn, dueAfter(number))
	};
}

/** The period `day` falls in, or null when the schedule had not started by then. */
export function cadencePeriodOn(
	cadence: Cadence,
	startedOn: UtcDay,
	day: UtcDay
): CadencePeriod | null {
	const elapsed = dayNumber(day) - dayNumber(startedOn);
	if (elapsed < 0) return null;
	const shape = periodShape(cadence);
	if ('length' in shape) {
		return cadencePeriod(cadence, startedOn, Math.floor(elapsed / shape.length) + 1);
	}
	const offsets = dueOffsets(shape.days, startedOn);
	// A period is numbered by how many work logs fell due before this day, plus one.
	const earlier =
		Math.floor(elapsed / 7) * offsets.length +
		offsets.filter((offset) => offset < elapsed % 7).length;
	return cadencePeriod(cadence, startedOn, earlier + 1);
}

/**
 * The longest a reporting period of this cadence lasts, in days: 7 for weekly, 14 for
 * fortnightly, 1 for daily, and for chosen days the longest wait from one chosen day to the
 * next (6 for Monday and Tuesday, 7 for a single day). The scheduler raises an open
 * milestone this many days before its due date.
 */
export function cadenceLongestPeriodDays(cadence: Cadence): number {
	const shape = periodShape(cadence);
	if ('length' in shape) return shape.length;
	const indexes = shape.days.map((day) => WEEKDAYS.indexOf(day));
	return Math.max(
		...indexes.map((index, at) => {
			const next = indexes[(at + 1) % indexes.length];
			if (next === undefined) throw new Error('A cadence has at least one day');
			return ((next - index + 6) % 7) + 1;
		})
	);
}
