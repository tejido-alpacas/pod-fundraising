<script lang="ts">
	import CampaignNav from '#lib/campaign-site/CampaignNav.svelte';
	import EntryStatus from '#lib/campaign-site/EntryStatus.svelte';
	import {
		CAMPAIGN_STATUS_LABEL,
		CLAIM_LABEL,
		ENTRY_STATUS,
		MILESTONE_STATE_LABEL,
		PARTY_ROLE_LABEL,
		WORK_STATUS_LABEL,
		formatDate,
		formatDateTime
	} from '#lib/campaign-site/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const milestonesPath = $derived(`/campaigns/${data.campaign.id}/milestones`);
	const number = (value: number) => value.toLocaleString('en-GB');
	// An amount spent is filed as a bare number: the campaign records no currency, so none is shown.
	const money = (value: number) =>
		value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
</script>

<svelte:head><title>{data.campaign.title} · Tejido</title></svelte:head>

<CampaignNav campaignId={data.campaign.id} title={data.campaign.title} current="timeline" />

<header class="campaign">
	<h1>{data.campaign.title}</h1>
	<p class="for">
		<span class="pill campaign-{data.campaign.status}">
			{CAMPAIGN_STATUS_LABEL[data.campaign.status]}
		</span>
		{#if data.campaign.beneficiary}Who it is for: {data.campaign.beneficiary}.{/if}
		Organised by {data.campaign.creatorName}.
	</p>
	{#if data.campaign.summary}<p class="about">{data.campaign.summary}</p>{/if}

	{#if data.milestones.length > 0}
		<ul class="milestones" aria-label="Milestones">
			{#each data.milestones as milestone (milestone.id)}
				<li>
					<a class="tap" href="{milestonesPath}#{milestone.id}">{milestone.title}</a>
					<span class="pill state-{milestone.state}">{MILESTONE_STATE_LABEL[milestone.state]}</span>
					<span class="muted">due {formatDate(milestone.dueDate)}</span>
				</li>
			{/each}
		</ul>
		<p class="muted more">
			<a class="tap" href={milestonesPath}>Progress on each milestone</a>
		</p>
	{:else}
		<p class="empty">
			No milestones have been set for this campaign yet. They will be listed here, each with who
			owes it and who confirms it.
		</p>
	{/if}
</header>

{#if data.flagged.count > 0}
	<aside class="alert" aria-label="Flagged entries">
		<p class="alert-title">
			{data.flagged.count === 1
				? '1 entry on this campaign is flagged'
				: `${data.flagged.count} entries on this campaign are flagged`}
		</p>
		<p>
			{ENTRY_STATUS.flagged.meaning} Treat what a flagged entry reports as unproven until it is explained.
		</p>
		<ul>
			{#each data.flagged.named as entry (entry.id)}
				<li>
					<a href={entry.proofPath}>
						{entry.heading}{entry.milestoneTitle ? ` on ${entry.milestoneTitle}` : ''},
						{formatDateTime(entry.filedAt)}
					</a>
				</li>
			{/each}
			{#if data.flagged.count > data.flagged.named.length}
				<li>
					and {data.flagged.count - data.flagged.named.length} more, marked in the timeline below.
				</li>
			{/if}
		</ul>
	</aside>
{/if}

<h2 id="timeline">
	Timeline
	{#if data.total > 0}
		<span class="muted count">
			{data.entries.length === data.total
				? `${data.total} ${data.total === 1 ? 'entry' : 'entries'}`
				: `newest ${data.entries.length} of ${data.total} entries`}, newest first
		</span>
	{/if}
</h2>

{#if data.total === 0}
	<p class="empty">
		Nothing has been reported on this campaign yet. Each report from the people doing the work will
		appear here as soon as it is filed, with its photos and the proof behind it.
	</p>
{:else}
	<ol class="timeline">
		{#each data.entries as entry (entry.id)}
			<li class="entry {entry.status}" id="entry-{entry.id}">
				<div class="top">
					<EntryStatus status={entry.status} />
					<time class="muted" datetime={entry.filedAt}>{formatDateTime(entry.filedAt)}</time>
				</div>

				<h3>
					{entry.heading}{entry.claim ? `: ${CLAIM_LABEL[entry.claim]}` : ''}
					<span class="on">
						on <a href={milestonesPath}>{entry.milestoneTitle ?? entry.milestoneId}</a>
					</span>
				</h3>

				<p class="filer">
					{#if entry.filer}
						Filed by <strong>{entry.filer.name}</strong>{entry.filer.title
							? `, ${entry.filer.title}`
							: ''}
						<span class="muted">({PARTY_ROLE_LABEL[entry.filer.role]})</span>
					{:else}
						<span class="muted">The party that filed this entry is not on record.</span>
					{/if}
				</p>

				{#if entry.status === 'flagged' || entry.status === 'incomplete'}
					<p class="reason">
						<strong>{entry.status === 'flagged' ? 'Why it is flagged:' : 'What is missing:'}</strong
						>
						{entry.statusReason ?? ENTRY_STATUS[entry.status].meaning}
					</p>
				{:else}
					<p class="trust muted">{ENTRY_STATUS[entry.status].meaning}</p>
				{/if}

				<p class="summary">{entry.summary}</p>

				{#if entry.workStatus || entry.percentComplete !== null || entry.period || entry.quantity !== null || entry.amountSpent !== null || entry.location}
					<dl class="facts">
						{#if entry.workStatus}
							<div>
								<dt>Status</dt>
								<dd>
									<span class="work work-{entry.workStatus}"
										>{WORK_STATUS_LABEL[entry.workStatus]}</span
									>
								</dd>
							</div>
						{/if}
						{#if entry.percentComplete !== null}
							<div>
								<dt>Reported complete</dt>
								<dd class="percent">
									<span class="bar" aria-hidden="true">
										<span style:width="{entry.percentComplete}%"></span>
									</span>
									{number(entry.percentComplete)}%
								</dd>
							</div>
						{/if}
						{#if entry.period}
							<div>
								<dt>Period</dt>
								<dd>{entry.period}</dd>
							</div>
						{/if}
						{#if entry.quantity !== null}
							<div>
								<dt>Quantity</dt>
								<dd>{number(entry.quantity)}{entry.unit ? ` ${entry.unit}` : ''}</dd>
							</div>
						{/if}
						{#if entry.amountSpent !== null}
							<div>
								<dt>Amount spent</dt>
								<dd>{money(entry.amountSpent)}</dd>
							</div>
						{/if}
						{#if entry.location}
							<div>
								<dt>Location</dt>
								<dd>{entry.location}</dd>
							</div>
						{/if}
					</dl>
				{/if}

				{#if entry.evidence.photos.length > 0}
					<ul class="photos">
						{#each entry.evidence.photos as photo (photo.url)}
							<li>
								<figure>
									<a href={photo.url}>
										<img
											src={photo.url}
											alt={photo.caption ?? 'Photo filed as evidence, with no caption'}
											loading="lazy"
											decoding="async"
										/>
									</a>
									{#if photo.caption}<figcaption>{photo.caption}</figcaption>{/if}
								</figure>
							</li>
						{/each}
					</ul>
				{/if}

				{#if entry.evidence.documents.length > 0}
					<ul class="documents">
						{#each entry.evidence.documents as document (document.url)}
							<li>
								<a href={document.url}>{document.caption ?? 'Document'}</a>
								<span class="muted">(PDF)</span>
							</li>
						{/each}
					</ul>
				{/if}

				{#if entry.evidence.leftOut > 0}
					<p class="left-out">
						{entry.evidence.leftOut === 1
							? '1 attached file is not shown'
							: `${entry.evidence.leftOut} attached files are not shown`}, because
						{entry.evidence.leftOut === 1 ? 'it' : 'they'} could not be verified. Tejido shows a photo
						or document only when it can check that it is the file that was filed.
					</p>
				{/if}

				<p class="proof">
					<a class="tap" href={entry.proofPath}>See the proof behind this entry</a>
				</p>
			</li>
		{/each}
	</ol>

	{#if data.nextShow !== null}
		<p class="older">
			<a
				class="button"
				href="?show={data.nextShow}#timeline"
				data-sveltekit-noscroll
				data-sveltekit-replacestate
			>
				Show {data.nextShow - data.entries.length} older
				{data.nextShow - data.entries.length === 1 ? 'entry' : 'entries'}
			</a>
			<span class="muted">{data.total - data.entries.length} not shown yet</span>
		</p>
	{/if}
{/if}

<style>
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.campaign,
	.alert,
	.timeline,
	.empty,
	.older {
		max-width: 46rem;
	}

	/* The campaign header: deliberately small. The milestone page holds the detail. */
	.for {
		margin: 0 0 0.75rem;
	}
	.milestones {
		list-style: none;
		padding: 0;
		margin: 0;
		border-top: 1px solid var(--line);
	}
	.milestones li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0 0.6rem;
		padding: 0 0 0.4rem;
		border-bottom: 1px solid var(--line);
	}
	.milestones a {
		font-weight: 600;
		color: var(--ink);
	}
	.more {
		margin: 0;
	}
	.about {
		margin: 0 0 0.9rem;
		overflow-wrap: anywhere;
	}
	.pill {
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 999px;
		padding: 1px 9px;
		border: 1.5px solid var(--muted);
		color: var(--muted);
		white-space: nowrap;
	}
	.for .pill {
		margin-right: 0.35rem;
	}
	.state-confirmed_independent,
	.campaign-delivered {
		border-color: var(--a);
		background: var(--a);
		color: #fff;
	}
	.state-confirmed_creator {
		border-color: var(--a);
		color: var(--a);
	}
	.state-claimed {
		border-color: var(--c);
		color: var(--c);
		border-style: dashed;
	}
	.campaign-overdue {
		border-color: var(--warn);
		color: var(--warn);
	}

	/* Flagged entries are announced above the feed, wherever in it they are. */
	.alert {
		margin-top: 1.5rem;
		padding: 0.8rem 1rem;
		border: 2px solid var(--warn);
		border-radius: 8px;
		background: color-mix(in srgb, var(--warn) 7%, var(--surface));
	}
	.alert p,
	.alert ul {
		margin: 0.25rem 0;
	}
	.alert ul {
		padding-left: 1.2rem;
	}
	.alert-title {
		font-weight: 700;
		color: var(--warn);
	}
	.alert a {
		color: var(--warn);
	}

	.count {
		font-weight: 400;
		margin-left: 0.4rem;
	}
	.empty {
		background: var(--surface);
		border: 1px dashed var(--line);
		border-radius: 8px;
		padding: 1.25rem 1rem;
		color: var(--muted);
	}

	.timeline {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.9rem;
	}
	/* The left edge repeats the status: solid for what was matched to the ledger, dashed for
	   what is only a report, heavy and tinted for a flag. */
	.entry {
		min-width: 0;
		background: var(--surface);
		border: 1px solid var(--line);
		border-left: 5px solid var(--line);
		border-radius: 8px;
		padding: 0.9rem 1rem;
		scroll-margin-top: 1rem;
	}
	.entry.verified {
		border-left-color: var(--a);
	}
	.entry.filed {
		border-left-style: dashed;
		border-left-color: var(--muted);
	}
	.entry.incomplete {
		border-left-style: dashed;
		border-left-color: var(--c);
	}
	.entry.flagged {
		border: 2px solid var(--warn);
		border-left-width: 8px;
		background: color-mix(in srgb, var(--warn) 5%, var(--surface));
	}
	.entry p {
		margin: 0.35rem 0;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 0.25rem 0.75rem;
	}
	h3 {
		font-size: 1.1rem;
		margin: 0.55rem 0 0.1rem;
	}
	.on {
		font-weight: 400;
		color: var(--muted);
	}
	.reason {
		border-radius: 6px;
		padding: 0.45rem 0.65rem;
		font-size: 0.95rem;
	}
	.incomplete .reason {
		background: color-mix(in srgb, var(--c) 10%, var(--surface));
		color: var(--c);
	}
	.flagged .reason {
		background: var(--warn);
		color: #fff;
		font-weight: 550;
	}
	.summary {
		overflow-wrap: anywhere;
	}

	.facts {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem 1.5rem;
		margin: 0.6rem 0;
	}
	.facts dt {
		font-size: 0.75rem;
		color: var(--muted);
	}
	.facts dd {
		margin: 0;
		font-size: 0.95rem;
		overflow-wrap: anywhere;
	}
	.work {
		font-weight: 600;
	}
	.work-on_track {
		color: var(--a);
	}
	.work-delayed {
		color: var(--c);
	}
	.work-blocked {
		color: var(--warn);
	}
	.work-delayed::before {
		content: '▲ ';
		font-size: 0.7em;
	}
	.work-blocked::before {
		content: '■ ';
		font-size: 0.7em;
	}
	.percent {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-variant-numeric: tabular-nums;
	}
	.bar {
		width: 6rem;
		height: 0.45rem;
		border-radius: 999px;
		background: var(--line);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--muted);
	}

	.photos {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr));
		gap: 0.6rem;
	}
	figure {
		margin: 0;
	}
	img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: 6px;
		background: var(--line);
		/* The caption text shown if the picture cannot be loaded. */
		font-size: 0.8rem;
		color: var(--muted);
	}
	figcaption {
		font-size: 0.85rem;
		color: var(--muted);
		margin-top: 0.25rem;
	}
	.documents {
		margin: 0.6rem 0;
		padding-left: 1.2rem;
		font-size: 0.95rem;
	}
	.left-out {
		font-size: 0.9rem;
		color: var(--c);
		border-left: 3px dashed var(--c);
		padding-left: 0.6rem;
	}
	.entry .proof {
		margin: 0.2rem 0 -0.5rem;
		font-size: 0.95rem;
		font-weight: 600;
	}
	.flagged .proof a {
		color: var(--warn);
	}

	.older {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 0.5rem 1rem;
		margin-top: 1.25rem;
	}
	.button {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 1rem;
		border: 1.5px solid var(--a);
		border-radius: 8px;
		background: var(--surface);
		font-weight: 600;
		text-decoration: none;
	}
</style>
