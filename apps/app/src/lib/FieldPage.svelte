<!--
  FieldPage: the frame of one App page built on the design system. A single column at the
  design's width, with an optional bar of actions stuck to the bottom of the screen and, on the
  home page, the phone's tab bar.

  <FieldPage>
    <h1>…</h1>
    {#snippet actions()}<Button variant="primary" size="field" block>…</Button>{/snippet}
  </FieldPage>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import MobileNav from './MobileNav.svelte';

	let {
		children,
		actions = undefined,
		tabs = undefined
	}: {
		children: Snippet;
		/** The page's primary action, kept in reach of a thumb. */
		actions?: Snippet;
		/** The phone's tab bar. Only on the home page: a task flow has no tab bar. */
		tabs?: { current: string; incompleteReports: number };
	} = $props();
</script>

<div class="tj-fieldpage app-page">
	{@render children()}
	{#if actions || tabs}
		<div class="app-dock">
			{#if actions}<div class="tj-stickyactions">{@render actions()}</div>{/if}
			{#if tabs}<MobileNav {...tabs} />{/if}
		</div>
	{/if}
</div>

<style>
	/* The layout's <main> hands its whole height to the page, so the dock rests at the bottom of
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
		position: sticky;
		bottom: 0;
		z-index: 5;
		/* Pushed to the bottom of the page, and out to its edges through the page's padding. */
		margin: auto calc(-1 * var(--space-4)) calc(-1 * var(--space-8));
	}
	.app-dock > :global(.tj-stickyactions),
	.app-dock > :global(.tj-tabbar) {
		position: static;
	}
	.app-dock > :global(.tj-stickyactions) {
		padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom, 0px));
	}
	.app-dock > :global(.tj-stickyactions:has(+ .tj-tabbar)) {
		padding-bottom: var(--space-3);
	}
	@container (min-width: 900px) {
		.app-page {
			padding-top: var(--space-8);
		}
		.app-dock {
			border-inline: var(--border-hair) solid var(--border);
			border-radius: var(--radius-lg) var(--radius-lg) 0 0;
			overflow: hidden;
		}
	}
</style>
