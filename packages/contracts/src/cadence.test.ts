// What a cadence is: which values exist, how they are said, and which days a work log is due.
// Plain functions: no clock, no network.
import { describe, expect, it } from 'vitest';
import {
	cadenceLabel,
	cadenceLongestPeriodDays,
	cadencePeriod,
	cadencePeriodOn,
	cadencePhrase,
	cadenceRule,
	cadenceSchema,
	daysCadence,
	daysNamedIn,
	weekdayOf,
	type Cadence
} from './cadence.ts';

// 9 November 2026 is a Monday.
const MONDAY = '2026-11-09';

/** Every way a cadence can be written, for the rules that hold for all of them. */
const EVERY_SHAPE: Cadence[] = [
	'weekly',
	'fortnightly',
	'daily',
	'days:mon',
	'days:mon,tue',
	'days:mon,thu,sat',
	'days:sat,sun',
	'days:mon,tue,wed,thu,fri,sat,sun'
];

describe('which values are cadences', () => {
	it('keeps the two values that existed before, unchanged', () => {
		expect(cadenceSchema.parse('weekly')).toBe('weekly');
		expect(cadenceSchema.parse('fortnightly')).toBe('fortnightly');
	});

	it('takes daily, and one to seven chosen days of the week', () => {
		for (const cadence of EVERY_SHAPE) expect(cadenceSchema.parse(cadence)).toBe(cadence);
	});

	it('refuses everything else, and never reads it as some other cadence', () => {
		for (const not of [
			'',
			'monthly',
			'Weekly',
			'days:',
			'days',
			'days:monday',
			'days:mon,',
			'days:,mon',
			'days:mon, tue',
			'days:tue,mon',
			'days:mon,mon',
			'days:MON',
			'days:mon,tue,wed,thu,fri,sat,sun,mon',
			7,
			null,
			['mon']
		]) {
			expect(cadenceSchema.safeParse(not).success, JSON.stringify(not)).toBe(false);
		}
		expect(() => cadenceRule('days:tue,mon')).toThrow();
		expect(() => cadenceRule('days:')).toThrow();
	});

	it('writes chosen days Monday to Sunday, each once, whatever order they come in', () => {
		expect(daysCadence(['thu', 'mon', 'thu'])).toBe('days:mon,thu');
		expect(daysNamedIn('days:thu,mon')).toEqual(['thu', 'mon']);
		expect(daysNamedIn('days:mon,funday')).toBeNull();
		expect(daysNamedIn('days:')).toBeNull();
		expect(daysNamedIn('weekly')).toBeNull();
	});

	it('takes a cadence apart', () => {
		expect(cadenceRule('daily')).toEqual({ kind: 'daily' });
		expect(cadenceRule('days:mon,thu')).toEqual({ kind: 'days', days: ['mon', 'thu'] });
	});
});

describe('a cadence in words', () => {
	it('says each one the way a person would', () => {
		expect(cadencePhrase('weekly')).toBe('every week');
		expect(cadencePhrase('fortnightly')).toBe('every two weeks');
		expect(cadencePhrase('daily')).toBe('every day');
		expect(cadencePhrase('days:mon')).toBe('every Monday');
		expect(cadencePhrase('days:mon,tue')).toBe('every Monday and Tuesday');
		expect(cadencePhrase('days:mon,tue,thu,sat')).toBe(
			'every Monday, Tuesday, Thursday and Saturday'
		);
		expect(cadencePhrase('days:mon,tue,wed,thu,fri,sat,sun')).toBe('every day');
	});

	it('starts a sentence with a capital', () => {
		expect(cadenceLabel('daily')).toBe('Every day');
		expect(cadenceLabel('days:mon,tue')).toBe('Every Monday and Tuesday');
	});

	it('has words for every shape', () => {
		for (const cadence of EVERY_SHAPE) expect(cadencePhrase(cadence)).toMatch(/^every \S/);
	});
});

describe('days of the week are UTC calendar days', () => {
	it('names the day of a date', () => {
		expect(weekdayOf('1970-01-01')).toBe('thu');
		expect(weekdayOf('2026-11-09')).toBe('mon');
		expect(weekdayOf('2026-11-15')).toBe('sun');
		expect(weekdayOf('2024-02-29')).toBe('thu');
		expect(weekdayOf('1969-12-31')).toBe('wed');
	});
});

