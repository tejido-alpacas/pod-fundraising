<script lang="ts">
	import { Banner, Button, EmptyState, Icon, MilestoneRow, STATES, StatusBadge } from '@tejido/ui';
	import CampaignNav from '#lib/campaign-site/CampaignNav.svelte';
	import {
		dayAfter,
		dayHeading,
		days,
		shortDate,
		utcDay,
		utcTime
	} from '#lib/campaign-site/dates.ts';
	import FundingProgress from '#lib/campaign-site/FundingProgress.svelte';
	import DeliveryProgress from '#lib/campaign-site/DeliveryProgress.svelte';
	import HowProofWorks from '#lib/campaign-site/HowProofWorks.svelte';
	import { CAMPAIGN_STATUS_LABEL } from '#lib/campaign-site/labels.ts';
	import PublishCampaign from '#lib/campaign-site/PublishCampaign.svelte';
	import TimelineEntry from '#lib/campaign-site/TimelineEntry.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	type Milestone = PageProps['data']['milestones'][number];
	type Entry = PageProps['data']['entries'][number];
	type Party = PageProps['data']['parties'][number];

	const milestonesPath = $derived(`/campaigns/${data.campaign.id}/milestones`);
	const date = (value: string) => shortDate(value, data.today);

	// --- Where it stands: at most three rows. Overdue, waiting for confirmation, next due. ---
	const overdue = $derived(
		data.milestones
			.filter((milestone) => milestone.overdueDays > 0)
			.sort((a, b) => b.overdueDays - a.overdueDays)
	);
	const waiting = $derived(data.milestones.filter((milestone) => milestone.status === 'claimed'));
	const nextDue = $derived(
		data.milestones
			.filter(
				(milestone) =>
					(milestone.status === 'not-started' || milestone.status === 'in-progress') &&
					milestone.overdueDays === 0
			)
			.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
	);
	/** " 2 other milestones are also overdue." Nothing when there is only the one named. */
	const others = (count: number, what: string) =>
		count > 1
			? ` ${count - 1} other ${count === 2 ? 'milestone is' : 'milestones are'} also ${what}.`
			: '';

	// --- The timeline: grouped by day, newest first. A milestone going overdue is an event on
	// the thread, placed on the day after it was due. ---
	type Item = { kind: 'entry'; entry: Entry } | { kind: 'overdue'; milestone: Milestone };

	const groups = $derived.by(() => {
		const byDay: Record<string, Item[]> = {};
		const add = (day: string, item: Item) => (byDay[day] ??= []).push(item);

		for (const entry of data.entries) add(utcDay(entry.filedAt), { kind: 'entry', entry });

		// Older entries may not be shown yet. An event from before the oldest one shown waits
		// with them, so the days stay in order when they are revealed.
		const oldestShown = data.entries.at(-1);
		const from = data.nextShow !== null && oldestShown ? utcDay(oldestShown.filedAt) : '';
		for (const milestone of overdue) {
			const day = dayAfter(milestone.dueDate);
			if (day >= from) add(day, { kind: 'overdue', milestone });
		}

		return Object.entries(byDay)
			.sort(([a], [b]) => b.localeCompare(a))
			.map(([day, items]) => ({ day, items }));
	});

	const flaggedTitle = (entry: PageProps['data']['flagged']['named'][number]) =>
		`${entry.heading}${entry.milestoneTitle ? ` on ${entry.milestoneTitle}` : ''}, ${date(entry.filedAt)} ${utcTime(entry.filedAt)}`;

	/** One plain line under a milestone's name. */
	function when(milestone: Milestone): string {
		if (milestone.status === 'confirmed') {
			return milestone.confirmedAt
				? `Confirmed ${date(milestone.confirmedAt)}`
				: `Due ${date(milestone.dueDate)}`;
		}
		const reported =
			milestone.status === 'in-progress' && milestone.reportedPercent !== null
				? ` · ${milestone.reportedPercent}% reported`
				: '';
		return `Due ${date(milestone.dueDate)}${reported}`;
	}

	// --- Who is involved ---
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.filter((word) => /^\p{L}/u.test(word))
			.slice(0, 2)
			.map((word) => word.charAt(0).toUpperCase())
			.join('');

	const RELATIONSHIP = {
		participant: 'Participant',
		stakeholder: 'Stakeholder',
		independent: 'Independent'
	} as const;

	/** How a party relates to the project, and why, in the organiser's recorded words. */
	function relation(party: Party): string {
		const label = RELATIONSHIP[party.relationship];
		if (party.relationshipReason) return `${label} · ${party.relationshipReason}`;
		if (!party.relationshipRecorded) {
			return `${label} · their relationship to the project is not on record`;
		}
		return party.role === 'third_party' ? `${label} · does the work` : label;
	}
