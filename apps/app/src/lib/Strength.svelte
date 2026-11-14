<!--
  Strength: how donors are shown a confirmer, from their recorded relationship to the project.
  One, two or three threads mark the category. It is a category, never a score.

  <Strength relationship="stakeholder" who="Head teacher of the school." />
-->
<script lang="ts">
	import type { PartyRelationship } from '@tejido/contracts';
	import { Icon, STATES } from '@tejido/ui';

	let {
		relationship,
		who = undefined
	}: {
		/** Already resolved with `shownRelationship`: an unrecorded one arrives as stakeholder. */
		relationship: PartyRelationship;
		/** The organiser's reason, when one was recorded. */
		who?: string | null;
	} = $props();

	const def = $derived(STATES[relationship]);
</script>

<div class="tj-strength">
	<span class="tj-strength__mark" aria-hidden="true">
		<Icon name={def.icon} />
		<span class="tj-strength__threads">
			{#each [1, 2, 3] as thread (thread)}<i class={{ on: thread <= def.threads }}></i>{/each}
		</span>
	</span>
	<p class="tj-strength__label">{def.label}</p>
	{#if who}<p class="tj-strength__who">{who}</p>{/if}
</div>
