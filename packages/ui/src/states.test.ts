import {
	entryStatusSchema,
	milestoneStateSchema,
	type EntryStatus,
	type MilestoneState
} from '@tejido/contracts';
import { describe, expect, it } from 'vitest';
import { ICONS } from './icons.ts';
import {
	STATES,
	confirmationStrength,
	daysOverdue,
	depositState,
	filingState,
	milestoneState,
	shortId,
	type StateKey
} from './states.ts';

describe('the vocabulary', () => {
	it('gives every state a label, a sentence and an icon that exists', () => {
		for (const [key, def] of Object.entries(STATES)) {
			expect(def.label, key).not.toBe('');
			expect(def.text, key).not.toBe('');
			expect(ICONS, key).toHaveProperty(def.icon);
		}
	});

	it('keeps each layer to its own icon shapes', () => {
		for (const def of Object.values(STATES)) {
			if (def.layer === 'Filing') expect(def.icon).toMatch(/^receipt-/);
			if (def.layer === 'Milestone') expect(def.icon).toMatch(/^ms-/);
			if (def.layer === 'Confirmation') expect(def.icon).toMatch(/^conf-/);
			if (def.layer !== 'Filing') expect(def.icon).not.toMatch(/^receipt-/);
			if (def.layer !== 'Milestone') expect(def.icon).not.toMatch(/^ms-/);
			if (def.layer !== 'Confirmation') expect(def.icon).not.toMatch(/^conf-/);
		}
	});

	it('draws only Confirmed solid and only Claimed complete dashed', () => {
		const solid = Object.entries(STATES).filter(([, d]) => 'solid' in d && d.solid);
		const dashed = Object.entries(STATES).filter(([, d]) => 'dashed' in d && d.dashed);
		expect(solid.map(([k]) => k)).toEqual(['confirmed']);
		expect(dashed.map(([k]) => k)).toEqual(['claimed']);
		expect(STATES.claimed.tone).toBe('neutral');
		expect(STATES.confirmed.tone).toBe('confirmed');
	});

	it('never calls a verified receipt just "Verified"', () => {
		expect(STATES.verified.label).toBe('Receipt verified');
		expect(STATES.verified.tone).toBe('record');
		expect(STATES.verified.text).toContain('It does not prove the work');
	});
});

describe('filingState: every entry status in the contract', () => {
	const expected: Record<
		EntryStatus,
		{ key: StateKey; label: string; tone: string; icon: string }
	> = {
		filed: { key: 'pending', label: 'Receipt pending', tone: 'neutral', icon: 'receipt-clock' },
		verified: {
			key: 'verified',
			label: 'Receipt verified',
			tone: 'record',
			icon: 'receipt-check'
		},
		flagged: { key: 'flagged', label: 'Flagged', tone: 'critical', icon: 'receipt-flag' },
		incomplete: {
			key: 'incomplete',
			label: 'Incomplete',
			tone: 'attention',
			icon: 'receipt-missing'
		}
	};

	it.each(entryStatusSchema.options)('%s', (status) => {
		const key = filingState({ status });
		const want = expected[status];
		expect(key).toBe(want.key);
		expect(STATES[key]).toMatchObject({
			layer: 'Filing',
			label: want.label,
			tone: want.tone,
			icon: want.icon
		});
	});
});

describe('milestoneState: every milestone state in the contract', () => {
	const expected: Record<
		MilestoneState,
		{ withEntries: StateKey; withoutEntries: StateKey; label: string; tone: string; icon: string }
	> = {
		open: {
			withEntries: 'in-progress',
			withoutEntries: 'not-started',
			label: 'In progress',
			tone: 'progress',
			icon: 'ms-in-progress'
		},
		claimed: {
			withEntries: 'claimed',
			withoutEntries: 'claimed',
			label: 'Claimed complete',
			tone: 'neutral',
			icon: 'ms-claimed'
		},
		confirmed_independent: {
			withEntries: 'confirmed',
			withoutEntries: 'confirmed',
			label: 'Confirmed',
			tone: 'confirmed',
			icon: 'ms-confirmed'
		},
		confirmed_creator: {
			withEntries: 'confirmed',
			withoutEntries: 'confirmed',
			label: 'Confirmed',
			tone: 'confirmed',
			icon: 'ms-confirmed'
		}
	};

	it.each(milestoneStateSchema.options)('%s', (state) => {
		const want = expected[state];
		const key = milestoneState({ state }, true);
		expect(key).toBe(want.withEntries);
		expect(milestoneState({ state }, false)).toBe(want.withoutEntries);
		expect(STATES[key]).toMatchObject({
			layer: 'Milestone',
			label: want.label,
			tone: want.tone,
			icon: want.icon
		});
	});

	it('shows an open milestone with no entries as Not started', () => {
		expect(STATES[milestoneState({ state: 'open' }, false)]).toMatchObject({
			label: 'Not started',
			tone: 'neutral',
			icon: 'ms-not-started'
		});
	});
});

