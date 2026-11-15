<!--
  FieldPage: the frame of one App page, as the design draws a field screen. The header names the
  page (with a back arrow inside a task), the content is a single column at the design's width,
  and the page's one primary action sits in a bar stuck to the bottom of the screen. The home
  page also gets the phone's tab bar.

  <FieldPage title="Add evidence" subtitle="Coral Ridge Builders" back="/">
    …
    {#snippet actions()}<Button variant="primary" size="field" block>…</Button>{/snippet}
  </FieldPage>
-->
<script lang="ts">
	import { page } from '$app/state';
	import { FieldHeader } from '@tejido/ui';
	import type { Snippet } from 'svelte';
	import { BRAND_NAME, LOGO, MARK } from './brand.ts';
	import MobileNav from './MobileNav.svelte';

	let {
		title,
		subtitle = undefined,
		back = undefined,
		children,
		actions = undefined,
		tabs = undefined
	}: {
		title: string;
		subtitle?: string;
		/** Inside a task: where the back arrow goes. It replaces the logo. */
		back?: string;
		children: Snippet;
		/** The page's primary action, kept in reach of a thumb. */
		actions?: Snippet;
		/** The phone's tab bar. Only on the home page: a task flow has no tab bar. */
		tabs?: { current: string; incompleteReports: number };
	} = $props();

	// The first site's logo. Where the header's title is the product's own name the full logo
	// stands in for it; where the title is the project's name, the mark sits beside it.
	const logo = $derived(title === BRAND_NAME ? LOGO : MARK);

	// From 900px there is no tab bar, so the home page's header carries the same links.
	const links = $derived.by(() => {
		if (!tabs) return [];
		// "Fix reports" is always here; the count shows only when there is something to fix.
		return [
			{ href: '/', label: 'Home' },
			{ href: '/chat', label: 'File a report' },
			{ href: '/upload', label: 'Add evidence' },
			{
				href: '/fix',
				label:
					tabs.incompleteReports > 0 ? `Fix reports (${tabs.incompleteReports})` : 'Fix reports'
			}
		];
	});
</script>

<div class="tj-fieldapp app-frame">
	<FieldHeader {title} {subtitle} {back} {logo} {links} current={tabs?.current}>
		{#snippet end()}
			{#if page.data.nav}
				<form method="POST" action="/auth/sign-out">
					<button type="submit" class="tj-btn tj-btn--quiet tj-btn--field">Sign out</button>
				</form>
			{/if}
		{/snippet}
	</FieldHeader>
	<div class="tj-fieldpage app-page">
		{@render children()}
		{#if actions || tabs}
			<div class="app-dock">
				{#if actions}<div class="tj-stickyactions">{@render actions()}</div>{/if}
				{#if tabs}<MobileNav {...tabs} />{/if}
			</div>
		{/if}
	</div>
</div>

<style>
	/* The layout's <main> hands its whole height to the page, so the dock rests at the bottom of
	   the screen on a short page too. */
	:global(main:has(> .app-frame)) {
		display: flex;
		flex-direction: column;
	}
	/* This page names itself in its own header, as the design draws it. The layout's general
	   header and its row of links stand down while a page built on this frame is showing. */
	:global(.tj-screen:has(.app-frame) > .tj-fieldheader),
	:global(.tj-screen:has(.app-frame) > .tj-fieldnav) {
		display: none;
	}
	.app-frame {
		display: flex;
		flex-direction: column;
		flex: 1 0 auto;
		min-height: 0;
	}
	/* The design's header is 60px. A 48px control inside it needs the smaller padding to fit. */
	.app-frame > :global(.tj-fieldheader) {
		padding-block: var(--space-1);
	}
	/* Below 900px the tab bar is the navigation; the links under the header are for wide screens. */
	.app-frame > :global(.tj-fieldnav) {
		display: none;
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
		.app-frame > :global(.tj-fieldnav) {
			display: flex;
			justify-content: center;
		}
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
