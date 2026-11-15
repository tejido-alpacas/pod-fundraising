<script lang="ts">
	import { Button, EmptyState } from '@tejido/ui';
	import HowProofWorks from '#lib/campaign-site/HowProofWorks.svelte';
	import { CAMPAIGN_STATUS_LABEL } from '#lib/campaign-site/labels.ts';
	import HomeCampaignCard from '#lib/old/HomeCampaignCard.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const START = '/campaigns/new';
</script>

<svelte:head>
	<title>Tejido · fundraising with proof of delivery</title>
	<meta
		name="description"
		content="Follow a funded project from the first report to the last confirmed milestone."
	/>
</svelte:head>

<div class="tj-page">
	<div class="intro">
		<header class="tj-pagehead">
			<h1>See what happened after the money was raised</h1>
			<p class="tj-camp__lede">
				Most donation sites close the story when the money is raised. Tejido keeps a public record
				of the delivery: who reported what, what evidence they gave, who confirmed it, and what is
				still unresolved.
			</p>
			<p class="tj-pagehead__meta">
				Every report is filed with a receipt and its evidence, and every milestone has a person
				named in advance to confirm it. Each state says plainly what is known and what isn’t.
			</p>
			<div class="actions">
				<Button variant="primary" size="field" href={START}>Start a campaign</Button>
				<a class="tj-link--standalone" href="#campaigns">See the campaigns</a>
			</div>
		</header>
		<HowProofWorks id="how" />
	</div>

	<section class="tj-section" aria-labelledby="campaigns">
		<div class="tj-section__head">
			<h2 class="tj-section__title" id="campaigns">Campaigns</h2>
			{#if data.campaigns.length > 0}
				<p class="tj-section__sub">
					{data.campaigns.length === 1 ? '1 campaign' : `${data.campaigns.length} campaigns`},
					newest first
				</p>
			{/if}
		</div>

		{#if data.campaigns.length === 0}
			<EmptyState icon="list" title="No campaigns yet">
				When a campaign opens it is listed here, with its milestones and every report filed on it.
				{#snippet action()}
					<Button size="field" href={START}>Start a campaign</Button>
				{/snippet}
			</EmptyState>
		{:else}
			<ul class="campaigns">
				{#each data.campaigns as campaign (campaign.id)}
					<li>
						<HomeCampaignCard
							campaign={{ ...campaign, statusLabel: CAMPAIGN_STATUS_LABEL[campaign.status] }}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<style>
	.intro {
		display: grid;
		gap: var(--space-6);
		align-items: start;
	}
	.intro .tj-pagehead {
		gap: var(--space-4);
		max-width: var(--layout-reading);
	}
	.intro .tj-pagehead__meta {
		font-size: 16px;
		line-height: 24px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: var(--space-2) var(--space-5);
		padding-top: var(--space-2);
	}
	.campaigns {
		display: grid;
		gap: var(--space-4);
	}
	.campaigns li {
		min-width: 0;
		display: grid;
	}
	@container (min-width: 720px) {
		.campaigns {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@container (min-width: 900px) {
		.intro {
			grid-template-columns: minmax(0, 1fr) 360px;
			gap: var(--space-10);
		}
	}
</style>
