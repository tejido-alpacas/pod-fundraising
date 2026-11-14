<!--
  Confirmation strength: how the person who confirms relates to the project. The threads mark the
  category (one, two or three). They are not a score: no stars, no numbers, no percentages.

  <Strength strength="stakeholder" who="Head teacher of the school whose library is being rebuilt." />
-->
<script lang="ts">
	import type { PartyRelationship } from '@tejido/contracts';
	import { Icon, STATES } from '@tejido/ui';
	import { STRENGTH_THREADS } from './display.ts';

	let {
		strength,
		who
	}: {
		strength: PartyRelationship;
		/** The person and the reason, in a sentence. */
		who: string;
	} = $props();
</script>

<div class="tj-strength">
	<span class="tj-strength__mark" aria-hidden="true">
		<Icon name={STATES[strength].icon} />
		<span class="tj-strength__threads">
			{#each [1, 2, 3] as thread (thread)}<i class={{ on: thread <= STRENGTH_THREADS[strength] }}
				></i>{/each}
		</span>
	</span>
	<p class="tj-strength__label">
		<span class="tj-vh">Confirmation: </span>{STATES[strength].label}
	</p>
	<p class="tj-strength__who">{who}</p>
</div>
