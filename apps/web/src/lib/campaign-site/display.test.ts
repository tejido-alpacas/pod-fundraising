import { describe, expect, it } from 'vitest';
import {
	confirmationAnswer,
	count,
	countWord,
	day,
	daysBetween,
	evidenceCount,
	filingKey,
	headline,
	initials,
	list,
	lowerFirst,
	milestoneStatus,
	overdueLabel,
	stamp,
	time
} from './display.ts';

describe('dates on the public record', () => {
	it('writes a day without its year only within the current year', () => {
		expect(day('2026-11-06T16:20:11.000Z', '2026-11-14')).toBe('6 Nov');
		expect(day('2027-01-22', '2026-11-14')).toBe('22 Jan 2027');
	});

	it('writes times in 24 hours and labels them UTC', () => {
		expect(time('2026-11-06T16:20:11.000Z')).toBe('16:20 UTC');
		expect(stamp('2026-11-06T16:20:11.000Z', '2026-11-14')).toBe('6 Nov 16:20');
	});

	it('counts whole days between dates or timestamps', () => {
		expect(daysBetween('2026-11-27', '2026-12-03T11:00:00.000Z')).toBe(6);
		expect(daysBetween('2026-11-06', '2026-11-14')).toBe(8);
	});
});

describe('counting in words', () => {
	it('counts with the right singular and plural', () => {
		expect(count(1, 'photo')).toBe('1 photo');
		expect(count(2, 'entry', 'entries')).toBe('2 entries');
		expect(countWord(2, 'file')).toBe('Two files');
		expect(countWord(0, 'file')).toBe('No files');
		expect(countWord(12, 'file')).toBe('12 files');
		expect(list(['a', 'b', 'c'])).toBe('a, b and c');
		expect(overdueLabel(8)).toBe('Overdue · 8 days');
		expect(overdueLabel(1)).toBe('Overdue · 1 day');
	});

	it('counts evidence, saying when files were left out', () => {
		expect(evidenceCount({ photos: 1, documents: 0, leftOut: 1 }, 'None')).toBe(
			'1 photo, 1 file left out'
		);
		expect(evidenceCount({ photos: 0, documents: 0, leftOut: 0 }, 'No files attached')).toBe(
			'No files attached'
		);
	});
});

describe('names and titles', () => {
	it('makes initials, a headline and a lower-case role', () => {
		expect(initials('Coral Ridge Builders')).toBe('CR');
		expect(headline('Block work started on the north wall. Scaffolding is up.')).toBe(
			'Block work started on the north wall'
		);
		expect(lowerFirst('Head teacher')).toBe('head teacher');
		expect(lowerFirst('PTA chair')).toBe('PTA chair');
	});
});

describe('the trust vocabulary', () => {
	it('never shortens a verified receipt to a plain "verified" state, and shows filed as pending', () => {
		expect(filingKey('verified')).toBe('verified');
		expect(filingKey('filed')).toBe('pending');
	});

	it('keeps claimed apart from confirmed, and never makes overdue a status', () => {
		expect(milestoneStatus('claimed', true)).toBe('claimed');
		expect(milestoneStatus('confirmed_creator', true)).toBe('confirmed');
		expect(milestoneStatus('confirmed_independent', true)).toBe('confirmed');
		expect(milestoneStatus('open', true)).toBe('in-progress');
		expect(milestoneStatus('open', false)).toBe('not-started');
	});

	const milestone = {
		position: 2,
		confirmedAt: null,
		confirmedBy: null,
		confirmer: { name: 'Yvonne Campbell', title: 'Head teacher' }
	};

	it('answers "not yet" for a claimed milestone, in the guide’s words', () => {
		const answer = confirmationAnswer(
			'Has someone confirmed it?',
			{ ...milestone, status: 'claimed', strength: null },
			'2026-11-14'
		);

		expect(answer.answer).toBe('Not yet');
		expect(answer.tone).toBe('neutral');
		expect(answer.detail).toContain('Work has been reported. Confirmation is still pending.');
	});

	it('names the strength of a confirmation, never a score', () => {
		const answer = confirmationAnswer(
			'Has someone confirmed it?',
			{
				...milestone,
				status: 'confirmed',
				strength: 'stakeholder',
				confirmedAt: '2026-10-30T09:41:07.000Z',
				confirmedBy: 'Yvonne Campbell, head teacher'
			},
			'2026-11-14'
		);

		expect(answer.answer).toBe('Yes · stakeholder confirmation');
		expect(answer.detail).toBe(
			'Milestone 2 was confirmed by Yvonne Campbell, head teacher on 30 Oct.'
		);
		expect(`${answer.answer} ${answer.detail}`).not.toMatch(/%|score|star/i);
	});
});
