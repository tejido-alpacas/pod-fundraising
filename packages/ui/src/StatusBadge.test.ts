import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import StatusBadge from './StatusBadge.svelte';
import { STATES, type StateKey } from './states.ts';

const keys = Object.keys(STATES) as StateKey[];

describe('StatusBadge', () => {
	it.each(keys)('%s: its layer is read out before its label, with its tone and icon', (state) => {
		const def = STATES[state];
		const { body } = render(StatusBadge, { props: { state } });

		// The layer is in the page for screen readers and hidden from sight.
		expect(body).toContain(`<span class="tj-vh">${def.layer}: </span>${def.label}`);
		expect(body).toContain(`tj-tone--${def.tone}`);
		expect(body).toContain(`data-icon="${def.icon}"`);
	});

	it('draws Confirmed solid and nothing else', () => {
		for (const state of keys) {
			const { body } = render(StatusBadge, { props: { state } });
			expect(body.includes('tj-badge--solid'), state).toBe(state === 'confirmed');
		}
	});

	it('draws Claimed complete dashed and nothing else', () => {
		for (const state of keys) {
			const { body } = render(StatusBadge, { props: { state } });
			expect(body.includes('tj-badge--dashed'), state).toBe(state === 'claimed');
		}
	});

	it('keeps the layer prefix when the label is overridden', () => {
		const { body } = render(StatusBadge, {
			props: { state: 'overdue', label: 'Overdue · 8 days' }
		});
		expect(body).toContain('<span class="tj-vh">Milestone: </span>Overdue · 8 days');
	});

	it('drops the fill in plain form but keeps the words', () => {
		const { body } = render(StatusBadge, {
			props: { state: 'independent', label: 'Independent', plain: true }
		});
		expect(body).toContain('tj-badge--plain');
		expect(body).toContain('<span class="tj-vh">Confirmation: </span>Independent');
	});
});
