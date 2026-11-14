<!--
  StatusBadge: one badge for every trust layer. Shape (icon) + word + tone; never colour alone.
  The layer name is read to screen readers ("Filing: Receipt verified"). Its trailing space is
  written as an expression because Svelte trims plain trailing spaces.

  <StatusBadge state="verified" />
  <StatusBadge state="overdue" label="Overdue · 8 days" />
  <StatusBadge state="independent" label="Independent" plain />
-->
<script lang="ts">
	import Icon from './Icon.svelte';
	import { STATES, type StateKey } from './states.ts';

	let {
		state,
		label = undefined,
		plain = false
	}: {
		state: StateKey;
		/** Override the visible label, e.g. to add a count. Keep the state's meaning. */
		label?: string;
		/** No fill or border, for dense rows. Not for flagged or overdue. */
		plain?: boolean;
	} = $props();

	const def = $derived(STATES[state]);
</script>

<span
	class={[
		'tj-badge',
		`tj-tone--${def.tone}`,
		!plain && 'solid' in def && def.solid && 'tj-badge--solid',
		!plain && 'dashed' in def && def.dashed && 'tj-badge--dashed',
		plain && 'tj-badge--plain'
	]}
	title={def.text}
>
	<Icon name={def.icon} size={16} />
	<span><span class="tj-vh">{`${def.layer}: `}</span>{label ?? def.label}</span>
</span>
