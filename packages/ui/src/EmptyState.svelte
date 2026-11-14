<!--
  EmptyState: what a list shows when nothing is in it yet. Say why it is empty and when it will
  fill. Add an action only if the person can do something about it. Never an illustration.

  <EmptyState icon="list" title="No updates yet">
    Work starts once the campaign is funded. You’ll see each work log here.
  </EmptyState>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.ts';

	let {
		icon = 'list',
		title,
		children,
		action = undefined
	}: {
		icon?: IconName;
		title: string;
		/** Why it is empty and when it will fill. */
		children: Snippet;
		action?: Snippet;
	} = $props();
</script>

<div class="tj-empty">
	<Icon name={icon} />
	<p class="tj-empty__title">{title}</p>
	<p class="tj-empty__text">{@render children()}</p>
	{#if action}{@render action()}{/if}
</div>
