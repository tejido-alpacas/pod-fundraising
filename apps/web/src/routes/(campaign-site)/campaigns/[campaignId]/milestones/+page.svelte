<script lang="ts">
	import { Banner, EmptyState, Icon, MilestoneRow, STATES } from '@tejido/ui';
	import CampaignNav from '#lib/campaign-site/CampaignNav.svelte';
	import { count, day, list, milestoneStatus } from '#lib/campaign-site/display.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const today = $derived(data.today);
	const base = $derived(`/campaigns/${data.campaign.id}/milestones`);

	const rows = $derived(
		data.milestones.map((milestone) => {
			const status = milestoneStatus(milestone.state, milestone.entries.length > 0);
			// Newest first, so this is the latest claim that the work is done.
			const claimed = milestone.entries.find(
				(entry) => entry.claim !== null && entry.claim !== 'confirm'
			);
			const due = `Due ${day(milestone.dueDate, today)}`;
			const when =
				status === 'confirmed'
					? milestone.confirmedAt
						? `Confirmed ${day(milestone.confirmedAt, today)}`
						: 'Confirmed'
					: status === 'claimed' && claimed
						? `${due} · reported complete ${day(claimed.filedAt, today)}`
						: milestone.progress && milestone.progress.percentComplete !== null
							? // The reporter's own figure. Tejido never computes a delivery percentage.
								`${due} · ${milestone.progress.percentComplete}% complete, as reported`
							: due;
			return { milestone, status, when };
		})
	);

	const confirmed = $derived(rows.filter((row) => row.status === 'confirmed').length);
	const overdue = $derived(rows.filter((row) => row.milestone.daysLate > 0));
</script>

<svelte:head><title>Milestones · {data.campaign.title} · Tejido</title></svelte:head>

<div class="tj-page" style:gap="var(--space-6)">
	<CampaignNav campaignId={data.campaign.id} title={data.campaign.title} current="milestones" />

	<div class="tj-pagehead">
		<p class="text-eyebrow">{data.campaign.title}</p>
		<h1>Milestones</h1>
		<p class="tj-pagehead__meta">
			{#if rows.length === 0}
				This campaign has no milestones yet.
			{:else}
				{confirmed} of {count(rows.length, 'milestone')} confirmed. Each milestone shows what was reported,
				who confirms it and what is still needed.
			{/if}
		</p>
	</div>

	{#if overdue.length > 0}
		<Banner
			tone="critical"
			icon="ms-overdue"
			role="note"
			title="{count(overdue.length, 'milestone')} {overdue.length === 1 ? 'is' : 'are'} overdue"
		>
			{list(
				overdue.map(
					({ milestone }) =>
						`Milestone ${milestone.position}, ${milestone.title}, was due ${day(milestone.dueDate, today)}`
				)
			)}. Overdue means the due date has passed and the milestone isn’t confirmed. Reports on it can
			still be valid.
		</Banner>
	{/if}

	{#if rows.length === 0}
		<EmptyState icon="list" title="No milestones yet">
			The organizer hasn’t set this campaign’s milestones. They appear here once they are set.
		</EmptyState>
	{:else}
		<div class="tj-msrows">
			{#each rows as { milestone, status, when } (milestone.id)}
				<MilestoneRow
					{milestone}
					owner={milestone.owner?.name ?? 'No one named'}
					{status}
					{when}
					href="{base}/{milestone.id}"
					overdueDays={milestone.daysLate}
					strength={milestone.strength}
				/>
			{/each}
		</div>

		<div class="tj-how">
			<p class="tj-how__title">How to read a milestone</p>
			<ol>
				<li>
					<Icon name="ms-claimed" />
					<span>
						<strong>Claimed complete</strong>
						{STATES.claimed.text} It is drawn with a dashed outline.
					</span>
				</li>
				<li>
					<Icon name="ms-confirmed" />
					<span>
						<strong>Confirmed</strong>
						The person named to confirm it has signed it off. Each confirmation says whether that person
						is a participant, a stakeholder or independent of the project.
					</span>
				</li>
				<li>
					<Icon name="ms-overdue" />
					<span>
						<strong>Overdue</strong>
						A second badge beside the status. {STATES.overdue.text}
					</span>
				</li>
			</ol>
		</div>
	{/if}
</div>
