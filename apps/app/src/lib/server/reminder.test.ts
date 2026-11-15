// The words of a reminder. Nothing here sends anything, and nothing reaches the network.
import { fixtures } from '@tejido/contracts/fixtures';
import { describe, expect, it } from 'vitest';
import { partyMilestones } from '#lib/due.ts';
import { chatPath, reminderFor, reminderMessage, reminderPath } from './reminder.ts';

const contractor = fixtures.parties[0]!;
const headTeacher = fixtures.parties[2]!;
const campaign = { title: fixtures.campaign.title, cadence: fixtures.campaign.cadence };
const APP = 'https://app.tejido.net';

/** What is due from a party on a given day, for a reminder link with or without a milestone. */
function dueFor(party: typeof contractor, today: string, milestoneId: string | null) {
	const theirs = partyMilestones(fixtures.milestones, party.id, new Set(), today);
	const due = reminderFor(theirs, party.role, milestoneId);
	if (due.kind === 'nothing') throw new Error('expected something to be due');
	return due;
}

function message(party: typeof contractor, today: string, milestoneId: string | null) {
	return reminderMessage({
		party: { name: party.name },
		campaign,
		due: dueFor(party, today, milestoneId),
		link: `${APP}${reminderPath(milestoneId)}`,
		today
	});
}

describe('the reminder message', () => {
	it('says which milestone is due, by when, and carries the link', () => {
		expect(message(contractor, '2026-11-14', 'm2-walls')).toEqual({
			subject: 'Due 27 Nov: Walls up to roof height',
			text: [
				'Coral Ridge Builders,',
				'Milestone 2 on "Rebuild the library wing" is due from you on 27 Nov: Walls up to roof height.',
				'Report it when it is done. Open this link and sign in with Qatom. A short conversation collects what the report needs. Nothing is filed until you say yes.',
				'https://app.tejido.net/reminder?milestone=m2-walls',
				'Tejido\n'
			].join('\n\n')
		});
	});

	it('says how late an overdue milestone is', () => {
		const late = message(contractor, '2026-11-30', 'm2-walls');
		expect(late.subject).toBe('Overdue by 3 days: Walls up to roof height');
		expect(late.text).toContain('was due from you on 27 Nov and is 3 days overdue');
		expect(late.text).toContain('Report on it now.');

		expect(message(contractor, '2026-11-28', 'm2-walls').subject).toBe(
			'Overdue by 1 day: Walls up to roof height'
		);
	});

	it('asks a confirmer to confirm what has been reported as done', () => {
		const confirm = message(headTeacher, '2026-11-14', 'm3-books-delivered');
		expect(confirm.subject).toBe('Waiting for you to confirm: Books delivered');
		expect(confirm.text).toContain(
			'has been reported as done and is waiting for you to confirm it'
		);
		expect(confirm.text).toContain('Confirm it once you have seen it yourself.');
		expect(confirm.text).toContain(`${APP}/reminder?milestone=m3-books-delivered`);
	});

	it('says a work log is due, and how often', () => {
		const log = message(contractor, '2026-11-14', null);
		expect(log.subject).toBe('Work log due: Rebuild the library wing');
		expect(log.text).toContain(
			'Your work log on "Rebuild the library wing" is due. You log your work every week.'
		);
		expect(log.text).toContain(`\n\n${APP}/reminder\n\n`);
	});

	it('is short, plain text, and carries nobody’s filing code, wallet or email address', () => {
		for (const [party, id] of [
			[contractor, 'm2-walls'],
			[contractor, null],
			[headTeacher, 'm3-books-delivered']
		] as const) {
			const { subject, text } = message(party, '2026-11-30', id);
			const all = `${subject}\n${text}`;

			expect(subject.length).toBeLessThanOrEqual(78);
			expect(subject).not.toContain('\n');
			expect(text.split(/\s+/).length).toBeLessThan(90);
			expect(all).not.toMatch(/[<>*#!]/);
			for (const anyone of fixtures.parties) {
				expect(all).not.toContain(anyone.reporterCode);
				expect(all).not.toContain(anyone.email);
				if (anyone.agentWalletHostname) expect(all).not.toContain(anyone.agentWalletHostname);
				if (anyone.primaryWalletHostname) expect(all).not.toContain(anyone.primaryWalletHostname);
				if (anyone.id !== party.id) expect(all).not.toContain(anyone.name);
			}
		}
	});
});

describe('the addresses a reminder uses', () => {
	it('are the ones the scheduler hands out, and the chat opened for the same milestone', () => {
		expect(reminderPath(null)).toBe('/reminder');
		expect(reminderPath('m2-walls')).toBe('/reminder?milestone=m2-walls');
		expect(chatPath(null)).toBe('/chat');
		expect(chatPath('m2-walls')).toBe('/chat?milestone=m2-walls');
		// An id is data, never part of the address's shape.
		expect(reminderPath('a&party=x')).toBe('/reminder?milestone=a%26party%3Dx');
	});
});
