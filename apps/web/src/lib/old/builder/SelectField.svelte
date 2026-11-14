<!--
  SelectField: one labelled choice from a short list, with its help line and its error.

  <SelectField id="milestones-k1-kind" label="Kind of milestone" bind:value={milestone.kind}
    options={[{ value: 'construction', label: 'Construction' }]} placeholder="Choose a kind" />
-->
<script lang="ts">
	import { Icon } from '@tejido/ui';
	import FieldError from './FieldError.svelte';

	let {
		id,
		label,
		value = $bindable(),
		options,
		placeholder,
		error = undefined,
		help = undefined
	}: {
		id: string;
		label: string;
		value: string;
		options: { value: string; label: string }[];
		/** The first, empty option: "Choose a kind". */
		placeholder: string;
		error?: string | undefined;
		help?: string | undefined;
	} = $props();

	const describedBy = $derived(
		[error ? `${id}-err` : null, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="tj-field">
	<label class="tj-label" for={id}>{label}</label>
	<span class="tj-select-wrap">
		<select
			class="tj-select"
			{id}
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy}
		>
			<option value="">{placeholder}</option>
			{#each options as option (option.value)}
				<option value={option.value}>{option.label}</option>
			{/each}
		</select>
		<Icon name="chevron-down" size={18} />
	</span>
	{#if help}<p class="tj-help" id="{id}-help">{help}</p>{/if}
	<FieldError id="{id}-err" message={error} />
</div>
