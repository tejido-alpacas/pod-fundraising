<!-- Give, in the first site's design: the campaigns raising money now, then other ways to help. -->
<script lang="ts">
	import CampaignCard from '#lib/campaign-site/CampaignCard.svelte';
	import Icon from '#lib/campaign-site/Icon.svelte';
	import { t } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lang = $derived(data.lang);
</script>

<svelte:head>
	<title>{t(lang, 'nav_needs')} · tejido</title>
	<meta name="description" content={t(lang, 'needs_lead')} />
</svelte:head>

<div class="wrap x-head">
	<h1>{t(lang, 'x_give_h1')}</h1>
	<p class="x-lead">{t(lang, 'needs_lead')}</p>
</div>

<div class="wrap">
	{#if data.campaigns.length === 0}
		<div class="card x-empty x-empty-in">
			<span class="x-empty-ic"><Icon name="info" size={28} /></span>
			<h2>{t(lang, 'needs_none')}</h2>
		</div>
		<p class="x-next"><a href="/explore">{t(lang, 'needs_none_next')} &rarr;</a></p>
	{:else}
		<div class="x-grid">
			{#each data.campaigns as campaign (campaign.id)}
				<CampaignCard {campaign} {lang} />
			{/each}
		</div>
	{/if}

	<h2 class="x-h2 x-mt">{t(lang, 'x_more_ways')}</h2>
	<div class="x-launch">
		<a class="card x-tile t-blue" href="/explore">
			<span class="x-tile-ic"><Icon name="search" size={24} /></span>
			<span class="x-tile-t">{t(lang, 'x_do_find')}</span>
			<span class="x-tile-d">{t(lang, 'x_do_find_d')}</span>
		</a>
		<a class="card x-tile t-navy" href="/about">
			<span class="x-tile-ic"><Icon name="proof" size={24} /></span>
			<span class="x-tile-t">{t(lang, 'x_about_nav')}</span>
			<span class="x-tile-d">{t(lang, 'tile_about_d')}</span>
		</a>
	</div>
</div>
