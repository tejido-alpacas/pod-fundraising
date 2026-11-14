<script lang="ts">
	import { page } from '$app/state';
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

<header>
	<div class="bar">
		<a class="brand" href="/">Tejido</a>
		{#if data.nav}
			<span class="who" title={data.nav.email}>{data.nav.party?.name ?? data.nav.email}</span>
			<form method="POST" action="/auth/sign-out">
				<button type="submit">Sign out</button>
			</form>
		{:else}
			<a class="sign-in" href="/auth/sign-in">Sign in</a>
		{/if}
	</div>
	{#if links.length > 0}
		<nav aria-label="Main">
			{#each links as link (link.href)}
				<a href={link.href} aria-current={page.url.pathname === link.href ? 'page' : undefined}>
					{link.label}
				</a>
			{/each}
		</nav>
	{/if}
</header>

<main>
	{@render children()}
</main>

<style>
	:global(:root) {
		--bg: #f3f5f7;
		--surface: #ffffff;
		--ink: #16212b;
		--muted: #566573;
		--line: #d5dce3;
		--a: #0b6e69;
		--b: #3d4fa3;
		--c: #8a5a00;
		--warn: #a8321c;
		color-scheme: light;
	}
	:global(body) {
		margin: 0;
		background: var(--bg);
		color: var(--ink);
		font:
			16px/1.55 system-ui,
			-apple-system,
			'Segoe UI',
			sans-serif;
	}
	:global(h1, h2, h3) {
		line-height: 1.2;
		text-wrap: balance;
	}
	:global(h1) {
		font-size: 2rem;
		margin: 0.25rem 0 0.5rem;
	}
	:global(h2) {
		font-size: 1.25rem;
		margin-top: 2rem;
	}
	:global(code) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.88em;
		background: var(--line);
		padding: 1px 5px;
		border-radius: 4px;
		overflow-wrap: anywhere;
	}
	:global(a) {
		color: var(--a);
	}
	:global(.eyebrow) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
		margin: 0;
	}
	/* Things a thumb has to hit are at least 44px tall, on every page. */
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
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 6px;
		cursor: pointer;
	}
	header {
		border-bottom: 1px solid var(--line);
		background: var(--surface);
	}
	.bar,
	nav {
		max-width: 64rem;
		margin: 0 auto;
		padding: 0 1rem;
	}
	.bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		min-height: 3.25rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		margin-right: auto;
		font-weight: 700;
		font-size: 1.15rem;
		color: var(--ink);
		text-decoration: none;
	}
	.who {
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.bar form {
		margin: 0;
		flex: none;
	}
	.bar button,
	.sign-in {
		display: inline-flex;
		align-items: center;
		box-sizing: border-box;
		min-height: 2.75rem;
		font: inherit;
		font-size: 0.9rem;
		font-weight: 600;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0 0.9rem;
		text-decoration: none;
		cursor: pointer;
	}
	nav {
		display: flex;
		gap: 0 0.25rem;
		overflow-x: auto;
		white-space: nowrap;
	}
	nav a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 0.5rem;
		font-size: 0.95rem;
		font-weight: 600;
		color: var(--muted);
		text-decoration: none;
		border-bottom: 3px solid transparent;
	}
	nav a:first-child {
		padding-left: 0;
	}
	nav a[aria-current='page'] {
		color: var(--ink);
		border-bottom-color: var(--a);
	}
	main {
		max-width: 64rem;
		margin: 0 auto;
		padding: 1.5rem 1rem 4rem;
	}
</style>
