<!--
  MilestoneRow: one milestone in a list. Status and exception are separate badges; a confirmed
  milestone's number is drawn solid, a claimed one dashed. Use inside <div class="tj-msrows">.

  <MilestoneRow {milestone} owner="Coral Ridge Builders" status="in-progress" overdueDays={8}
                when="Due 6 Nov · 14 of 22 window frames reported" href="/campaigns/library-wing/milestones/m4-frames" />
-->
<script lang="ts">
	import type { Milestone } from '@tejido/contracts';
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { STATES, type Relationship } from './states.ts';

	let {
		milestone,
		owner,
		status,
		when,
		href,
		overdueDays = 0,
		strength = null
	}: {
		milestone: Pick<Milestone, 'position' | 'title'>;
		owner: string;
		status: 'not-started' | 'in-progress' | 'claimed' | 'confirmed';
		/** One plain line: "Due 27 Nov · 35% reported", "Confirmed 30 Oct". */
		when: string;
		href: string;
		overdueDays?: number;
		strength?: Relationship | null;
	} = $props();

	const tone = $derived(overdueDays > 0 ? 'critical' : STATES[status].tone);
	const strengthLabel = {
		participant: 'Participant',
		stakeholder: 'Stakeholder',
		independent: 'Independent'
	} as const;
</script>

<a
	class={[
		'tj-msrow',
		`tj-tone--${tone}`,
		status === 'confirmed' && 'tj-msrow--confirmed',
		status === 'claimed' && 'tj-msrow--claimed'
	]}
	{href}
>
	<span class="tj-msrow__n" aria-hidden="true">{milestone.position}</span>
	<div class="tj-msrow__main">
		<p class="tj-msrow__title">
			<span class="tj-vh">{`Milestone ${milestone.position}: `}</span>{milestone.title}
		</p>
		<p class="tj-msrow__meta">{owner} · {when}</p>
	</div>
	<div class="tj-msrow__status">
		<StatusBadge state={status} />
		{#if overdueDays > 0}<StatusBadge
				state="overdue"
				label="Overdue · {overdueDays} {overdueDays === 1 ? 'day' : 'days'}"
			/>{/if}
		{#if strength}<StatusBadge state={strength} label={strengthLabel[strength]} plain />{/if}
	</div>
	<Icon name="chevron-right" class="tj-msrow__chev" />
</a>
