<!--
	Explore, in the first site's design: search and filter every campaign a donor can follow.
	The list comes from our database; searching and filtering happen here, in the browser.
-->
<script lang="ts">
	import type { CampaignStatus } from '@tejido/contracts';
	import { SvelteSet } from 'svelte/reactivity';
	import CampaignCard from '#lib/campaign-site/CampaignCard.svelte';
	import Icon from '#lib/campaign-site/Icon.svelte';
	import { statusKey, t } from '#lib/campaign-site/i18n/index.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const lang = $derived(data.lang);

	/** Drafts never reach this page, so they are not a filter. */
	const STATUSES: CampaignStatus[] = ['funding', 'funded', 'reporting', 'overdue', 'delivered'];

	let query = $state('');
	const chosen = new SvelteSet<CampaignStatus>();

	/** Lower case, without accents, so "dia" finds "Día". */
	function fold(text: string): string {
		return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
	}

	const shown = $derived.by(() => {
		const words = fold(query).trim();
		return data.campaigns.filter(
			(campaign) =>
				(chosen.size === 0 || chosen.has(campaign.status)) &&
				(!words ||
					fold(
						[campaign.title, campaign.summary, campaign.beneficiary, campaign.creatorName].join(' ')
					).includes(words))
		);
	});
	const filtering = $derived(chosen.size > 0 || query.trim() !== '');

	function toggle(status: CampaignStatus) {
		if (chosen.has(status)) chosen.delete(status);
		else chosen.add(status);
	}
	function clear() {
		chosen.clear();
		query = '';
	}
</script>

<svelte:head>
	<title>{t(lang, 'x_nav_explore')} · tejido</title>
	<meta name="description" content={t(lang, 'explore_lead')} />
</svelte:head>

<div class="wrap x-head">
	<h1>{t(lang, 'x_nav_explore')}</h1>
	<p class="x-lead">{t(lang, 'explore_lead')}</p>
</div>

<div class="wrap x-explore">
	<div class="x-search">
		<Icon name="search" />
		<label class="sr" for="xq">{t(lang, 'x_search_label')}</label>
		<input
			type="search"
			id="xq"
			autocomplete="off"
			enterkeyhint="search"
			placeholder={t(lang, 'search_ph')}
			bind:value={query}
		/>
	</div>
	<div class="x-filters">
		<div class="fgroup" role="group" aria-label={t(lang, 'filter_status')}>
			<span class="fg-l">{t(lang, 'filter_status')}</span>
			{#each STATUSES as status (status)}
				<button
					type="button"
					class="fchip"
					aria-pressed={chosen.has(status)}
					onclick={() => toggle(status)}>{t(lang, statusKey(status))}</button
				>
			{/each}
		</div>
	</div>
	<div class="x-countrow">
		<span aria-live="polite"
			>{shown.length === 1
				? t(lang, 'x_result_1')
				: t(lang, 'x_results', { n: shown.length })}</span
		>
		{#if filtering}
			<button type="button" class="linklike" onclick={clear}>{t(lang, 'x_clear')}</button>
		{/if}
	</div>

	{#if shown.length > 0}
		<div class="x-grid">
			{#each shown as campaign (campaign.id)}
				<CampaignCard {campaign} {lang} />
			{/each}
		</div>
	{:else}
		<div class="x-empty x-empty-in">
			<span class="x-empty-ic"><Icon name="search" size={28} /></span>
			{#if data.campaigns.length === 0}
				<h2>{t(lang, 'campaigns_none')}</h2>
			{:else}
				<h2>{t(lang, 'x_empty_t')}</h2>
				<p>{t(lang, 'x_empty_d')}</p>
				<div class="x-actions x-center">
					<button type="button" class="btn btn-ghost" onclick={clear}>{t(lang, 'x_clear')}</button>
				</div>
			{/if}
		</div>
	{/if}
</div>
