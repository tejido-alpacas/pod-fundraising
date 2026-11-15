// The scheduler's own records against a real, migrated D1 database. Nothing here reaches the
// network.
import { fixtures } from '@tejido/contracts/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	getWorkLogStart,
	listReminders,
	recordReminders,
	startWorkLogSchedule,
	type NewReminder
} from './index.ts';
import { createTestDatabase, type TestDatabase } from './testing.ts';

const CAMPAIGN = fixtures.campaign.id;
const AT = '2026-11-16T08:00:00.000Z';

let test: TestDatabase;

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
});
afterEach(() => test.destroy());

function reminder(id: string, values: Partial<NewReminder> = {}): NewReminder {
	return {
		id,
		campaignId: CAMPAIGN,
		partyId: 'contractor',
		what: 'milestone',
		subject: 'm2-walls',
		kind: 'due',
		dueDate: '2026-11-27',
		raisedAt: AT,
		...values
	};
}

describe('the work-log start', () => {
	it('is not recorded until the scheduler records it', async () => {
		expect(await getWorkLogStart(test.db, CAMPAIGN)).toBeNull();
	});

	it('keeps the first day recorded, whatever is offered later', async () => {
		expect(await startWorkLogSchedule(test.db, CAMPAIGN, '2026-11-16', AT)).toBe('2026-11-16');
		expect(
			await startWorkLogSchedule(test.db, CAMPAIGN, '2026-11-23', '2026-11-23T08:00:00.000Z')
		).toBe('2026-11-16');
		expect(await getWorkLogStart(test.db, CAMPAIGN)).toBe('2026-11-16');
	});
});

describe('recordReminders', () => {
	it('records each reminder and answers what it added', async () => {
		const added = await recordReminders(test.db, [
			reminder('rem_1'),
			reminder('rem_2', { what: 'work_log', subject: '2026-11-16', dueDate: '2026-11-22' })
		]);

		expect(added.map((row) => row.id)).toEqual(['rem_1', 'rem_2']);
		expect(await listReminders(test.db, CAMPAIGN)).toEqual(added);
	});

	it('adds nothing, and answers nothing, for a reminder already recorded', async () => {
		await recordReminders(test.db, [reminder('rem_1')]);

		const again = await recordReminders(test.db, [reminder('rem_other_id')]);

		expect(again).toEqual([]);
		expect((await listReminders(test.db, CAMPAIGN)).map((row) => row.id)).toEqual(['rem_1']);
	});

	it('records the same subject once as due and once as overdue', async () => {
		await recordReminders(test.db, [reminder('rem_1')]);

		const added = await recordReminders(test.db, [
			reminder('rem_2'),
			reminder('rem_3', { kind: 'overdue' })
		]);

		expect(added.map((row) => row.id)).toEqual(['rem_3']);
	});

	it('keeps a milestone and a work-log period apart, and one party from another', async () => {
		const added = await recordReminders(test.db, [
			// A milestone id may look like a day; it is still a different thing from a period.
			reminder('rem_1', { what: 'milestone', subject: '2026-11-16' }),
			reminder('rem_2', { what: 'work_log', subject: '2026-11-16' }),
			reminder('rem_3', { what: 'work_log', subject: '2026-11-23' }),
			reminder('rem_4', { what: 'work_log', subject: '2026-11-16', partyId: 'supplier' })
		]);

		expect(added).toHaveLength(4);
	});

	it('answers an empty list for an empty list', async () => {
		expect(await recordReminders(test.db, [])).toEqual([]);
	});
});
