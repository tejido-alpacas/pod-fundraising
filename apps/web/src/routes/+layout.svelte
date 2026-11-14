<script lang="ts">
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();
</script>

<header>
	<a class="brand" href="/">Tejido</a>
	<span>Fundraising with proof of delivery</span>
</header>

<main>
	{@render children()}
</main>

<footer>
	<p>Tejido shows donors what was reported on a project, who reported it and who confirmed it.</p>
	<p><a href="/">All campaigns</a></p>
</footer>

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
	/* A link that stands alone on its line gets a tap area at least 44px tall. */
	:global(a.tap) {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		min-width: 2.75rem;
	}
	:global(.eyebrow) {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.8rem;
		letter-spacing: 0.05em;
		text-transform: uppercase;
		color: var(--muted);
		margin: 0;
	}
	header {
		display: flex;
		flex-wrap: wrap;
		gap: 0 1rem;
		align-items: center;
		padding: 0.25rem 1rem;
		border-bottom: 1px solid var(--line);
		background: var(--surface);
		color: var(--muted);
		font-size: 0.9rem;
	}
	.brand {
		display: inline-flex;
		align-items: center;
		min-width: 2.75rem;
		min-height: 2.75rem;
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--ink);
		text-decoration: none;
	}
	main {
		max-width: 64rem;
		margin: 0 auto;
		padding: 2rem 1rem 3rem;
		min-height: calc(100vh - 14rem);
	}
	footer {
		border-top: 1px solid var(--line);
		padding: 1rem 1rem 2rem;
		color: var(--muted);
		font-size: 0.9rem;
	}
	footer p {
		max-width: 64rem;
		margin: 0 auto;
	}
	footer a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
</style>
