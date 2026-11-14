<!-- Everything here is SVG, including the elements the icon is drawn from. -->
<svelte:options namespace="svg" />

<script lang="ts">
	import { ICON_NODES, type IconNode } from './icon-nodes.ts';
	import type { IconName } from './icons.ts';

	let {
		name,
		size = 20,
		label = undefined,
		class: className = ''
	}: { name: IconName; size?: number; label?: string; class?: string } = $props();
</script>

<!--
  Inline SVG icon from Tejido's set. Decorative by default; pass `label` when the icon stands alone.
  Usage: <Icon name="receipt-check" size={16} />
-->

{#snippet draw(nodes: IconNode[])}
	{#each nodes as node, i (i)}
		<svelte:element this={node.tag} {...node.attrs}>
			{@render draw(node.children)}
		</svelte:element>
	{/each}
{/snippet}

<svg
	class={['tj-icon', className]}
	data-icon={name}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="1.75"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	{@render draw(ICON_NODES[name])}
</svg>