</script>

<svelte:head><title>{data.campaign.title} · Tejido</title></svelte:head>

<div class="tj-page overview">
	<CampaignNav
		campaignId={data.campaign.id}
		title={data.campaign.title}
		current="timeline"
		part="trail"
	/>

	<!-- A draft says so, and its signed-in creator can publish it from here. -->
	<PublishCampaign
		lang={data.lang}
		campaignId={data.campaign.id}
		draft={data.publishing !== null}
		viewer={data.publishing?.viewer ?? 'signed_out'}
		email={data.donorEmail}
		returnTo="/campaigns/{data.campaign.id}"
	/>

	<div class="tj-campaign">
		<section class="tj-camp tj-campaign__intro">
			<div class="tj-camp__where">
				<span><Icon name="flag" size={16} />{CAMPAIGN_STATUS_LABEL[data.campaign.status]}</span>
				<span>
					<Icon name="calendar" size={16} />On Tejido since {date(data.campaign.createdAt)}
				</span>
			</div>
			<div class="tj-pagehead">
				<h1>{data.campaign.title}</h1>
				<p class="tj-pagehead__meta">
					{#if data.campaign.beneficiary}Who it is for: {data.campaign.beneficiary}.{/if}
					Organised by {data.campaign.creatorName}.
				</p>
			</div>
			{#if data.campaign.summary}<p class="tj-camp__lede">{data.campaign.summary}</p>{/if}
		</section>

		<aside class="tj-campaign__aside" aria-label="Where this campaign stands">
			<div class="tj-panel">
				<!-- Funding is shown only when it is known. "Not known" is not zero, so nothing is drawn. -->
				{#if data.funding.state === 'known'}
					<FundingProgress funding={data.funding} />
					<div class="tj-panel__sep"></div>
				{/if}
				<DeliveryProgress
					segments={data.milestones}
					confirmed={data.delivery.confirmed}
					total={data.delivery.total}
				/>

				{#if data.delivery.total > 0}
					<div class="tj-mscard tj-mscard--flat">
						{#if overdue[0]}
							<div class="tj-mscard__row tj-tone--critical">
								<Icon name="ms-overdue" size={18} />
								<p>
									<strong>Overdue: {overdue[0].title}</strong>
									<span>
										{days(overdue[0].overdueDays)} late. It was due {date(
											overdue[0].dueDate
										)}.{others(overdue.length, 'overdue')}
									</span>
								</p>
							</div>
						{/if}
						{#if waiting[0]}
							<div class="tj-mscard__row">
								<Icon name="ms-claimed" size={18} />
								<p>
									<strong>Waiting for confirmation: {waiting[0].title}</strong>
									<span>
										Work has been reported as complete.
										{waiting[0].confirmerName
											? `${waiting[0].confirmerName} is named to confirm it.`
											: 'Nobody has confirmed it yet.'}{others(waiting.length, 'waiting')}
									</span>
								</p>
							</div>
						{/if}
						{#if nextDue}
							<div class="tj-mscard__row">
								<Icon name="calendar" size={18} />
								<p>
									<strong>Next due: {nextDue.title}</strong>
									<span>
										{date(nextDue.dueDate)}{nextDue.reportedPercent !== null
											? ` · ${nextDue.reportedPercent}% complete, as reported`
											: ''}
									</span>
								</p>
							</div>
						{/if}
						{#if !overdue[0] && !waiting[0] && !nextDue}
							<div class="tj-mscard__row tj-tone--confirmed">
								<Icon name="ms-confirmed" size={18} />
								<p>
									<strong>Every milestone is confirmed</strong>
									<span>Nothing is overdue or waiting for confirmation.</span>
								</p>
							</div>
						{/if}
					</div>
				{/if}

				<p class="tj-panel__how">
					{#if data.delivery.total > 0}
						A milestone counts as confirmed only when the person named to confirm it has signed it
						off. Work that is reported but not confirmed is drawn dashed.
					{:else}
						Milestones are listed here once the organiser has set them, each with who owes it and
						who confirms it.
					{/if}
				</p>
			</div>
		</aside>

		<div class="tj-campaign__main">
			<CampaignNav
				campaignId={data.campaign.id}
				title={data.campaign.title}
				current="timeline"
				part="tabs"
				counts={{ timeline: data.total, milestones: data.milestones.length }}
			/>

			<section class="tj-section" aria-labelledby="timeline">
				<div class="tj-section__head">
					<h2 class="tj-section__title" id="timeline">What has happened</h2>
					{#if data.total > 0}
						<p class="tj-section__sub">
							Newest first ·
							{data.entries.length === data.total
								? `${data.total} ${data.total === 1 ? 'update' : 'updates'}`
								: `${data.entries.length} of ${data.total} updates shown`}
						</p>
					{/if}
				</div>

				{#if overdue[0]}
					{@const milestone = overdue[0]}
					<Banner
						tone="critical"
						icon="ms-overdue"
						role="note"
						title="{milestone.title} is {days(milestone.overdueDays)} overdue"
					>
						It was due {date(milestone.dueDate)} and has not been confirmed.
						{#if milestone.status === 'claimed'}
							Work has been reported as complete{milestone.confirmerName
								? `, and ${milestone.confirmerName} is named to confirm it`
								: ''}.
						{:else if milestone.ownerName}
							{milestone.ownerName} owes this milestone.
						{/if}
						A late milestone can still have valid reports.{others(overdue.length, 'overdue')}
						{#snippet actions()}
							<Button href="{milestonesPath}#{milestone.id}">
								View milestone {milestone.position}
							</Button>
						{/snippet}
					</Banner>
				{:else if data.campaign.status === 'overdue'}
					<Banner tone="critical" icon="clock" role="note" title="A report is overdue">
						A work log that was due on this campaign has not been filed. The campaign stays marked
						until the late one arrives.
					</Banner>
				{/if}

				{#if data.flagged.count > 0}
					<Banner
						tone="critical"
						icon="receipt-flag"
						role="note"
						title={data.flagged.count === 1
							? '1 filing is flagged'
							: `${data.flagged.count} filings are flagged`}
					>
						{STATES.flagged.text} The report itself may still be accurate. Treat what it says as unproven
						until the difference is explained.
						{#snippet actions()}
							<ul class="flagged">
								{#each data.flagged.named as entry (entry.id)}
									<li>
										<a class="tj-link--standalone" href={entry.proofPath}>
											{flaggedTitle(entry)}
											<Icon name="arrow-right" size={18} />
										</a>
									</li>
								{/each}
								{#if data.flagged.count > data.flagged.named.length}
									<li class="more">
										and {data.flagged.count - data.flagged.named.length} more, marked in the timeline
										below.
									</li>
								{/if}
							</ul>
						{/snippet}
					</Banner>
				{/if}

				{#if data.total === 0}
					<EmptyState icon="list" title="No updates yet">
						Each report from the people doing the work appears here as soon as it is filed, with its
						evidence and the proof behind it.
					</EmptyState>
				{:else}
					<div class="tj-timeline">
						{#each groups as group (group.day)}
							<h3 class="tj-timeline__date">{dayHeading(group.day, data.today)}</h3>
							{#each group.items as item (item.kind === 'entry' ? item.entry.id : `overdue-${item.milestone.id}`)}
								{#if item.kind === 'entry'}
									<TimelineEntry entry={item.entry} />
								{:else}
									<article class="tj-entry tj-entry--event tj-tone--critical">
										<span class="tj-entry__node" aria-hidden="true">
											<Icon name="ms-overdue" size={18} />
										</span>
										<div class="tj-entry__card">
											<p class="tj-entry__kicker">Milestone {item.milestone.position}</p>
											<p class="tj-entry__title event-title">
												{item.milestone.title} became overdue
											</p>
											<p class="tj-entry__meta">
												Due {date(item.milestone.dueDate)}. It had not been confirmed by then.
											</p>
										</div>
									</article>
								{/if}
							{/each}
						{/each}
					</div>

					{#if data.nextShow !== null}
						<Button
							block
							icon="chevron-down"
							href="?show={data.nextShow}#timeline"
							data-sveltekit-noscroll
							data-sveltekit-replacestate
						>
							Show {data.nextShow - data.entries.length} earlier
							{data.nextShow - data.entries.length === 1 ? 'update' : 'updates'}
						</Button>
					{/if}
				{/if}
			</section>

			<section class="tj-section" aria-labelledby="milestones">
				<div class="tj-section__head">
					<h2 class="tj-section__title" id="milestones">Milestones</h2>
					{#if data.milestones.length > 0}
						<p class="tj-section__sub">
							{data.delivery.confirmed} of {data.delivery.total} confirmed
						</p>
					{/if}
				</div>
				{#if data.milestones.length === 0}
					<EmptyState icon="list" title="No milestones yet">
						The organiser has not set any milestones. Each one will be listed here with who owes it
						and who confirms it.
					</EmptyState>
				{:else}
					<div class="tj-msrows">
						{#each data.milestones as milestone (milestone.id)}
							<MilestoneRow
								{milestone}
								owner={milestone.ownerName ?? 'Owner not on record'}
								status={milestone.status}
								when={when(milestone)}
								href="{milestonesPath}#{milestone.id}"
								overdueDays={milestone.overdueDays}
								strength={milestone.strength}
							/>
						{/each}
					</div>
					<a class="tj-link--standalone" href={milestonesPath}>
						Progress on each milestone <Icon name="arrow-right" size={18} />
					</a>
				{/if}
			</section>

			<HowProofWorks id="how" />

			<section class="tj-section" aria-labelledby="who">
				<div class="tj-section__head">
					<h2 class="tj-section__title" id="who">Who’s involved</h2>
				</div>
				<div class="tj-parties">
					<div class="tj-party">
						<span class="tj-avatar" aria-hidden="true">{initials(data.campaign.creatorName)}</span>
						<div>
							<p class="tj-party__name">{data.campaign.creatorName}</p>
							<p class="tj-party__role">Organiser</p>
						</div>
						<div class="tj-party__rel">
							<StatusBadge state="participant" label="Participant · runs the campaign" plain />
						</div>
					</div>
					{#each data.parties as party (party.id)}
						<div class="tj-party">
							<span class="tj-avatar" aria-hidden="true">{initials(party.name)}</span>
							<div>
								<p class="tj-party__name">{party.name}</p>
								<p class="tj-party__role">
									{party.title || (party.role === 'confirmer' ? 'Confirmer' : 'Does the work')}
								</p>
							</div>
							<div class="tj-party__rel">
								<StatusBadge state={party.relationship} label={relation(party)} plain />
							</div>
						</div>
					{/each}
				</div>
			</section>
		</div>
	</div>
</div>

<style>
	/* The trail sits close above the header it belongs to. */
	.overview {
		gap: var(--space-2);
	}
	.tj-pagehead,
	.tj-camp__lede,
	.tj-party {
		overflow-wrap: anywhere;
	}
	/* A button in a notice is tapped on a phone: 44px, not the 40px desktop control. */
	.tj-section :global(.tj-banner__actions .tj-btn) {
		min-height: var(--size-touch);
	}
	.event-title {
		color: var(--tone-text);
	}
	.flagged {
		display: grid;
		width: 100%;
	}
	.flagged .more {
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
	}
	.flagged a {
		overflow-wrap: anywhere;
	}
</style>
