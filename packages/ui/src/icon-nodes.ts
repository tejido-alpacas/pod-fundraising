/**
 * The icons in `icons.ts` are strings of SVG markup, as the design system generates them. This
 * turns each one into a small tree of elements so `Icon.svelte` can render real SVG elements
 * and never injects raw HTML.
 *
 * It understands exactly what the icon set uses: elements with double-quoted attributes, either
 * self-closing or with children. Anything else throws when the module loads, so a bad icon
 * fails the tests, never a page.
 */
import { ICONS, type IconName } from './icons.ts';

export interface IconNode {
	tag: string;
	attrs: Record<string, string>;
	children: IconNode[];
}

const TOKEN = /<\/([a-z]+)>|<([a-z]+)((?:\s+[a-z-]+="[^"]*")*)\s*(\/?)>/gy;
const ATTRIBUTE = /([a-z-]+)="([^"]*)"/g;

export function parseIcon(markup: string): IconNode[] {
	const root: IconNode = { tag: 'svg', attrs: {}, children: [] };
	const open: IconNode[] = [root];
	TOKEN.lastIndex = 0;
	let at = 0;
	while (at < markup.length) {
		TOKEN.lastIndex = at;
		const token = TOKEN.exec(markup);
		const parent = open.at(-1);
		if (!token || !parent) throw new Error(`Icon markup not understood at ${at}: ${markup}`);
		at = TOKEN.lastIndex;
		const [, closing, tag, attributes, selfClosing] = token;
		if (closing !== undefined) {
			if (open.length < 2 || parent.tag !== closing) {
				throw new Error(`Icon markup closes <${closing}> out of turn: ${markup}`);
			}
			open.pop();
			continue;
		}
		if (tag === undefined) throw new Error(`Icon markup not understood at ${at}: ${markup}`);
		const node: IconNode = { tag, attrs: {}, children: [] };
		for (const [, name, value] of (attributes ?? '').matchAll(ATTRIBUTE)) {
			if (name !== undefined && value !== undefined) node.attrs[name] = value;
		}
		parent.children.push(node);
		if (selfClosing !== '/') open.push(node);
	}
	if (open.length !== 1) throw new Error(`Icon markup leaves an element open: ${markup}`);
	return root.children;
}

function parseAll(): Record<IconName, IconNode[]> {
	const names = Object.keys(ICONS) as IconName[];
	const nodes = {} as Record<IconName, IconNode[]>;
	for (const name of names) nodes[name] = parseIcon(ICONS[name]);
	return nodes;
}

export const ICON_NODES: Record<IconName, IconNode[]> = parseAll();
