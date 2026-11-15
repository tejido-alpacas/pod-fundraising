/**
 * Reading and writing the cadence scheduler's own records: the day a campaign's work-log
 * periods start, and the reminders raised. The rules for what is due are in schedule.ts.
 * Track C owns this file.
 */
import type { Timestamp } from '@tejido/contracts';
import { asc, eq } from 'drizzle-orm';
import type { Database, Executor } from './client.ts';
import type { UtcDay } from './schedule.ts';
import { reminders, workLogSchedules } from './schema.ts';

export type Reminder = typeof reminders.$inferSelect;
export type NewReminder = typeof reminders.$inferInsert;

/** The first day of the campaign's first work-log period, or null when none is recorded. */
export async function getWorkLogStart(db: Executor, campaignId: string): Promise<UtcDay | null> {
	const [row] = await db
		.select({ startedOn: workLogSchedules.startedOn })
		.from(workLogSchedules)
		.where(eq(workLogSchedules.campaignId, campaignId));
	return row?.startedOn ?? null;
}

/**
 * Records `day` as the start of the campaign's work-log periods unless a start is already
 * recorded, and answers the start that stands. The first one written is never replaced.
 */
export async function startWorkLogSchedule(
	db: Executor,
	campaignId: string,
	day: UtcDay,
	now: Timestamp
): Promise<UtcDay> {
	await db
		.insert(workLogSchedules)
		.values({ campaignId, startedOn: day, recordedAt: now })
		.onConflictDoNothing();
	const startedOn = await getWorkLogStart(db, campaignId);
	if (startedOn === null) throw new Error(`No work-log start was stored for ${campaignId}.`);
	return startedOn;
}

/**
 * Records each reminder that is not already recorded, and answers only the ones this call
 * added. A reminder for the same party, subject and kind as an existing one is left out, so
 * calling this again with the same list adds nothing and answers an empty list.
 */
export async function recordReminders(db: Database, wanted: NewReminder[]): Promise<Reminder[]> {
	const inserts = wanted.map((reminder) =>
		db.insert(reminders).values(reminder).onConflictDoNothing().returning()
	);
	const [first, ...rest] = inserts;
	if (!first) return [];
	const results = await db.batch([first, ...rest]);
	return results.flat();
}

/** Every reminder recorded for a campaign, oldest first. */
export async function listReminders(db: Executor, campaignId: string): Promise<Reminder[]> {
	return db
		.select()
		.from(reminders)
		.where(eq(reminders.campaignId, campaignId))
		.orderBy(asc(reminders.raisedAt), asc(reminders.id));
}
