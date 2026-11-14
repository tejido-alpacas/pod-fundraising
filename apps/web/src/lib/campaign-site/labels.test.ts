import { describe, expect, it } from 'vitest';
import {
	CONFIRMATION_STRENGTH_LABEL,
	milestoneLabel,
	milestoneMeaning,
	partyLabel,
	strengthSummary
} from './labels.ts';

describe('the words for a confirmation', () => {
	it('names the three strengths as the design system does', () => {
		expect(CONFIRMATION_STRENGTH_LABEL).toEqual({
			participant: 'Participant confirmation',
			stakeholder: 'Stakeholder confirmation',
			independent: 'Independent confirmation'
		});
	});

	it('labels a confirmed milestone by its strength and an unconfirmed one by its state', () => {
		expect(milestoneLabel({ state: 'confirmed_independent', strength: 'stakeholder' })).toBe(
			'Stakeholder confirmation'
		);
		expect(milestoneLabel({ state: 'confirmed_independent', strength: 'independent' })).toBe(
			'Independent confirmation'
		);
		expect(milestoneLabel({ state: 'confirmed_creator', strength: 'participant' })).toBe(
			'Participant confirmation'
		);
		expect(milestoneLabel({ state: 'claimed', strength: null })).toBe('Reported only');
		expect(milestoneLabel({ state: 'open', strength: null })).toBe('Not yet claimed');
	});

	it('never says independent about a confirmation that is not recorded as independent', () => {
		for (const strength of ['participant', 'stakeholder'] as const) {
			for (const state of ['confirmed_independent', 'confirmed_creator'] as const) {
				expect(milestoneLabel({ state, strength })).not.toMatch(/independent/i);
				expect(milestoneMeaning({ state, strength })).not.toMatch(/independent/i);
			}
		}
		expect(milestoneLabel({ state: 'confirmed_independent', strength: null })).not.toMatch(
			/independent/i
		);
	});

	it('describes a confirmer by relationship and a third party by what it does', () => {
		expect(partyLabel({ role: 'confirmer', relationship: 'stakeholder' })).toBe(
			'stakeholder confirmer'
		);
		expect(partyLabel({ role: 'confirmer', relationship: 'independent' })).toBe(
			'independent confirmer'
		);
		expect(partyLabel({ role: 'third_party', relationship: 'participant' })).toBe('does the work');
	});

	it('sums up a campaign in words, leaving out strengths with none', () => {
		expect(strengthSummary({ participant: 1, stakeholder: 2, independent: 0 })).toBe(
			'2 stakeholder confirmations and 1 participant confirmation'
		);
		expect(strengthSummary({ participant: 1, stakeholder: 1, independent: 1 })).toBe(
			'1 independent confirmation, 1 stakeholder confirmation and 1 participant confirmation'
		);
		expect(strengthSummary({ participant: 0, stakeholder: 0, independent: 3 })).toBe(
			'3 independent confirmations'
		);
		expect(strengthSummary({ participant: 0, stakeholder: 0, independent: 0 })).toBe(
			'no confirmations'
		);
	});
});
