import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import FieldHeader from './FieldHeader.svelte';

const logo = { src: '/logo.svg', width: 125, height: 30, standsForTitle: true };

describe('FieldHeader', () => {
	it('draws the weave mark and the title when no logo is given', () => {
		const { body } = render(FieldHeader, { props: { title: 'Tejido' } });
		expect(body).toContain('class="tj-fieldheader__home"');
		expect(body).toContain('<svg');
		expect(body).not.toContain('<img');
		expect(body).toContain('<p>Tejido</p>');
	});

	it('draws a logo in the home link instead of the mark', () => {
		const { body } = render(FieldHeader, {
			props: {
				title: 'Rebuild the library wing',
				logo: { src: '/mark.svg', width: 32, height: 32 }
			}
		});
		expect(body).toContain('<img src="/mark.svg" alt="" width="32" height="32"');
		expect(body).toContain('aria-label="Tejido home"');
		expect(body).toContain('<p>Rebuild the library wing</p>');
	});

	it('keeps the title for screen readers when the logo stands for it', () => {
		const { body } = render(FieldHeader, { props: { title: 'Tejido', logo } });
		expect(body).toContain('<p class="tj-vh">Tejido</p>');
	});

	it('shows the back arrow, not the logo, inside a flow', () => {
		const { body } = render(FieldHeader, { props: { title: 'Add evidence', back: '/', logo } });
		expect(body).toContain('aria-label="Back"');
		expect(body).not.toContain('<img');
		expect(body).toContain('<p>Add evidence</p>');
	});
});
