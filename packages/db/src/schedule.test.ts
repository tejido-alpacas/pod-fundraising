// The rules for what is due and overdue. Plain functions: no database, no clock, no network.
import type { Cadence, CampaignStatus, Milestone, MilestoneState } from '@tejido/contracts';
import { describe, expect, it } from 'vitest';
import {
	addDays,
	daysBetween,
	utcDay,
	whatIsDue,
	workLogPeriod,
	workLogPeriodOn,
	type DueItem,
	type ScheduleInput
} from './schedule.ts';

type ScheduleMilestone = ScheduleInput['milestones'][number];

function milestone(values: Partial<ScheduleMilestone> = {}): ScheduleMilestone {
	return {
		id: 'm2-walls',
		kind: 'construction',
		ownerPartyId: 'contractor',
		confirmerPartyId: 'head-teacher',
		dueDate: '2026-11-27',
		state: 'open',
		...values
	};
}

const workLog = (filedAt: string, partyId = 'contractor') =>
	({ partyId, item: 'log_work', filedAt }) as const;

function due(
	values: {
		status?: CampaignStatus;
		cadence?: Cadence;
		milestones?: ScheduleMilestone[];
		entries?: ScheduleInput['entries'];
		startedOn?: string | null;
		now: string;
	} = { now: '2026-11-16T12:00:00.000Z' }
): DueItem[] {
	return whatIsDue({
		campaign: { status: values.status ?? 'reporting', cadence: values.cadence ?? 'weekly' },
		milestones: values.milestones ?? [milestone()],
		entries: values.entries ?? [],
		workLogsStartedOn: values.startedOn === undefined ? '2026-11-09' : values.startedOn,
		now: new Date(values.now)
	});
}

const milestonesOf = (items: DueItem[]) => items.filter((item) => item.what === 'milestone');
const workLogsOf = (items: DueItem[]) => items.filter((item) => item.what === 'work_log');

describe('calendar days are UTC', () => {
	it('takes the UTC day of a moment, to the last millisecond', () => {
		expect(utcDay(new Date('2026-11-14T00:00:00.000Z'))).toBe('2026-11-14');
		expect(utcDay(new Date('2026-11-14T23:59:59.999Z'))).toBe('2026-11-14');
		expect(utcDay(new Date('2026-11-15T00:00:00.000Z'))).toBe('2026-11-15');
	});

	it('reads a time written with an offset as its UTC day, not its local day', () => {
		// 23:30 on the 14th in New York is already the 15th in UTC.
		expect(utcDay('2026-11-14T23:30:00.000-05:00')).toBe('2026-11-15');
		// 00:30 on the 15th in Tokyo is still the 14th in UTC.
		expect(utcDay('2026-11-15T00:30:00.000+09:00')).toBe('2026-11-14');
	});

	it('adds and counts days across a month, a year and a leap day', () => {
		expect(addDays('2026-11-27', 7)).toBe('2026-12-04');
		expect(addDays('2026-12-29', 7)).toBe('2027-01-05');
		expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
		expect(addDays('2026-11-09', -1)).toBe('2026-11-08');
		expect(daysBetween('2026-11-27', '2026-12-04')).toBe(7);
		expect(daysBetween('2026-12-04', '2026-11-27')).toBe(-7);
		expect(daysBetween('2026-11-27', '2026-11-27')).toBe(0);
	});
});

