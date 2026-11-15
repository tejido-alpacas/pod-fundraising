<!--
	The home page, in the first Tejido site's design: the hero, what you can do here, how it
	works, and the newest campaigns from our database.
-->
<script lang="ts">
	import CampaignCard from '#lib/campaign-site/CampaignCard.svelte';
	import HowSteps from '#lib/campaign-site/HowSteps.svelte';
	import Icon from '#lib/campaign-site/Icon.svelte';
	import { t } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const lang = $derived(data.lang);
	/** The home page shows the three newest; Explore shows them all. */
	const newest = $derived(data.campaigns.slice(0, 3));
</script>

<svelte:head>
	<title>tejido · {t(lang, 'tagline')}</title>
	<meta name="description" content={t(lang, 'x_home_lead')} />
</svelte:head>

<div class="hero x-hero">
	<div class="wrap">
		<p class="x-tagline">
			La red que nos une.{#if lang !== 'es'}
				<span>{t(lang, 'tagline')}</span>{/if}
		</p>
		<h1>{t(lang, 'x_home_h1')}</h1>
		<p class="x-hero-lead">{t(lang, 'x_home_lead')}</p>
		<div class="x-hero-actions">
			<a class="btn btn-orange x-btn-lg" href="/needs"
				><Icon name="heart" /><span>{t(lang, 'x_give_now')}</span></a
			>
			<a class="btn btn-ghost-w x-btn-lg" href="/explore"
				><Icon name="search" /><span>{t(lang, 'x_nav_explore')}</span></a
			>
		</div>
	</div>
</div>

<section class="x-sec">
	<div class="wrap">
		<h2 class="x-h2">{t(lang, 'x_do_title')}</h2>
		<div class="x-launch">
			<a class="card x-tile t-blue" href="/explore">
				<span class="x-tile-ic"><Icon name="search" size={24} /></span>
				<span class="x-tile-t">{t(lang, 'x_do_find')}</span>
				<span class="x-tile-d">{t(lang, 'x_do_find_d')}</span>
			</a>
			<a class="card x-tile t-orange" href="/needs">
				<span class="x-tile-ic"><Icon name="heart" size={24} /></span>
				<span class="x-tile-t">{t(lang, 'nav_needs')}</span>
				<span class="x-tile-d">{t(lang, 'tile_needs_d')}</span>
			</a>
			<a class="card x-tile t-navy" href="/about">
				<span class="x-tile-ic"><Icon name="proof" size={24} /></span>
				<span class="x-tile-t">{t(lang, 'x_about_nav')}</span>
				<span class="x-tile-d">{t(lang, 'tile_about_d')}</span>
			</a>
			<a class="card x-tile t-blue" href="/campaigns/new">
				<span class="x-tile-ic"><Icon name="bolt" size={24} /></span>
				<span class="x-tile-t">{t(lang, 'tile_start')}</span>
				<span class="x-tile-d">{t(lang, 'tile_start_d')}</span>
			</a>
		</div>
	</div>
</section>

<section class="x-sec">
	<div class="wrap">
		<h2 class="x-h2">{t(lang, 'x_how_title')}</h2>
		<HowSteps {lang} />
	</div>
</section>

<section class="x-sec x-sec-last" id="campaigns">
	<div class="wrap">
		<div class="x-row">
			<h2 class="x-h2">{t(lang, 'x_explore_title')}</h2>
			{#if data.campaigns.length > newest.length}
				<a class="x-more" href="/explore">{t(lang, 'x_explore_all')} &rarr;</a>
			{/if}
		</div>
		{#if newest.length === 0}
			<div class="card x-empty x-empty-in">
				<span class="x-empty-ic"><Icon name="info" size={28} /></span>
				<h2>{t(lang, 'campaigns_none')}</h2>
			</div>
		{:else}
			<div class="x-grid">
				{#each newest as campaign (campaign.id)}
					<CampaignCard {campaign} {lang} />
				{/each}
			</div>
		{/if}
	</div>
</section>
