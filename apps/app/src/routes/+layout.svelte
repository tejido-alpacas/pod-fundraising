<script lang="ts">
	// The design system: tokens, the component stylesheet, then the first site's look (its fonts,
	// blues, page colour and corners: packages/ui/src/first-site.css). Light only.
	import '@tejido/ui/styles.css';
	// Temporary: keeps pages not yet rebuilt on the design system looking right, and keeps the old
	// variable names (--bg, --ink, --muted, --line, --a, --b, --c, --warn) as aliases of the new tokens.
	import '@tejido/ui/legacy.css';
	import { page } from '$app/state';
	import { FieldHeader } from '@tejido/ui';
	import { BRAND_NAME, LOGO } from '#lib/brand.ts';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Only pages this person can use. Someone who is not on a campaign has nothing to file.
	const links = $derived.by(() => {
		const party = data.nav?.party;
		if (!party) return [];
		// "Fix reports" is always here; the count shows only when there is something to fix.
		return [
			{ href: '/', label: 'Home' },
			{ href: '/chat', label: 'File a report' },
			{ href: '/upload', label: 'Upload' },
			{
				href: '/fix',
				label:
					party.incompleteReports > 0 ? `Fix reports (${party.incompleteReports})` : 'Fix reports'
			}
		];
	});
</script>

<!-- The first site's fonts and icons, as the Campaign Site loads them. The theme colour is the
     header's white: the App is light only. -->
<svelte:head>
	<link rel="icon" href="/tejido-favicon.svg" type="image/svg+xml" />
	<link rel="icon" href="/tejido-app-icon-192.png" type="image/png" sizes="192x192" />
	<link rel="apple-touch-icon" href="/tejido-app-icon-180.png" />
	<meta name="theme-color" content="#ffffff" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="anonymous" />
	<link
		href="https://fonts.googleapis.com/css2?family=Poppins:wght@600;700&family=Rubik:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

<!-- The root is a size container so components can respond to it as they do in the previews. -->
<div class="tj-screen">
	<FieldHeader
		title={BRAND_NAME}
		logo={LOGO}
		subtitle={data.nav ? (data.nav.party?.name ?? data.nav.email) : undefined}
		subtitleTitle={data.nav?.email}
		{links}
		current={page.url.pathname}
	>
		{#snippet end()}
			{#if data.nav}
				<form method="POST" action="/auth/sign-out">
					<button type="submit" class="tj-btn tj-btn--quiet tj-btn--field">Sign out</button>
				</form>
			{:else}
				<a class="tj-btn tj-btn--secondary tj-btn--field" href="/auth/sign-in">Sign in</a>
			{/if}
		{/snippet}
	</FieldHeader>

	<!-- The one <main>. A page built on the design system starts with <div class="tj-fieldpage">. -->
	<main>
		{@render children()}
	</main>
</div>

<style>
	/* Temporary, for pages not yet rebuilt. Things a thumb has to hit are at least 44px tall. */
	:global(button, a.button) {
		min-height: 2.75rem;
		box-sizing: border-box;
	}
	:global(summary) {
		padding-block: 0.65rem;
	}
	:global(input[type='file']) {
		min-height: 2.75rem;
	}
	:global(input[type='file']::file-selector-button) {
		font: inherit;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		margin-right: 0.75rem;
		color: var(--text-primary);
		background: var(--surface);
		border: 1px solid var(--border);
		border-radius: 6px;
		cursor: pointer;
	}
</style>
