<script lang="ts">
	// The design system: tokens, then the component stylesheet. Light only.
	import '@tejido/ui/styles.css';
	// Temporary: keeps pages not yet rebuilt on the design system looking right, and keeps the old
	// variable names (--bg, --ink, --muted, --line, --a, --b, --c, --warn) as aliases of the new tokens.
	import '@tejido/ui/legacy.css';
	import { page } from '$app/state';
	import { FieldHeader } from '@tejido/ui';
	import HeaderMenu from '#lib/HeaderMenu.svelte';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	// One header for the whole App. A page's load may return its own `header`; otherwise it is
	// the layout's: the project and the person for a signed-in party, "Tejido" for anyone else.
	const header = $derived(page.data.header);

	// Only pages this person can use. Someone who is not on a campaign has nothing to file.
	const links = $derived.by(() => {
		const party = data.nav?.party;
		if (!party) return [{ href: '/', label: 'Home' }];
		const list = [
			{ href: '/', label: 'Home' },
			{ href: '/chat', label: 'File a report' },
			{ href: '/chat?form', label: 'Fill in a report form' },
			{ href: '/upload', label: 'Upload evidence' }
		];
		if (party.incompleteReports > 0) {
			list.push({
				href: '/fix',
				label:
					party.incompleteReports === 1
						? 'Fix an incomplete report'
						: `Fix incomplete reports (${party.incompleteReports})`
			});
		}
		return list;
	});
</script>

<!-- The root is a size container so components can respond to it as they do in the previews. -->
<div class="tj-screen">
	<FieldHeader
		title={header?.title ?? 'Tejido'}
		subtitle={header?.subtitle ?? data.nav?.email}
		subtitleTitle={data.nav?.email}
		back={header?.backHref}
	>
		{#snippet end()}
			{#if data.nav}
				<HeaderMenu {links} current={page.url.pathname} />
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
