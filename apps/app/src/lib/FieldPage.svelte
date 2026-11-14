<!--
  FieldPage: the body of one App page, as the design draws a field screen. A single column at the
  design's width, with the page's one primary action in a bar stuck to the bottom of the screen.
  The header above it belongs to the layout: a page names itself by returning `header` from its
  load.

  <FieldPage>
    …
    {#snippet actions()}<Button variant="primary" size="field" block>…</Button>{/snippet}
  </FieldPage>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		children,
		actions = undefined
	}: {
		children: Snippet;
		/** The page's primary action, kept in reach of a thumb. */
		actions?: Snippet;
	} = $props();
</script>

<div class="tj-fieldpage app-page">
	{@render children()}
	{#if actions}
		<div class="app-dock tj-stickyactions">{@render actions()}</div>
	{/if}
</div>

<style>
	/* The layout's <main> hands its whole height to the page, so the bar rests at the bottom of
	   the screen on a short page too. */
	:global(main:has(> .app-page)) {
		display: flex;
		flex-direction: column;
	}
	.app-page {
		display: flex;
		flex-direction: column;
		flex: 1 0 auto;
		width: 100%;
		max-width: var(--layout-chat);
		margin-inline: auto;
	}
	.app-page > :global(*) {
		min-width: 0;
		flex: none;
	}
	.app-dock {
		z-index: 5;
		/* Pushed to the bottom of the page, and out to its edges through the page's padding. */
		margin: auto calc(-1 * var(--space-4)) calc(-1 * var(--space-8));
		padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
	}
	@container (min-width: 900px) {
		.app-page {
			padding-top: var(--space-8);
		}
		.app-dock {
			border-inline: var(--border-hair) solid var(--border);
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
		}
	}
</style>
