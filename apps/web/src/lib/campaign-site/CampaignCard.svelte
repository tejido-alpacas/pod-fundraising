<!--
	One campaign as a card, in the first site's opportunity-card design. The whole card links to
	the campaign's timeline. Campaign titles and summaries are shown as their creator wrote them.
-->
<script lang="ts">
	import type { CampaignStatus } from '@tejido/contracts';
	import Icon from './Icon.svelte';
	import { statusKey, t, type Lang } from './i18n/index.ts';

	interface CardCampaign {
		title: string;
		summary: string;
		beneficiary: string;
		creatorName: string;
		status: CampaignStatus;
		milestones: { total: number; confirmed: number };
		path: string;
	}

	let { campaign, lang }: { campaign: CardCampaign; lang: Lang } = $props();
</script>

<article class="card x-opp">
	<div class="x-opp-top">
		<span class="tchip t-funds"><Icon name="funds" size={14} />{t(lang, statusKey(campaign.status))}</span>
	</div>
	<h3><a class="x-stretch" href={campaign.path}>{campaign.title}</a></h3>
	{#if campaign.beneficiary}
		<p class="x-place">
			<Icon name="people" size={14} /><span>{t(lang, 'card_for', { who: campaign.beneficiary })}</span>
		</p>
	{/if}
	{#if campaign.summary}<p class="x-line">{campaign.summary}</p>{/if}
	<p class="x-place">
		<Icon name="proof" size={14} /><span
			>{campaign.milestones.total === 0
				? t(lang, 'card_no_milestones')
				: t(lang, 'card_milestones', {
						c: campaign.milestones.confirmed,
						n: campaign.milestones.total
					})}</span
		>
	</p>
	<div class="x-opp-foot">
		<span class="x-org"><span>{t(lang, 'card_by', { name: campaign.creatorName })}</span></span>
		<span class="btn btn-blue btn-sm x-cta" aria-hidden="true">{t(lang, 'card_follow')}</span>
	</div>
</article>
