<script lang="ts">
	import { formatAmount } from '@tejido/contracts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const late = $derived(data.milestones.filter((milestone) => milestone.daysLate > 0));
	const campaignOverdue = $derived(data.campaign.status === 'overdue');

	const dateTime = (timestamp: string) =>
		new Date(timestamp).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'UTC',
			timeZoneName: 'short'
		});

	/** A calendar date with no time, e.g. a due date. */
	const date = (day: string) =>
		new Date(`${day}T00:00:00Z`).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'UTC'
		});

	const words = (value: string) => value.replaceAll('_', ' ');
	const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);

	// The same words as the donor timeline, so the pages read as one site.
	const CAMPAIGN_STATUS = {
		draft: 'Draft',
		funding: 'Fundraising',
		funded: 'Funded',
		reporting: 'Work under way',
		overdue: 'A report is overdue',
		delivered: 'Delivered'
	} as const;

	/** How strong each confirmation is: the label, and what it means in one sentence. */
	const STATE = {
		confirmed_independent: {
			label: 'Confirmed independently',
			means: 'The named confirmer, who did not do the work, signed it off from their own wallet.'
		},
		confirmed_creator: {
			label: 'Confirmed by the creator',
			means:
				'No independent confirmer answered in the waiting period, so the campaign’s creator signed it off.'
		},
		claimed: {
			label: 'Reported only',
			means: 'The party doing the work says it is done. Nobody has confirmed it yet.'
		},
		open: {
			label: 'Not yet claimed',
			means: 'Nobody has reported this milestone as done yet.'
		}
	} as const;
	const STRENGTHS = ['confirmed_independent', 'confirmed_creator', 'claimed'] as const;

	const ROLE = { third_party: 'does the work', confirmer: 'independent confirmer' } as const;

	const ENTRY_STATUS = {
		verified: 'Verified',
		filed: 'Filed, not yet verified',
		incomplete: 'Incomplete',
		flagged: 'Flagged'
	} as const;

	const entryKind = (entry: { item: string; claim: string | null }) =>
		entry.item === 'log_work'
			? 'Work log'
			: entry.claim === 'confirm'
				? 'Confirmation'
				: `Milestone claim: ${words(entry.claim ?? '')}`;
</script>

