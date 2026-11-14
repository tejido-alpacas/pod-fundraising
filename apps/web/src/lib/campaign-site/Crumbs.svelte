<!--
  Breadcrumb for a page under a campaign. The last item is the page itself and is not a link.

  <Crumbs items={[{ label: campaign.title, href: base }, { label: 'Milestones', href: `${base}/milestones` }, { label: 'Milestone 2' }]} />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';

	let { items }: { items: { label: string; href?: string }[] } = $props();
</script>

<nav class="tj-crumbs" aria-label="Breadcrumb">
	{#each items as item, index (index)}
		{#if index > 0}<Icon name="chevron-right" size={14} />{/if}
		{#if item.href}
			<a href={item.href}>{item.label}</a>
		{:else}
			<span aria-current="page">{item.label}</span>
		{/if}
	{/each}
</nav>