describe('overdue', () => {
	it('is not a milestone state in the contract, and milestoneState never returns it', () => {
		expect(milestoneStateSchema.options).not.toContain('overdue');
		for (const state of milestoneStateSchema.options) {
			for (const hasEntries of [true, false]) {
				expect(milestoneState({ state }, hasEntries)).not.toBe('overdue');
			}
		}
	});

	it('is derived from the due date and today', () => {
		expect(daysOverdue({ state: 'open', dueDate: '2026-11-06' }, '2026-11-14')).toBe(8);
		expect(daysOverdue({ state: 'claimed', dueDate: '2026-11-13' }, '2026-11-14')).toBe(1);
		expect(daysOverdue({ state: 'open', dueDate: '2026-11-14' }, '2026-11-14')).toBe(0);
		expect(daysOverdue({ state: 'open', dueDate: '2026-11-20' }, '2026-11-14')).toBe(0);
	});

	it('never applies to a confirmed milestone, however late it was', () => {
		expect(
			daysOverdue({ state: 'confirmed_independent', dueDate: '2026-01-01' }, '2026-11-14')
		).toBe(0);
		expect(daysOverdue({ state: 'confirmed_creator', dueDate: '2026-01-01' }, '2026-11-14')).toBe(
			0
		);
	});

	it('is shown in the critical tone with its own clock shape', () => {
		expect(STATES.overdue).toMatchObject({
			layer: 'Milestone',
			tone: 'critical',
			icon: 'ms-overdue',
			label: 'Overdue'
		});
	});
});

describe('confirmationStrength', () => {
	const confirmer = { id: 'party-confirmer' };

	it('shows an unknown relationship as stakeholder, never independent', () => {
		expect(confirmationStrength({ state: 'confirmed_independent' }, confirmer)).toBe('stakeholder');
		expect(confirmationStrength({ state: 'confirmed_independent' }, undefined)).toBe('stakeholder');
	});

	it('uses the relationship when one is recorded', () => {
		for (const relationship of ['participant', 'stakeholder', 'independent'] as const) {
			expect(
				confirmationStrength({ state: 'confirmed_independent' }, { ...confirmer, relationship })
			).toBe(relationship);
		}
	});

	it('always shows a creator sign-off as participant', () => {
		expect(
			confirmationStrength(
				{ state: 'confirmed_creator' },
				{ ...confirmer, relationship: 'independent' }
			)
		).toBe('participant');
	});

	it('has no strength before a milestone is confirmed', () => {
		expect(confirmationStrength({ state: 'open' }, confirmer)).toBeNull();
		expect(confirmationStrength({ state: 'claimed' }, confirmer)).toBeNull();
	});

	it('labels the three strengths as categories with people shapes', () => {
		expect(STATES.participant).toMatchObject({ threads: 1, icon: 'conf-participant' });
		expect(STATES.stakeholder).toMatchObject({ threads: 2, icon: 'conf-stakeholder' });
		expect(STATES.independent).toMatchObject({ threads: 3, icon: 'conf-independent' });
	});
});

describe('depositState', () => {
	it('maps held, refunded and outstanding', () => {
		expect(depositState({ refundedAt: null }, false)).toBe('dep-held');
		expect(depositState({ refundedAt: null }, true)).toBe('dep-outstanding');
		expect(depositState({ refundedAt: '2026-11-01T10:00:00.000Z' }, true)).toBe('dep-refunded');
		expect(STATES['dep-refunded'].tone).toBe('confirmed');
		expect(STATES['dep-outstanding'].tone).toBe('attention');
	});
});

describe('shortId', () => {
	it('shortens long identifiers to the first 8 and last 6 characters', () => {
		expect(shortId('4167976f0123456789abcdef0123456789abcdef0123456789abcdef00e0516d')).toBe(
			'4167976f…e0516d'
		);
		expect(shortId('ent-m2-log-1')).toBe('ent-m2-log-1');
	});
});
