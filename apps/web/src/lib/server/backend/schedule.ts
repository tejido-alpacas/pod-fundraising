/**
 * The cadence scheduler: one pass over every campaign that is not a draft. It works out what
 * is due and overdue, records one reminder for each thing that newly fell due or became
 * overdue, and answers with counts and the reminders it recorded.
 *
 * The rules for what is due are not here. They are `whatIsDue` in @tejido/db (schedule.ts),
 * the one definition, so nothing else has to repeat them.
 *
 * NOTHING IS SENT. There is no email service in this project. A reminder is a row in our own
 * database and a line in this pass's answer; a person, or a later mailer, acts on it.
 *
 * NOTHING ELSE IS CHANGED. No campaign status is moved, no milestone, entry or deposit is
 * touched, and Qatom is not called: no ledger read, no transfer.
 *
 * NO PRIVATE DETAIL LEAVES. The answer names a party by its id and display name only: never
 * an email address, a filing code or a wallet. Nothing is logged.
 *
 * WHEN WORK-LOG PERIODS START. Nothing records the day a campaign began reporting, so the
 * first pass that sees a campaign with work under way (`reporting` or `overdue`) records that
 * UTC day as the first day of its first period. It is written once and never moved. Work logs
 * filed before that day are not counted for or against anyone.
 *
 * RUNNING IT AGAIN records nothing new until something else falls due or becomes overdue: the
 * database refuses a second reminder for the same party, subject and kind, even when two
 * passes run at once.
 */
import type { Campaign, Timestamp } from '@tejido/contracts';
import {
	getWorkLogStart,
	listCampaigns,
	listEntries,
	listMilestones,
	listParties,
	recordReminders,
	startWorkLogSchedule,
	utcDay,
	whatIsDue,
	type Database,
	type DueItem,
	type DueKind,
	type NewReminder,
	type UtcDay,
	type WorkLogPeriod
} from '@tejido/db';
import { randomUUID } from 'node:crypto';

/** One reminder recorded by this pass, as the answer gives it. */
export interface RaisedReminder {
	id: string;
	campaignId: string;
	/** The party responsible. By id and display name only. */
	party: { id: string; name: string };
	what: 'work_log' | 'milestone';
	kind: DueKind;
	/** The milestone to claim or confirm. Null for a work log. */
	milestoneId: string | null;
	/** What the party is asked to do. */
	action: 'log_work' | 'claim' | 'confirm';
	/** The period the work log is for. Null for a milestone. */
	period: WorkLogPeriod | null;
	/** The last day it is on time, a UTC calendar day. */
	dueDate: UtcDay;
	/** Whole days past `dueDate`. 0 for a `due` reminder. */
	overdueDays: number;
	raisedAt: Timestamp;
	/** The page in the App the party should open. */
	link: string;
}

export interface ScheduleSummary {
	ranAt: Timestamp;
	/** The UTC calendar day the pass counted as today. */
	today: UtcDay;
	/** Campaigns looked at: every one that is not a draft. */
	campaigns: number;
	/** Things due now and not yet late, whether or not a reminder was already recorded. */
	due: number;
	/** Things overdue now, whether or not a reminder was already recorded. */
	overdue: number;
	/** How many reminders this pass recorded: the length of `reminders`. */
	remindersRecorded: number;
	/** Only the reminders this pass recorded. Ones recorded by an earlier pass are not repeated. */
	reminders: RaisedReminder[];
}

/** Work is under way: the statuses in which the work-log periods run. */
function workUnderWay(campaign: Pick<Campaign, 'status'>): boolean {
	return campaign.status === 'reporting' || campaign.status === 'overdue';
}

/**
 * Where the party is sent: the App's reminder page, with the milestone when there is one and
 * always the party it is for. The party's id is what lets a signed-out person sign in to the
 * right project in one step, as an invitation link does.
 */
function reminderLink(appOrigin: string, item: DueItem): string {
	const url = new URL('/reminder', appOrigin);
	if (item.what === 'milestone') url.searchParams.set('milestone', item.milestoneId);
	url.searchParams.set('party', item.partyId);
	return url.href;
}

/**
 * @param appOrigin the App's origin, e.g. `https://app.tejido.net`: `evidenceStoreOrigin(config)`.
 */
export async function runSchedule(
	db: Database,
	options: { now: Date; appOrigin: string }
): Promise<ScheduleSummary> {
	const { now, appOrigin } = options;
	const ranAt = now.toISOString();
	const today = utcDay(now);
	const summary: ScheduleSummary = {
		ranAt,
		today,
		campaigns: 0,
		due: 0,
		overdue: 0,
		remindersRecorded: 0,
		reminders: []
	};

	for (const campaign of await listCampaigns(db)) {
		if (campaign.status === 'draft') continue;
		summary.campaigns += 1;

		const [milestones, entries, parties] = await Promise.all([
			listMilestones(db, campaign.id),
			listEntries(db, campaign.id),
			listParties(db, campaign.id)
		]);
		const workLogsStartedOn = workUnderWay(campaign)
			? await startWorkLogSchedule(db, campaign.id, today, ranAt)
			: await getWorkLogStart(db, campaign.id);

		const items = whatIsDue({ campaign, milestones, entries, workLogsStartedOn, now });
		summary.due += items.filter((item) => item.kind === 'due').length;
		summary.overdue += items.filter((item) => item.kind === 'overdue').length;

		const wanted = items.map((item) => ({
			item,
			row: {
				id: `rem_${randomUUID()}`,
				campaignId: campaign.id,
				partyId: item.partyId,
				what: item.what,
				subject: item.what === 'milestone' ? item.milestoneId : item.period.start,
				kind: item.kind,
				dueDate: item.dueDate,
				raisedAt: ranAt
			} satisfies NewReminder
		}));
		const recorded = new Set(
			(
				await recordReminders(
					db,
					wanted.map(({ row }) => row)
				)
			).map((row) => row.id)
		);

		for (const { item, row } of wanted) {
			if (!recorded.has(row.id)) continue;
			const party = parties.find((candidate) => candidate.id === item.partyId);
			if (!party) throw new Error(`Reminder ${row.id} is for a party the campaign does not have.`);
			summary.reminders.push({
				id: row.id,
				campaignId: campaign.id,
				party: { id: party.id, name: party.name },
				what: item.what,
				kind: item.kind,
				milestoneId: item.what === 'milestone' ? item.milestoneId : null,
				action: item.what === 'milestone' ? item.action : 'log_work',
				period: item.what === 'work_log' ? item.period : null,
				dueDate: item.dueDate,
				overdueDays: item.overdueDays,
				raisedAt: ranAt,
				link: reminderLink(appOrigin, item)
			});
		}
	}

	summary.remindersRecorded = summary.reminders.length;
	return summary;
}
