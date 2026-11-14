<script lang="ts">
	import { EmptyState, Icon, StatusBadge } from '@tejido/ui';
	import FundingProgress from '#lib/campaign-site/FundingProgress.svelte';
	import DeliveryProgress from '#lib/campaign-site/DeliveryProgress.svelte';
	import HowProofWorks from '#lib/campaign-site/HowProofWorks.svelte';
	import { CAMPAIGN_STATUS_LABEL } from '#lib/campaign-site/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Listed = PageProps['data']['campaigns'][number];
	const overdue = (campaign: Listed) =>
		campaign.delivery.filter((milestone) => milestone.overdueDays > 0).length;
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
			</EmptyState>
		{:else}
			<ul class="campaigns">
				{#each data.campaigns as campaign (campaign.id)}
					<li>
						<a class="tj-card campaign" href={campaign.path}>
							<p class="tj-entry__kicker">{CAMPAIGN_STATUS_LABEL[campaign.status]}</p>
							<div class="tj-pagehead">
								<h3>{campaign.title}</h3>
								<p class="tj-pagehead__meta">
									{#if campaign.beneficiary}Who it is for: {campaign.beneficiary}.{/if}
									Organised by {campaign.creatorName}.
								</p>
							</div>
							{#if campaign.summary}<p class="summary">{campaign.summary}</p>{/if}
							<div class="standing">
								{#if campaign.funding.state === 'known'}
									<FundingProgress funding={campaign.funding} compact />
								{/if}
								<DeliveryProgress
									segments={campaign.delivery}
									confirmed={campaign.milestones.confirmed}
									total={campaign.milestones.total}
									eyebrow={false}
									legend={false}
								/>
								{#if overdue(campaign) > 0}
									<div class="tj-badges">
										<StatusBadge
											state="overdue"
											label={overdue(campaign) === 1
												? '1 milestone overdue'
												: `${overdue(campaign)} milestones overdue`}
										/>
									</div>
								{/if}
							</div>
							<span class="tj-link--standalone go">
								Follow this campaign <Icon name="arrow-right" size={18} />
							</span>
						</a>
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
	.campaigns {
		display: grid;
		gap: var(--space-4);
	}
	.campaigns li {
		min-width: 0;
		display: grid;
	}
	.campaign {
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-5);
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.campaign:hover {
		border-color: var(--border-strong);
	}
	.campaign h3 {
		font: 500 24px/30px var(--font-serif);
		text-wrap: balance;
	}
	.summary {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		color: var(--text-secondary);
	}
	.standing {
		display: grid;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: var(--border-hair) solid var(--border);
	}
	.go {
		color: var(--link);
		margin-block: calc(-1 * var(--space-2));
	}
	.campaign:hover .go {
		text-decoration: underline;
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
