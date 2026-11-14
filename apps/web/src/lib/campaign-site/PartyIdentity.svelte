<!--
  Who someone is on this campaign: name, what they are, and how they relate to the project.
  The relationship is a category with its reason, never a score.

  <PartyIdentity name="Yvonne Campbell" role="Head teacher" relationship="stakeholder" reason="Head teacher of the school." />
-->
<script lang="ts">
	import type { PartyRelationship } from '@tejido/contracts';
	import { Icon, STATES } from '@tejido/ui';
	import { STRENGTH_SHORT, initials } from './display.ts';

	let {
		name,
		role,
		relationship = null,
		reason = null
	}: {
		name: string;
		role: string | null;
		relationship?: PartyRelationship | null;
		/** The organiser's reason for the relationship, when one was recorded. */
		reason?: string | null;
	} = $props();
</script>

<div class="tj-party">
	<span class="tj-avatar" aria-hidden="true">{initials(name)}</span>
	<div>
		<p class="tj-party__name">{name}</p>
		{#if role}<p class="tj-party__role">{role}</p>{/if}
	</div>
	{#if relationship}
		<div class="tj-party__rel">
			<span class="tj-badge tj-tone--neutral tj-badge--plain">
				<Icon name={STATES[relationship].icon} size={16} />
				<span
					><span class="tj-vh">Relationship to the project: </span>{STRENGTH_SHORT[
						relationship
					]}{reason ? ` · ${reason}` : ''}</span
				>
			</span>
		</div>
	{/if}
</div>