describe('work-log periods', () => {
	it('lasts 7 days when weekly and 14 when fortnightly, both ends included', () => {
		expect(workLogPeriod('weekly', '2026-11-09', 1)).toEqual({
			number: 1,
			start: '2026-11-09',
			end: '2026-11-15'
		});
		expect(workLogPeriod('weekly', '2026-11-09', 2)).toEqual({
			number: 2,
			start: '2026-11-16',
			end: '2026-11-22'
		});
		expect(workLogPeriod('fortnightly', '2026-11-09', 1)).toEqual({
			number: 1,
			start: '2026-11-09',
			end: '2026-11-22'
		});
		expect(workLogPeriod('fortnightly', '2026-11-09', 2).start).toBe('2026-11-23');
	});

	it('puts a day in the right period at each edge, and in none before the start', () => {
		expect(workLogPeriodOn('weekly', '2026-11-09', '2026-11-08')).toBeNull();
		expect(workLogPeriodOn('weekly', '2026-11-09', '2026-11-09')?.number).toBe(1);
		expect(workLogPeriodOn('weekly', '2026-11-09', '2026-11-15')?.number).toBe(1);
		expect(workLogPeriodOn('weekly', '2026-11-09', '2026-11-16')?.number).toBe(2);
		expect(workLogPeriodOn('fortnightly', '2026-11-09', '2026-11-22')?.number).toBe(1);
		expect(workLogPeriodOn('fortnightly', '2026-11-09', '2026-11-23')?.number).toBe(2);
	});
});

describe('a draft campaign', () => {
	it('is never due, whatever its dates and entries', () => {
		expect(
			due({
				status: 'draft',
				milestones: [
					milestone({ dueDate: '2026-01-01' }),
					milestone({ id: 'm3', state: 'claimed', dueDate: '2026-01-01' })
				],
				now: '2026-11-16T12:00:00.000Z'
			})
		).toEqual([]);
	});
});

describe('milestones', () => {
	const only = (state: MilestoneState, now: string, cadence: Cadence = 'weekly') =>
		milestonesOf(
			due({ cadence, milestones: [milestone({ state })], startedOn: null, status: 'funded', now })
		);

	it('raises nothing for an open milestone more than one period before its date', () => {
		// Due 27 November. Weekly: raised from the 20th. Fortnightly: from the 13th.
		expect(only('open', '2026-11-19T23:59:59.999Z')).toEqual([]);
		expect(only('open', '2026-11-12T23:59:59.999Z', 'fortnightly')).toEqual([]);
		expect(only('open', '2026-11-13T00:00:00.000Z', 'fortnightly')).toHaveLength(1);
	});

	it('is due from the party doing the work one period before its date', () => {
		expect(only('open', '2026-11-20T00:00:00.000Z')).toEqual([
			{
				what: 'milestone',
				milestoneId: 'm2-walls',
				partyId: 'contractor',
				action: 'claim',
				kind: 'due',
				dueDate: '2026-11-27',
				overdueDays: 0
			}
		]);
	});

	it('is still due, not overdue, through the last moment of its due date', () => {
		expect(only('open', '2026-11-27T00:00:00.000Z')[0]).toMatchObject({ kind: 'due' });
		expect(only('open', '2026-11-27T23:59:59.999Z')[0]).toMatchObject({
			kind: 'due',
			overdueDays: 0
		});
	});

	it('is overdue from the first moment of the next day, counted in whole days', () => {
		expect(only('open', '2026-11-28T00:00:00.000Z')[0]).toMatchObject({
			kind: 'overdue',
			partyId: 'contractor',
			action: 'claim',
			overdueDays: 1
		});
		expect(only('open', '2026-11-28T23:59:59.999Z')[0]).toMatchObject({ overdueDays: 1 });
		expect(only('open', '2026-12-04T08:00:00.000Z')[0]).toMatchObject({ overdueDays: 7 });
	});

	it('passes to the confirmer once claimed: due at once, however far off the date', () => {
		expect(only('claimed', '2026-10-01T09:00:00.000Z')).toEqual([
			{
				what: 'milestone',
				milestoneId: 'm2-walls',
				partyId: 'head-teacher',
				action: 'confirm',
				kind: 'due',
				dueDate: '2026-11-27',
				overdueDays: 0
			}
		]);
	});

	it('is overdue from the confirmer when claimed and past its date', () => {
		expect(only('claimed', '2026-11-27T23:59:59.999Z')[0]).toMatchObject({ kind: 'due' });
		expect(only('claimed', '2026-11-30T00:00:00.000Z')[0]).toMatchObject({
			partyId: 'head-teacher',
			action: 'confirm',
			kind: 'overdue',
			overdueDays: 3
		});
	});

	it('asks nothing once confirmed, by the confirmer or by the creator, however late', () => {
		expect(only('confirmed_independent', '2027-06-01T00:00:00.000Z')).toEqual([]);
		expect(only('confirmed_creator', '2027-06-01T00:00:00.000Z')).toEqual([]);
	});

	it('is raised in every status but draft', () => {
		for (const status of ['funding', 'funded', 'reporting', 'overdue', 'delivered'] as const) {
			const items = due({ status, startedOn: null, now: '2026-11-28T00:00:00.000Z' });
			expect(milestonesOf(items), status).toHaveLength(1);
		}
	});

	it('counts days overdue the way the pages do', () => {
		// The pages' rule (daysOverdue in @tejido/ui), written out here because this package
		// does not depend on that one.
		const pages = (m: Pick<Milestone, 'state' | 'dueDate'>, today: string) => {
			if (m.state === 'confirmed_independent' || m.state === 'confirmed_creator') return 0;
			const late = (Date.parse(today) - Date.parse(m.dueDate)) / 86_400_000;
			return late > 0 ? Math.floor(late) : 0;
		};
		for (const state of ['open', 'claimed', 'confirmed_independent'] as const) {
			for (const today of ['2026-11-01', '2026-11-27', '2026-11-28', '2026-12-31', '2027-03-01']) {
				const [item] = only(state, `${today}T15:00:00.000Z`);
				expect(item?.overdueDays ?? 0, `${state} on ${today}`).toBe(
					pages(milestone({ state }), today)
				);
			}
		}
	});
});

