<!--
  ConfirmationStrength: how the person who confirmed relates to the project. One, two or three
  threads mark the category: participant, stakeholder, independent. It is a category, never a
  score, and it is always shown with the person and the reason.

  <ConfirmationStrength strength="stakeholder" who="Yvonne Campbell, head teacher." />
-->
<script lang="ts">
	import { Icon, STATES, type Relationship } from '@tejido/ui';

	let { strength, who }: { strength: Relationship; who: string } = $props();

	const def = $derived(STATES[strength]);
</script>

<div class="tj-strength">
	<span class="tj-strength__mark" aria-hidden="true">
		<Icon name={def.icon} />
		<span class="tj-strength__threads">
			{#each [1, 2, 3] as thread (thread)}<i class={{ on: thread <= def.threads }}></i>{/each}
		</span>
	</span>
	<p class="tj-strength__label">{def.label}</p>
	<p class="tj-strength__who">{who}</p>
</div>
