<script lang="ts">
	import { formatAmount, isRefunded } from '@tejido/contracts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const partyOf = (id: string) => data.parties.find((party) => party.id === id);
	const milestoneOf = (id: string) => data.milestones.find((milestone) => milestone.id === id);
	const depositOf = (entryId: string) =>
		data.deposits.find((deposit) => deposit.entryId === entryId);

	const when = (timestamp: string) =>
		new Date(timestamp).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'UTC',
			timeZoneName: 'short'
		});

	const STATE_LABEL = {
		open: 'Open',
		claimed: 'Reported only',
		confirmed_independent: 'Confirmed independently',
		confirmed_creator: 'Confirmed by the creator'
	} as const;
</script>

<svelte:head><title>{data.campaign.title} · Tejido</title></svelte:head>

<p class="eyebrow">A2 · Donor timeline · {data.campaign.status}</p>
<h1>{data.campaign.title}</h1>
<p class="summary">{data.campaign.summary}</p>
<p class="muted">For {data.campaign.beneficiary}. Created by {data.campaign.creatorName}.</p>

<h2>Milestones</h2>
<ul class="milestones">
	{#each data.milestones as milestone (milestone.id)}
		<li>
			<strong>{milestone.title}</strong>
			<span class="pill state-{milestone.state}">{STATE_LABEL[milestone.state]}</span>
			<span class="muted">
				due {milestone.dueDate} · {partyOf(milestone.ownerPartyId)?.name} · confirmer
				{partyOf(milestone.confirmerPartyId)?.name}
			</span>
		</li>
	{/each}
</ul>

<h2>Timeline</h2>
<ol class="timeline">
	{#each data.entries as entry (entry.id)}
		{@const deposit = depositOf(entry.id)}
		<li class="entry">
			<header>
				<span class="pill status-{entry.status}">{entry.status}</span>
				<strong>
					{#if entry.item === 'log_work'}
						Work log
					{:else if entry.inputs.claim === 'confirm'}
						Milestone confirmed
					{:else}
						Milestone hit: {entry.inputs.claim.replace('_', ' ')}
					{/if}
				</strong>
				<span class="muted">· {milestoneOf(entry.milestoneId)?.title}</span>
			</header>

			<p class="muted">
				{partyOf(entry.partyId)?.name}, {partyOf(entry.partyId)?.title} · filed {when(
					entry.filedAt
				)}
			</p>
			<p>{entry.inputs.summary}</p>

			{#if entry.item === 'log_work' && entry.inputs.percent_complete !== undefined}
				<p class="muted">
					{entry.inputs.percent_complete}% complete{entry.inputs.status
						? ` · ${entry.inputs.status.replace('_', ' ')}`
						: ''}{entry.inputs.period ? ` · ${entry.inputs.period}` : ''}
				</p>
			{/if}

			{#if entry.statusReason}
				<p class="reason">{entry.statusReason}</p>
			{/if}

			{#if entry.inputs.photos?.length}
				<ul class="photos">
					{#each entry.inputs.photos as photo (photo.sha256)}
						<li>
							{photo.caption ?? 'Evidence'}
							<code title={photo.sha256}>sha256 {photo.sha256.slice(0, 12)}…</code>
						</li>
					{/each}
				</ul>
			{/if}

			<footer class="muted">
				{#if entry.twistId}
					<code title={entry.twistId}>twist {entry.twistId.slice(0, 14)}…</code>
					paid from <code>{entry.payingWallet}</code>
				{:else}
					Not yet matched to the ledger.
				{/if}
				{#if deposit}
					· deposit {formatAmount(deposit.amount)}
					{isRefunded(deposit) ? 'returned' : 'held'}
				{/if}
				· <a href="/campaigns/{data.campaign.id}/entries/{entry.id}">proof</a>
			</footer>
		</li>
	{:else}
		<li class="muted">No entries yet.</li>
	{/each}
</ol>

<style>
	.summary {
		max-width: 44rem;
		font-size: 1.1rem;
	}
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.milestones,
	.timeline,
	.photos {
		list-style: none;
		padding: 0;
		margin: 0;
	}
	.milestones {
		display: grid;
		gap: 0.5rem;
	}
	.timeline {
		display: grid;
		gap: 0.75rem;
		max-width: 46rem;
	}
	.entry {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.9rem 1rem;
	}
	.entry p {
		margin: 0.35rem 0;
	}
	.photos {
		font-size: 0.9rem;
		display: grid;
		gap: 0.2rem;
		margin: 0.5rem 0;
	}
	.reason {
		color: var(--warn);
		font-size: 0.9rem;
	}
	.pill {
		font-size: 0.75rem;
		font-weight: 600;
		border-radius: 999px;
		padding: 1px 9px;
		border: 1.5px solid var(--muted);
		color: var(--muted);
		margin-right: 0.35rem;
		white-space: nowrap;
	}
	.status-verified,
	.state-confirmed_independent {
		border-color: var(--a);
		color: var(--a);
	}
	.status-flagged {
		border-color: var(--warn);
		color: var(--warn);
	}
	.status-incomplete,
	.state-claimed,
	.state-confirmed_creator {
		border-color: var(--c);
		color: var(--c);
	}
	footer {
		margin-top: 0.5rem;
	}
</style>