describe('reporting periods', () => {
	it('weekly and fortnightly are counted exactly as before', () => {
		expect(cadencePeriod('weekly', MONDAY, 2)).toEqual({
			number: 2,
			start: '2026-11-16',
			end: '2026-11-22'
		});
		expect(cadencePeriod('fortnightly', MONDAY, 1)).toEqual({
			number: 1,
			start: '2026-11-09',
			end: '2026-11-22'
		});
		expect(cadencePeriodOn('weekly', MONDAY, '2026-11-15')?.number).toBe(1);
		expect(cadencePeriodOn('weekly', MONDAY, '2026-11-16')?.number).toBe(2);
		expect(cadencePeriodOn('fortnightly', MONDAY, '2026-11-23')?.number).toBe(2);
	});

	it('daily: every day is its own period, due that day', () => {
		expect(cadencePeriod('daily', MONDAY, 1)).toEqual({ number: 1, start: MONDAY, end: MONDAY });
		expect(cadencePeriod('daily', MONDAY, 3)).toEqual({
			number: 3,
			start: '2026-11-11',
			end: '2026-11-11'
		});
		expect(cadencePeriodOn('daily', MONDAY, '2026-11-11')?.number).toBe(3);
		// Across a month end.
		expect(cadencePeriodOn('daily', '2026-11-29', '2026-12-01')).toEqual({
			number: 3,
			start: '2026-12-01',
			end: '2026-12-01'
		});
	});

	it('chosen days: a work log is due on each chosen day, for the days since the last one', () => {
		// Monday and Thursday, started on a Monday: due Mon 9, Thu 12, Mon 16, Thu 19.
		const cadence = 'days:mon,thu';
		expect(cadencePeriod(cadence, MONDAY, 1)).toEqual({ number: 1, start: MONDAY, end: MONDAY });
		expect(cadencePeriod(cadence, MONDAY, 2)).toEqual({
			number: 2,
			start: '2026-11-10',
			end: '2026-11-12'
		});
		expect(cadencePeriod(cadence, MONDAY, 3)).toEqual({
			number: 3,
			start: '2026-11-13',
			end: '2026-11-16'
		});
		expect(cadencePeriod(cadence, MONDAY, 4).end).toBe('2026-11-19');
	});

	it('chosen days: started between two of them, the first period runs to the next chosen day', () => {
		// Monday and Thursday, started on Wednesday 11: due Thu 12, Mon 16, Thu 19.
		const cadence = 'days:mon,thu';
		expect(cadencePeriod(cadence, '2026-11-11', 1)).toEqual({
			number: 1,
			start: '2026-11-11',
			end: '2026-11-12'
		});
		expect(cadencePeriod(cadence, '2026-11-11', 2)).toEqual({
			number: 2,
			start: '2026-11-13',
			end: '2026-11-16'
		});
		expect(cadencePeriod(cadence, '2026-11-11', 3).end).toBe('2026-11-19');
	});

	it('chosen days: puts each day in the period that ends on the next chosen day', () => {
		const cadence = 'days:mon,thu';
		expect(cadencePeriodOn(cadence, MONDAY, '2026-11-08')).toBeNull();
		const numbers = [9, 10, 11, 12, 13, 14, 15, 16, 17].map(
			(day) => cadencePeriodOn(cadence, MONDAY, `2026-11-${String(day).padStart(2, '0')}`)?.number
		);
		//                       Mon Tue Wed Thu Fri Sat Sun Mon Tue
		expect(numbers).toEqual([1, 2, 2, 2, 3, 3, 3, 3, 4]);
	});

	it('one chosen day is a week, counted to that day', () => {
		// Fridays, started on a Monday: due Fri 13, Fri 20.
		expect(cadencePeriod('days:fri', MONDAY, 1)).toEqual({
			number: 1,
			start: MONDAY,
			end: '2026-11-13'
		});
		expect(cadencePeriod('days:fri', MONDAY, 2)).toEqual({
			number: 2,
			start: '2026-11-14',
			end: '2026-11-20'
		});
	});

	it('all seven days chosen is the same schedule as daily', () => {
		const all = 'days:mon,tue,wed,thu,fri,sat,sun';
		for (const number of [1, 2, 8, 30]) {
			expect(cadencePeriod(all, '2026-11-11', number)).toEqual(
				cadencePeriod('daily', '2026-11-11', number)
			);
		}
	});

	it('for every shape: periods follow one another with no gap, and each day is in its own', () => {
		for (const cadence of EVERY_SHAPE) {
			for (const startedOn of ['2026-11-09', '2026-11-11', '2026-11-15', '2026-12-28']) {
				let previousEnd: string | null = null;
				for (let number = 1; number <= 12; number++) {
					const period = cadencePeriod(cadence, startedOn, number);
					const label = `${cadence} from ${startedOn}, period ${String(number)}`;
					expect(period.start <= period.end, label).toBe(true);
					if (previousEnd === null) {
						expect(period.start, label).toBe(startedOn);
					} else {
						expect(cadencePeriodOn(cadence, startedOn, previousEnd)?.number, label).toBe(
							number - 1
						);
					}
					expect(cadencePeriodOn(cadence, startedOn, period.start), label).toEqual(period);
					expect(cadencePeriodOn(cadence, startedOn, period.end), label).toEqual(period);
					if (cadenceRule(cadence).kind === 'days') {
						expect(cadenceRule(cadence), label).toMatchObject({
							days: expect.arrayContaining([weekdayOf(period.end)])
						});
					}
					previousEnd = period.end;
				}
			}
		}
	});

	it('knows the longest a period lasts', () => {
		expect(cadenceLongestPeriodDays('weekly')).toBe(7);
		expect(cadenceLongestPeriodDays('fortnightly')).toBe(14);
		expect(cadenceLongestPeriodDays('daily')).toBe(1);
		expect(cadenceLongestPeriodDays('days:fri')).toBe(7);
		expect(cadenceLongestPeriodDays('days:mon,tue')).toBe(6);
		expect(cadenceLongestPeriodDays('days:mon,thu')).toBe(4);
		expect(cadenceLongestPeriodDays('days:mon,tue,wed,thu,fri,sat,sun')).toBe(1);
	});
});
