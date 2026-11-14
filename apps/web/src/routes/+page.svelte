<script lang="ts">
	import { CAMPAIGN_STATUS_LABEL } from '#lib/campaign-site/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Tejido · fundraising with proof of delivery</title>
	<meta
		name="description"
		content="Follow a funded project from the first report to the last confirmed milestone."
	/>
</svelte:head>

<section class="intro">
	<h1>See what your donation built</h1>
	<p>
		On Tejido, donors fund a project and then follow it. The people doing the work file regular
		reports with photos, and each report is stamped with the time it was filed and who filed it.
	</p>
	<p>
		An independent confirmer, someone who did not do the work, signs off each milestone. You can
		open the proof behind every report.
	</p>
</section>

<h2 id="campaigns">Campaigns</h2>

{#if data.campaigns.length === 0}
	<p class="empty">
		There are no campaigns to follow yet. When a campaign opens, it will be listed here with its
		reports and milestones.
	</p>
{:else}
	<ul class="campaigns">
		{#each data.campaigns as campaign (campaign.id)}
			<li>
				<a class="card" href={campaign.path}>
					<span class="pill campaign-{campaign.status}">
						{CAMPAIGN_STATUS_LABEL[campaign.status]}
					</span>
					<h3>{campaign.title}</h3>
					{#if campaign.summary}<p class="summary">{campaign.summary}</p>{/if}
					<p class="facts">
						{#if campaign.beneficiary}Who it is for: {campaign.beneficiary}.{/if}
						Organised by {campaign.creatorName}.
					</p>
					<p class="facts">
						{#if campaign.milestones.total === 0}
							No milestones have been set yet.
						{:else}
							{campaign.milestones.confirmed} of {campaign.milestones.total}
							{campaign.milestones.total === 1 ? 'milestone' : 'milestones'} confirmed.
						{/if}
					</p>
					<span class="go">Follow this campaign</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.intro {
		max-width: 44rem;
	}
	.intro p {
		font-size: 1.05rem;
	}
	.empty {
		max-width: 44rem;
		background: var(--surface);
		border: 1px dashed var(--line);
		border-radius: 8px;
		padding: 1.25rem 1rem;
		color: var(--muted);
	}
	.campaigns {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(min(100%, 22rem), 1fr));
		gap: 1rem;
	}
	.campaigns li {
		min-width: 0;
	}
	.card {
		display: block;
		height: 100%;
		box-sizing: border-box;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 1rem;
		color: var(--ink);
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.card:hover {
		border-color: var(--a);
	}
	h3 {
		font-size: 1.2rem;
		margin: 0.6rem 0 0.4rem;
	}
	.card p {
		margin: 0.35rem 0;
	}
	.summary {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 4;
		line-clamp: 4;
		overflow: hidden;
	}
	.facts {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.go {
		display: inline-block;
		margin-top: 0.6rem;
		color: var(--a);
		font-weight: 600;
		text-decoration: underline;
	}
	.pill {
		display: inline-block;
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 999px;
		padding: 1px 9px;
		border: 1.5px solid var(--muted);
		color: var(--muted);
		white-space: nowrap;
	}
	.campaign-delivered {
		border-color: var(--a);
		background: var(--a);
		color: #fff;
	}
	.campaign-overdue {
		border-color: var(--warn);
		color: var(--warn);
	}
</style>
