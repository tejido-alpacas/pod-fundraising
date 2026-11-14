<!--
  TimelineCard: one filed entry woven onto the timeline thread. The node shows the FILING state
  (receipt shapes); the milestone's own state is shown elsewhere. Every card ends with its deposit
  state and a route to the proof.

  <TimelineCard {entry} {milestone} {party} {deposit} proofHref="/campaigns/library-wing/entries/ent-m2-log-1" />
-->
<script lang="ts">
	import type { Deposit, Entry, Milestone, Party } from '@tejido/contracts';
	import { formatAmount, isRefunded } from '@tejido/contracts';
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { STATES, filingState } from './states.ts';

	let {
		entry,
		milestone,
		party,
		deposit = undefined,
		proofHref,
		title = undefined,
		excludedCount = 0
	}: {
		entry: Entry;
		milestone: Pick<Milestone, 'id' | 'position' | 'title'>;
		party: Pick<Party, 'name' | 'title'>;
		deposit?: Deposit;
		proofHref: string;
		/** A short human headline. Defaults to the first sentence of the summary. */
		title?: string;
		/** Files left out of the evidence (shown as a twill tile, never hidden). */
		excludedCount?: number;
	} = $props();

	const state = $derived(filingState(entry));
	const tone = $derived(STATES[state].tone);
	const kind = $derived(
		entry.item === 'log_work'
			? 'Work log'
			: entry.inputs.claim === 'confirm'
				? 'Confirmation'
				: 'Milestone claim'
	);
	const headline = $derived(title ?? entry.inputs.summary.split(/(?<=\.)\s/)[0]);
	const time = $derived(
		new Date(entry.filedAt).toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'UTC'
		})
	);
	const photos = $derived(entry.inputs.photos ?? []);
	const variant = $derived(
		state === 'flagged' ? 'flagged' : state === 'incomplete' ? 'incomplete' : ''
	);
</script>

<article class={['tj-entry', `tj-tone--${tone}`, variant && `tj-entry--${variant}`]}>
	<span class="tj-entry__node" aria-hidden="true"><Icon name={STATES[state].icon} size={18} /></span
	>
	<div class="tj-entry__card">
		<header class="tj-entry__head">
			<p class="tj-entry__kicker">{kind} · Milestone {milestone.position}</p>
			<h3 class="tj-entry__title">{headline}</h3>
			<p class="tj-entry__meta">{party.name}, {party.title.toLowerCase()} · {time} UTC</p>
		</header>

		<div class="tj-badges"><StatusBadge {state} /></div>

		<p class="tj-entry__summary">{entry.inputs.summary}</p>

		{#if entry.item === 'log_work'}
			<div class="tj-entry__facts">
				{#if entry.inputs.period}<span><Icon name="calendar" size={16} />{entry.inputs.period}</span
					>{/if}
				{#if entry.inputs.status === 'delayed'}<span
						><Icon name="alert-circle" size={16} />Reported as delayed</span
					>{/if}
				{#if entry.inputs.percent_complete !== undefined}
					<!-- The reporter's own figure. Tejido never computes a delivery percentage. -->
					<span>{entry.inputs.percent_complete}% complete, as reported</span>
				{/if}
			</div>
		{/if}

		{#if photos.length || excludedCount}
			<div class="tj-entry__thumbs">
				{#each photos as photo (photo.sha256)}
					{#if photo.url.endsWith('.pdf')}
						<span class="tj-thumb"
							><Icon name="file-text" size={26} /><span class="tj-vh"
								>{photo.caption ?? 'Document'}</span
							></span
						>
					{:else}
						<img src={photo.url} alt={photo.caption ?? 'Evidence photo'} loading="lazy" />
					{/if}
				{/each}
				{#each { length: excludedCount } as _, i (i)}
					<span class="tj-thumb tj-thumb--excluded"
						><Icon name="excluded" /><span class="tj-vh">One file left out</span></span
					>
				{/each}
			</div>
		{/if}

		{#if entry.statusReason}
			<p class="tj-entry__reason tj-tone--{tone}">
				<Icon name={STATES[state].icon} size={18} />
				<span>{entry.statusReason}</span>
			</p>
		{/if}

		<footer class="tj-entry__foot">
			{#if deposit}
				<span
					>Deposit {formatAmount(deposit.amount)} {isRefunded(deposit) ? 'refunded' : 'held'}</span
				>
			{/if}
			<a class="tj-link--standalone" href={proofHref}
				>View proof <Icon name="arrow-right" size={18} /></a
			>
		</footer>
	</div>
</article>
