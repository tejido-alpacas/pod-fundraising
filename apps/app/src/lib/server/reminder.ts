/**
 * The reminder (B4): what a reminder link is about, and the message that carries the link.
 * Track B owns this file.
 *
 * NOTHING HERE SENDS ANYTHING. The project has no email service, so `reminderMessage` only
 * writes the words. Whatever sends reminders one day calls it and delivers the result.
 *
 * "Due" is not defined here: it is `#lib/due.ts`, the same list the home page shows.
 */
import type { PartyRole } from '@tejido/contracts';
import { CADENCE } from '#lib/roles.ts';
import { shortDay } from '#lib/dates.ts';
import { needsYou, type PartyMilestone } from '#lib/due.ts';

/**
 * What one reminder link asks of the person who opened it.
 * - `milestone`: a milestone of theirs that they must report on, or confirm.
 * - `work_log`: their routine work log. `alsoDue` is the next milestone waiting on them, if any.
 * - `nothing`: there is nothing to do, and `why`:
 *   - `not_yours`: the link names a milestone that is not theirs, or that does not exist.
 *     The two are deliberately not told apart, and nothing about the milestone is given.
 *   - `confirmed`: their milestone, already confirmed.
 *   - `waiting`: their milestone, but someone else acts next.
 *   - `none_due`: no milestone was named and nothing is waiting on them.
 */
export type ReminderDue =
	| { kind: 'milestone'; milestone: PartyMilestone }
	| { kind: 'work_log'; alsoDue: PartyMilestone | null }
	| { kind: 'nothing'; why: 'not_yours' }
	| { kind: 'nothing'; why: 'confirmed' | 'waiting'; milestone: PartyMilestone }
	| { kind: 'nothing'; why: 'none_due' };

/**
 * Reads a reminder link for one party. `theirs` is that party's own milestones
 * (`partyMilestones`), so another party's milestone can never be found in it. `milestoneId` is
 * the link's `milestone`, or null when the link has none.
 */
export function reminderFor(
	theirs: PartyMilestone[],
	role: PartyRole,
	milestoneId: string | null
): ReminderDue {
	if (milestoneId !== null) {
		const milestone = theirs.find((candidate) => candidate.id === milestoneId);
		if (!milestone) return { kind: 'nothing', why: 'not_yours' };
		if (milestone.step === 'done') return { kind: 'nothing', why: 'confirmed', milestone };
		if (milestone.step === 'waiting') return { kind: 'nothing', why: 'waiting', milestone };
		return { kind: 'milestone', milestone };
	}

	const next = theirs.find((milestone) => needsYou(milestone.step)) ?? null;
	// A confirmer files no work logs: a link without a milestone shows what waits on them.
	if (role === 'confirmer') {
		return next ? { kind: 'milestone', milestone: next } : { kind: 'nothing', why: 'none_due' };
	}
	// Work is logged on a milestone that is theirs and not yet confirmed.
	const canLog = theirs.some((milestone) => milestone.part === 'owes' && milestone.step !== 'done');
	return canLog ? { kind: 'work_log', alsoDue: next } : { kind: 'nothing', why: 'none_due' };
}

/** The reminder page's own address for a milestone, or for a work log when there is none. */
export function reminderPath(milestoneId: string | null): string {
	return milestoneId === null
		? '/reminder'
		: `/reminder?${new URLSearchParams({ milestone: milestoneId }).toString()}`;
}

/** Where the reminder's main button goes: the chat, opened for that milestone when there is one. */
export function chatPath(milestoneId: string | null): string {
	return milestoneId === null
		? '/chat'
		: `/chat?${new URLSearchParams({ milestone: milestoneId }).toString()}`;
}

export interface ReminderMessageInput {
	/** Only the name. The message is never given a filing code, a wallet or an email address. */
	party: { name: string };
	campaign: { title: string; cadence: keyof typeof CADENCE };
	/** Something that is actually due. A link with nothing to do gets no message. */
	due: Extract<ReminderDue, { kind: 'milestone' | 'work_log' }>;
	/** The full address of the reminder page for this, as the scheduler hands it out. */
	link: string;
	/** Today, as YYYY-MM-DD. */
	today: string;
}

export interface ReminderMessage {
	subject: string;
	/** Plain text. */
	text: string;
}

const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);

const HOW =
	'Open this link and sign in with Qatom. A short conversation collects what the report needs. Nothing is filed until you say yes.';

/**
 * The words of one reminder: a subject and a short plain-text body, in the App's voice.
 * It says what is due, by when, whether it is late, and carries the link. Nothing else.
 */
export function reminderMessage(input: ReminderMessageInput): ReminderMessage {
	const { party, campaign, due, link, today } = input;
	let subject: string;
	let what: string;
	let next: string;

	if (due.kind === 'work_log') {
		subject = `Work log due: ${campaign.title}`;
		what = `Your work log on "${campaign.title}" is due. You log your work ${CADENCE[campaign.cadence]}.`;
		next = `It is a short note on what was done, with photos if you have them. ${HOW}`;
	} else {
		const { milestone } = due;
		const when = shortDay(milestone.dueDate, new Date(`${today}T00:00:00Z`));
		const named = `Milestone ${milestone.position} on "${campaign.title}"`;
		if (milestone.step === 'confirm') {
			subject = `Waiting for you to confirm: ${milestone.title}`;
			what = `${named} has been reported as done and is waiting for you to confirm it: ${milestone.title}.`;
			next = `Confirm it once you have seen it yourself. ${HOW}`;
		} else if (milestone.overdueDays > 0) {
			subject = `Overdue by ${days(milestone.overdueDays)}: ${milestone.title}`;
			what = `${named} was due from you on ${when} and is ${days(milestone.overdueDays)} overdue: ${milestone.title}.`;
			next = `Report on it now. ${HOW}`;
		} else {
			subject = `Due ${when}: ${milestone.title}`;
			what = `${named} is due from you on ${when}: ${milestone.title}.`;
			next = `Report it when it is done. ${HOW}`;
		}
	}

	return {
		subject,
		text: [`${party.name},`, what, next, link, 'Tejido'].join('\n\n') + '\n'
	};
}
