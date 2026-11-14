<script lang="ts">
	// The way around one campaign: the same three links, in the same place, on every page of
	// it. The page a donor is on is marked, and the campaign's name leads back to its timeline.
	type Section = 'timeline' | 'milestones' | 'report';

	let {
		campaignId,
		title,
		current
	}: {
		campaignId: string;
		title: string;
		/** The section this page is, or null for a page under one, such as an entry's proof. */
		current: Section | null;
	} = $props();

	const base = $derived(`/campaigns/${campaignId}`);
	const links = $derived<{ section: Section; label: string; href: string }[]>([
		{ section: 'timeline', label: 'Timeline', href: base },
		{ section: 'milestones', label: 'Milestones', href: `${base}/milestones` },
		{ section: 'report', label: 'Report', href: `${base}/report` }
	]);
</script>

<nav class="campaign-nav" aria-label="This campaign">
	<p class="trail">
		<a href="/">All campaigns</a>
		<span aria-hidden="true">/</span>
		{#if current === 'timeline'}
			<span>{title}</span>
		{:else}
			<a href={base}>{title}</a>
		{/if}
	</p>
	<ul>
		{#each links as link (link.section)}
			<li>
				<a href={link.href} aria-current={current === link.section ? 'page' : undefined}>
					{link.label}
				</a>
			</li>
		{/each}
	</ul>
</nav>

<style>
	.campaign-nav {
		max-width: 46rem;
		margin-bottom: 1.25rem;
	}
	.trail {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0 0.5rem;
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
		overflow-wrap: anywhere;
	}
	.trail a {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		color: var(--muted);
	}
	ul {
		list-style: none;
		display: flex;
		gap: 0.25rem;
		margin: 0;
		padding: 0;
		border-bottom: 1px solid var(--line);
	}
	li {
		flex: 0 1 auto;
	}
	ul a {
		display: flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 0.9rem;
		margin-bottom: -1px;
		border-bottom: 3px solid transparent;
		color: var(--muted);
		font-weight: 600;
		text-decoration: none;
	}
	ul a:hover {
		color: var(--ink);
	}
	ul a[aria-current='page'] {
		color: var(--ink);
		border-bottom-color: var(--a);
	}
</style>
