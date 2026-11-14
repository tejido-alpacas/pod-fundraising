<script lang="ts">
	// The design system: tokens, then the component stylesheet. Light only.
	import '@tejido/ui/styles.css';
	// Temporary: keeps pages not yet rebuilt on the design system looking right, and keeps the old
	// variable names (--bg, --ink, --muted, --line, --a, --b, --c, --warn) as aliases of the new tokens.
	import '@tejido/ui/legacy.css';
	import { page } from '$app/state';
	import { FieldHeader } from '@tejido/ui';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// Only pages this person can use. Someone who is not on a campaign has nothing to file.
	const links = $derived.by(() => {
		const party = data.nav?.party;
		if (!party) return [];
		const list = [
			{ href: '/', label: 'Home' },
			{ href: '/chat', label: 'File a report' },
			{ href: '/upload', label: 'Upload' }
		];
		if (party.incompleteReports > 0) {
			list.push({ href: '/fix', label: `Fix reports (${party.incompleteReports})` });
		}
		return list;
	});
</script>

<!-- The root is a size container so components can respond to it as they do in the previews. -->
<div class="tj-screen">
	<FieldHeader
		title="Tejido"
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
