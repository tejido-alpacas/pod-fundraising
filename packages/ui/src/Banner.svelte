<!--
  Banner: a page-level message. One per page region. Critical (overdue, flagged) gets the top rule.
  Say what happened in the title, what is known and what is blocked in the body.

  <Banner tone="critical" icon="ms-overdue" title="Window and door frames are 8 days overdue" role="note">
    The supplier expects the rest by 19 Nov.
    {#snippet actions()}<Button size="sm" href="/…">View milestone 4</Button>{/snippet}
  </Banner>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from './icons.ts';
	import type { Tone } from './states.ts';

	let {
		tone = 'neutral',
		icon = 'info',
		title,
		role = undefined,
		children = undefined,
		actions = undefined
	}: {
		tone?: Tone;
		icon?: IconName;
		title: string;
		/** `alert` only for errors the person must act on; `note` for flags. */
		role?: 'alert' | 'note' | 'status';
		children?: Snippet;
		actions?: Snippet;
	} = $props();
</script>

<div class={['tj-banner', `tj-tone--${tone}`, tone === 'critical' && 'tj-banner--critical']} {role}>
	<Icon name={icon} />
	<p class="tj-banner__title">{title}</p>
	{#if children}<p class="tj-banner__body">{@render children()}</p>{/if}
	{#if actions}<div class="tj-banner__actions">{@render actions()}</div>{/if}
</div>