{#snippet stateBadge(state: keyof typeof STATE)}
	<span class="badge state-{state}">
		<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
			{#if state === 'confirmed_independent'}
				<path d="M1.5 8.7l2.8 2.8 5-6.5" fill="none" stroke="currentColor" stroke-width="2" />
				<path d="M8 11.5l1 1 5.5-7.500" fill="none" stroke="currentColor" stroke-width="2" />
			{:else if state === 'confirmed_creator'}
				<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" />
			{:else if state === 'claimed'}
				<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
				<path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
			{:else}
				<circle
					cx="8"
					cy="8"
					r="6"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-dasharray="2.6 2.1"
				/>
			{/if}
		</svg>
		{STATE[state].label}
	</span>
{/snippet}

<svelte:head><title>Milestones · {data.campaign.title} · Tejido</title></svelte:head>

<p class="eyebrow">
	<a href="/campaigns/{data.campaign.id}">{data.campaign.title}</a> · {CAMPAIGN_STATUS[
		data.campaign.status
	]}
</p>
<h1>Milestones</h1>
<p class="muted">Where each milestone of this campaign stands, and how strongly it is confirmed.</p>

{#if campaignOverdue || late.length > 0}
	<section class="banner" role="alert">
		<p class="banner-title">
			<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true">
				<path d="M8 1.5l7 12.5H1z" fill="none" stroke="currentColor" stroke-width="1.6" />
				<path d="M8 6v4M8 11.4v1.4" stroke="currentColor" stroke-width="1.8" />
			</svg>
			Overdue
		</p>
		{#if campaignOverdue}
			<p>This campaign is marked overdue: a report that was due has not been filed.</p>
		{/if}
		{#if late.length > 0}
			<p>
				{late.length === 1 ? 'One milestone is' : `${late.length} milestones are`} past the due date and
				not confirmed:
			</p>
			<ul>
				{#each late as milestone (milestone.id)}
					<li>
						<a href="#{milestone.id}">{milestone.title}</a>, due {date(milestone.dueDate)},
						{days(milestone.daysLate)} ago.
						{milestone.state === 'claimed'
							? 'Reported as done, not confirmed.'
							: 'Not reported as done.'}
					</li>
				{/each}
			</ul>
		{/if}
	</section>
{/if}

<section class="legend" aria-label="What the confirmation labels mean">
	<h2>How strong is a confirmation?</h2>
	<dl>
		{#each STRENGTHS as state (state)}
			<dt>{@render stateBadge(state)}</dt>
			<dd>{STATE[state].means}</dd>
		{/each}
	</dl>
</section>

<ol class="milestones">
	{#each data.milestones as milestone, index (milestone.id)}
		<li class="card state-{milestone.state}" class:late={milestone.daysLate > 0} id={milestone.id}>
			<header>
				<h2><span class="number">{index + 1}.</span> {milestone.title}</h2>
				<p class="standing">
					{@render stateBadge(milestone.state)}
					{#if milestone.daysLate > 0}
						<span class="badge overdue">{days(milestone.daysLate)} overdue</span>
					{/if}
				</p>
				<p class="means">
					{STATE[milestone.state].means}
					{#if milestone.confirmedAt}
						Confirmed <time datetime={milestone.confirmedAt}>{dateTime(milestone.confirmedAt)}</time
						>.
					{/if}
				</p>
			</header>

			{#if milestone.description}<p>{milestone.description}</p>{/if}

			<dl class="facts">
				<dt>Kind</dt>
				<dd>{words(milestone.kind)}</dd>
				<dt>Due</dt>
				<dd>
					<time datetime={milestone.dueDate}>{date(milestone.dueDate)}</time>
					{#if milestone.daysLate > 0}
						<strong class="warn">· {days(milestone.daysLate)} ago, not confirmed</strong>
					{/if}
				</dd>
				<dt>Owed by</dt>
				<dd>
					{#if milestone.owner}
						{milestone.owner.name}, {milestone.owner.title}
						<span class="muted">({ROLE[milestone.owner.role]})</span>
					{:else}
						Not on record
					{/if}
				</dd>
				<dt>Confirmed by</dt>
				<dd>
					{#if milestone.confirmer}
						{milestone.confirmer.name}, {milestone.confirmer.title}
						<span class="muted">({ROLE[milestone.confirmer.role]})</span>
					{:else}
						Not on record
					{/if}
				</dd>
				<dt>Latest progress</dt>
				<dd>
					{#if milestone.progress}
						{#if milestone.progress.percentComplete !== null}
							<span class="bar" aria-hidden="true">
								<span style:width="{milestone.progress.percentComplete}%"></span>
							</span>
							<strong>{milestone.progress.percentComplete}% complete</strong>
						{:else}
							No percent given
						{/if}
						{#if milestone.progress.status}· {words(milestone.progress.status)}{/if}
						<span class="muted">
							· as reported in the work log of
							<a href="/campaigns/{data.campaign.id}/entries/{milestone.progress.entryId}"
								>{dateTime(milestone.progress.filedAt)}</a
							>{milestone.progress.period ? ` (${milestone.progress.period})` : ''}
						</span>
					{:else}
						<span class="muted">No work log has been filed on this milestone.</span>
					{/if}
				</dd>
				<dt>Deposits</dt>
				<dd>
					{#if milestone.entries.length === 0}
						<span class="muted">None paid yet.</span>
					{:else}
						{formatAmount(milestone.deposits.paid)} paid · {formatAmount(
							milestone.deposits.returned
						)} returned
						{#if milestone.deposits.returned < milestone.deposits.paid}
							· {formatAmount(milestone.deposits.paid - milestone.deposits.returned)} still held
						{/if}
					{/if}
				</dd>
			</dl>

			<h3>
				{milestone.entries.length === 1 ? '1 entry' : `${milestone.entries.length} entries`}
			</h3>
			{#if milestone.entries.length > 0}
				<ul class="entries">
					{#each milestone.entries as entry (entry.id)}
						<li>
							<span class="chip status-{entry.status}">{ENTRY_STATUS[entry.status]}</span>
							<span>
								<strong>{entryKind(entry)}</strong>
								<span class="muted">
									{#if entry.filedBy}· {entry.filedBy}{/if} · {dateTime(entry.filedAt)}
								</span>
							</span>
							<a href="/campaigns/{data.campaign.id}/entries/{entry.id}">proof</a>
						</li>
					{/each}
				</ul>
			{/if}
		</li>
	{:else}
		<li class="muted">This campaign has no milestones.</li>
	{/each}
</ol>

<p class="muted back"><a href="/campaigns/{data.campaign.id}">Back to the timeline</a></p>

<style>
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.eyebrow a {
		color: inherit;
	}
	.warn {
		color: var(--warn);
	}
	.banner,
	.legend,
	.card {
		max-width: 46rem;
		box-sizing: border-box;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.9rem 1rem;
	}
	.banner {
		border: 2px solid var(--warn);
		border-left-width: 8px;
		margin: 1rem 0;
	}
	.banner p {
		margin: 0.3rem 0;
	}
	.banner ul {
		margin: 0.3rem 0;
		padding-left: 1.2rem;
	}
	.banner-title {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		font-weight: 700;
		font-size: 1.1rem;
		color: var(--warn);
	}
	.legend {
		margin: 1rem 0;
	}
	.legend h2 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
	}
	.legend dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.5rem 1rem;
		margin: 0;
		align-items: start;
	}
	.legend dd {
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.milestones {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.75rem;
	}
	.card {
		border-left: 5px solid var(--line);
		scroll-margin-top: 1rem;
	}
	.card.state-confirmed_independent {
		border-left-color: var(--a);
	}
	.card.state-confirmed_creator,
	.card.state-claimed {
		border-left-color: var(--c);
	}
	.card.late {
		border-left-color: var(--warn);
	}
	.card h2 {
		margin: 0;
	}
	.card h3 {
		font-size: 1rem;
		margin: 1rem 0 0.4rem;
	}
	.card p {
		margin: 0.4rem 0;
	}
	.number {
		color: var(--muted);
		font-weight: 400;
	}
	.standing {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.means {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.85rem;
		font-weight: 650;
		line-height: 1.3;
		border-radius: 999px;
		padding: 2px 11px 2px 8px;
		border: 1.5px dashed currentColor;
		color: var(--muted);
		white-space: nowrap;
	}
	.badge svg {
		flex: none;
	}
	/* Strongest: filled. Creator: a solid outline. Reported only: dashed. Open: dashed grey. */
	.badge.state-confirmed_independent {
		border: 1.5px solid var(--a);
		background: var(--a);
		color: #fff;
	}
	.badge.state-confirmed_creator {
		border: 1.5px solid var(--c);
		color: var(--c);
	}
	.badge.state-claimed {
		color: var(--c);
	}
	.badge.overdue {
		border: 1.5px solid var(--warn);
		background: var(--warn);
		color: #fff;
		padding-left: 11px;
	}
	.facts {
		display: grid;
		grid-template-columns: minmax(7rem, 10rem) 1fr;
		gap: 0.45rem 1rem;
		margin: 0.75rem 0 0;
	}
	.facts dt {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.facts dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.bar {
		display: block;
		height: 0.5rem;
		max-width: 16rem;
		margin: 0.35rem 0 0.25rem;
		border-radius: 999px;
		background: var(--line);
		overflow: hidden;
	}
	.bar span {
		display: block;
		height: 100%;
		background: var(--a);
	}
	.entries {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
	}
	.entries li {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
		padding: 0.45rem 0;
		border-top: 1px solid var(--line);
	}
	.entries li a {
		margin-left: auto;
	}
	.chip {
		font-size: 0.75rem;
		font-weight: 650;
		border-radius: 999px;
		padding: 1px 9px;
		border: 1.5px dashed currentColor;
		color: var(--muted);
		white-space: nowrap;
	}
	.chip.status-verified {
		border: 1.5px solid var(--a);
		background: var(--a);
		color: #fff;
	}
	.chip.status-flagged {
		border: 1.5px solid var(--warn);
		background: var(--warn);
		color: #fff;
	}
	.chip.status-incomplete {
		color: var(--c);
	}
	.back {
		margin-top: 1.5rem;
	}
	@media (max-width: 34rem) {
		.facts,
		.legend dl {
			grid-template-columns: 1fr;
			gap: 0.1rem;
		}
		.facts dd,
		.legend dd {
			margin-bottom: 0.5rem;
		}
	}
</style>
