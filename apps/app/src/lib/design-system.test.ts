import { StatusBadge } from '@tejido/ui';
import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';

// Proves this app can compile and render a component from the shared design system package.
describe('@tejido/ui in this app', () => {
	it('renders a StatusBadge with its hidden layer name', () => {
		const { body } = render(StatusBadge, { props: { state: 'verified' } });
		expect(body).toContain('<span class="tj-vh">Filing: </span>Receipt verified');
		expect(body).toContain('tj-tone--record');
	});
});
