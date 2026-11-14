<script lang="ts">
	// The way around one campaign: the same trail and the same three tabs on every page of it.
	// The page a donor is on is marked, and the campaign's name leads back to its overview.
	import { Icon } from '@tejido/ui';

	type Section = 'timeline' | 'milestones' | 'report';

	let {
		campaignId,
		title,
		current,
		part = 'all'
	}: {
		campaignId: string;
		title: string;
		/** The section this page is, or null for a page under one, such as an entry's proof. */
		current: Section | null;
		/** The overview places the trail above its header and the tabs under it. */
		part?: 'all' | 'trail' | 'tabs';
	} = $props();

	const base = $derived(`/campaigns/${campaignId}`);
	const links = $derived<{ section: Section; label: string; href: string }[]>([
		{ section: 'timeline', label: 'Timeline', href: base },
		{ section: 'milestones', label: 'Milestones', href: `${base}/milestones` },
		{ section: 'report', label: 'Report', href: `${base}/report` }
	]);
</script>

{#snippet trail()}
	<nav class="tj-crumbs" aria-label="Where you are">
		<a href="/">All campaigns</a>
		<Icon name="chevron-right" size={14} />
		{#if current === 'timeline'}
			<span aria-current="page">{title}</span>
		{:else}
			<a href={base}>{title}</a>
		{/if}
	</nav>
{/snippet}

{#snippet tabs()}
	<nav class="tj-tabs" aria-label="This campaign">
		{#each links as link (link.section)}
			<a href={link.href} aria-current={current === link.section ? 'page' : undefined}>
				{link.label}
			</a>
		{/each}
	</nav>
{/snippet}

{#if part === 'trail'}
	{@render trail()}
{:else if part === 'tabs'}
	{@render tabs()}
{:else}
	<div class="tj-section campaign-nav">
		{@render trail()}
		{@render tabs()}
	</div>
{/if}

<style>
	.campaign-nav {
		gap: var(--space-1);
		margin-bottom: var(--space-5);
	}
	.tj-crumbs {
		overflow-wrap: anywhere;
	}
	/* The design system's trail links are 32px tall. Ours are tapped on a phone: 44px. */
	.tj-crumbs a {
		min-height: var(--size-touch);
	}
</style>
