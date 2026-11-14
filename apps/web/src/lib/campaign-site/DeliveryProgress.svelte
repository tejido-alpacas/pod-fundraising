<!--
  DeliveryProgress: where the work stands, as one segment per milestone. Confirmed is solid,
  claimed is dashed, in progress is hatched, overdue is hatched with a notch, not started is
  empty. It says "N of M milestones confirmed" and never a percentage.

  <DeliveryProgress segments={data.milestones} confirmed={1} total={3} />
-->
<script lang="ts">
	import { STATES } from '@tejido/ui';
	import { days } from './dates.ts';

	interface Segment {
		id: string;
		position: number;
		title: string;
		status: 'not-started' | 'in-progress' | 'claimed' | 'confirmed';
		overdueDays: number;
	}

	let {
		segments,
		confirmed,
		total
	}: {
		segments: Segment[];
		confirmed: number;
		total: number;
	} = $props();

	const SEGMENT = {
		confirmed: 'confirmed',
		claimed: 'claimed',
		'in-progress': 'progress',
		'not-started': 'not-started'
	} as const;

	const segmentClass = (segment: Segment) =>
		segment.status !== 'confirmed' && segment.overdueDays > 0 ? 'overdue' : SEGMENT[segment.status];

	/** What a screen reader hears for one segment. */
	function spoken(segment: Segment): string {
		const status = STATES[segment.status].label.toLowerCase();
		const late = segment.overdueDays > 0 ? `, ${days(segment.overdueDays)} overdue` : '';
		return `Milestone ${segment.position}, ${segment.title}: ${status}${late}`;
	}

	const KEY = [
		['confirmed', 'Confirmed'],
		['claimed', 'Claimed'],
		['progress', 'In progress'],
		['overdue', 'Overdue'],
		['not-started', 'Not started']
	] as const;
</script>

<div class="tj-delivery">
	<p class="text-eyebrow">Delivery</p>
	{#if total === 0}
		<p class="tj-delivery__headline"><span>No milestones have been set yet</span></p>
	{:else}
		<p class="tj-delivery__headline">
			<span class="text-figure">{confirmed} of {total}</span>
			<span>{total === 1 ? 'milestone' : 'milestones'} confirmed</span>
		</p>
		<div>
			<ol class="tj-track" aria-label="Milestones">
				{#each segments as segment (segment.id)}
					<li class="tj-track__seg tj-track__seg--{segmentClass(segment)}">
						<span class="tj-vh">{spoken(segment)}</span>
					</li>
				{/each}
			</ol>
			<div class="tj-track-labels" aria-hidden="true">
				{#each segments as segment (segment.id)}<span>{segment.position}</span>{/each}
			</div>
		</div>
		<ul class="tj-legend" aria-hidden="true">
			{#each KEY as [name, label] (name)}
				<li><span class="tj-track__seg tj-track__seg--{name}"></span>{label}</li>
			{/each}
		</ul>
	{/if}
</div>
