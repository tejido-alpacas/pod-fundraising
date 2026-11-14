import { render } from 'svelte/server';
import { describe, expect, it } from 'vitest';
import { ICON_NODES, parseIcon, type IconNode } from './icon-nodes.ts';
import Icon from './Icon.svelte';
import { ICONS, type IconName } from './icons.ts';

const names = Object.keys(ICONS) as IconName[];

/** Writes a parsed icon back out, in the form the design system generates. */
function write(nodes: IconNode[]): string {
	return nodes
		.map((node) => {
			const attrs = Object.entries(node.attrs)
				.map(([name, value]) => ` ${name}="${value}"`)
				.join('');
			return node.children.length > 0
				? `<${node.tag}${attrs}>${write(node.children)}</${node.tag}>`
				: `<${node.tag}${attrs}/>`;
		})
		.join('');
}

describe('the icon set', () => {
	it.each(names)('%s is parsed without losing anything', (name) => {
		// The generated markup has the odd stray space before "/>"; nothing else may differ.
		expect(write(ICON_NODES[name])).toBe(ICONS[name].replaceAll(' />', '/>'));
		expect(ICON_NODES[name].length).toBeGreaterThan(0);
	});

	it('refuses markup it does not understand', () => {
		expect(() => parseIcon('<path d="M0 0"/><script>')).toThrow();
		expect(() => parseIcon('<g><path d="M0 0"/>')).toThrow();
		expect(() => parseIcon('hello')).toThrow();
	});
});

describe('Icon', () => {
	it('is decorative unless it is given a label', () => {
		const { body } = render(Icon, { props: { name: 'receipt-check' } });
		expect(body).toContain('aria-hidden="true"');
		expect(body).not.toContain('role="img"');
		expect(body).toContain('<path d="M6 3h12v18l-2-1.5L14 21l-2-1.5L10 21l-2-1.5L6 21z"');
	});

	it('is announced when it stands alone', () => {
		const { body } = render(Icon, { props: { name: 'weave', label: 'Tejido' } });
		expect(body).toContain('role="img"');
		expect(body).toContain('aria-label="Tejido"');
		expect(body).not.toContain('aria-hidden');
	});
});