describe('work logs', () => {
	const logs = (values: Parameters<typeof due>[0]) => workLogsOf(due(values));

	it('is due in the first period from the first day, with no entries at all', () => {
		expect(logs({ now: '2026-11-09T00:00:00.000Z' })).toEqual([
			{
				what: 'work_log',
				partyId: 'contractor',
				period: { number: 1, start: '2026-11-09', end: '2026-11-15' },
				kind: 'due',
				dueDate: '2026-11-15',
				overdueDays: 0
			}
		]);
	});

	it('is nothing before the schedule starts, or when no start is recorded', () => {
		expect(logs({ now: '2026-11-08T23:59:59.999Z' })).toEqual([]);
		expect(logs({ startedOn: null, now: '2026-11-16T12:00:00.000Z' })).toEqual([]);
	});

	it('stays due through the last moment of the period, then is overdue', () => {
		expect(logs({ now: '2026-11-15T23:59:59.999Z' })).toMatchObject([
			{ kind: 'due', period: { number: 1 }, overdueDays: 0 }
		]);
		expect(logs({ now: '2026-11-16T00:00:00.000Z' })).toMatchObject([
			{ kind: 'overdue', period: { number: 1 }, dueDate: '2026-11-15', overdueDays: 1 },
			{ kind: 'due', period: { number: 2 }, dueDate: '2026-11-22', overdueDays: 0 }
		]);
	});

	it('is settled for the period by one work log filed in it', () => {
		expect(
			logs({ entries: [workLog('2026-11-09T00:00:00.000Z')], now: '2026-11-12T10:00:00.000Z' })
		).toEqual([]);
		expect(
			logs({ entries: [workLog('2026-11-15T23:59:59.999Z')], now: '2026-11-16T00:00:00.000Z' })
		).toMatchObject([{ kind: 'due', period: { number: 2 } }]);
	});

	it('does not count a second log in one period towards the next', () => {
		const entries = [workLog('2026-11-10T09:00:00.000Z'), workLog('2026-11-11T09:00:00.000Z')];
		expect(logs({ entries, now: '2026-11-16T00:00:00.000Z' })).toMatchObject([
			{ kind: 'due', period: { number: 2 } }
		]);
	});

	it('lets a late log settle the missed period, leaving the current one due', () => {
		expect(
			logs({ entries: [workLog('2026-11-17T09:00:00.000Z')], now: '2026-11-18T09:00:00.000Z' })
		).toMatchObject([{ kind: 'due', period: { number: 2 } }]);
		// A second log in the same period then settles that one too.
		expect(
			logs({
				entries: [workLog('2026-11-17T09:00:00.000Z'), workLog('2026-11-18T08:00:00.000Z')],
				now: '2026-11-18T09:00:00.000Z'
			})
		).toEqual([]);
	});

	it('lists every missed period, each by how long', () => {
		expect(logs({ now: '2026-11-30T09:00:00.000Z' })).toMatchObject([
			{ kind: 'overdue', period: { number: 1 }, overdueDays: 15 },
			{ kind: 'overdue', period: { number: 2 }, overdueDays: 8 },
			{ kind: 'overdue', period: { number: 3 }, overdueDays: 1 },
			{ kind: 'due', period: { number: 4 }, dueDate: '2026-12-06' }
		]);
	});

	it('runs on fortnights when the cadence is fortnightly', () => {
		expect(logs({ cadence: 'fortnightly', now: '2026-11-22T23:59:59.999Z' })).toMatchObject([
			{ kind: 'due', period: { number: 1, end: '2026-11-22' } }
		]);
		expect(logs({ cadence: 'fortnightly', now: '2026-11-23T00:00:00.000Z' })).toMatchObject([
			{ kind: 'overdue', period: { number: 1 }, overdueDays: 1 },
			{ kind: 'due', period: { number: 2, start: '2026-11-23', end: '2026-12-06' } }
		]);
	});

	it('ignores entries that are not this party’s work logs', () => {
		const entries = [
			workLog('2026-11-10T09:00:00.000Z', 'supplier'),
			{
				partyId: 'contractor',
				item: 'milestone_hit',
				filedAt: '2026-11-10T09:00:00.000Z'
			} as const,
			// Filed before the schedule started.
			workLog('2026-11-08T23:59:59.999Z')
		];
		expect(logs({ entries, now: '2026-11-12T09:00:00.000Z' })).toMatchObject([
			{ partyId: 'contractor', kind: 'due', period: { number: 1 } }
		]);
	});

	it('is owed only for open milestones of a kind that reports on the cadence', () => {
		const now = '2026-11-12T09:00:00.000Z';
		const owing = (m: Partial<ScheduleMilestone>) =>
			logs({ milestones: [milestone(m)], now }).map((item) => item.partyId);

		expect(owing({ kind: 'construction' })).toEqual(['contractor']);
		expect(owing({ kind: 'service' })).toEqual(['contractor']);
		expect(owing({ kind: 'goods_delivery' })).toEqual([]);
		expect(owing({ kind: 'funds_handover' })).toEqual([]);
		expect(owing({ state: 'claimed' })).toEqual([]);
		expect(owing({ state: 'confirmed_independent' })).toEqual([]);
		expect(owing({ state: 'confirmed_creator' })).toEqual([]);
	});

	it('is owed once per party, however many open milestones they have', () => {
		const items = logs({
			milestones: [
				milestone(),
				milestone({ id: 'm4-roof', dueDate: '2026-12-18' }),
				milestone({ id: 'm5-tutoring', kind: 'service', ownerPartyId: 'tutor' })
			],
			now: '2026-11-12T09:00:00.000Z'
		});
		expect(items.map((item) => item.partyId)).toEqual(['contractor', 'tutor']);
	});

	it('is owed only while work is under way', () => {
		const now = '2026-11-12T09:00:00.000Z';
		for (const status of ['reporting', 'overdue'] as const) {
			expect(logs({ status, now }), status).toHaveLength(1);
		}
		for (const status of ['draft', 'funding', 'funded', 'delivered'] as const) {
			expect(logs({ status, now }), status).toEqual([]);
		}
	});
});
