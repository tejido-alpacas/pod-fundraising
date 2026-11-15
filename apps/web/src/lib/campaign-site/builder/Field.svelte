<!--
  Field: one labelled text input or textarea, with its help line and its error.

  The error is tied to the input with aria-describedby and marks it aria-invalid. Inputs are
  16px (the design system's tj-input), so a phone does not zoom.

  <Field id="project-title" label="Project name" bind:value={draft.project.title} error={errors['project.title']} />
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';
	import FieldError from './FieldError.svelte';

	let {
		id,
		label,
		value = $bindable(),
		error = undefined,
		help = undefined,
		optional = false,
		multiline = false,
		rows = 3,
		type = 'text',
		maxlength = undefined,
		autocomplete = 'off',
		inputmode = undefined
	}: {
		id: string;
		label: string;
		value: string;
		error?: string | undefined;
		help?: string | undefined;
		optional?: boolean;
		multiline?: boolean;
		rows?: number;
		type?: 'text' | 'email' | 'date';
		maxlength?: number | undefined;
		autocomplete?: HTMLInputAttributes['autocomplete'];
		inputmode?: HTMLInputAttributes['inputmode'];
	} = $props();

	const describedBy = $derived(
		[error ? `${id}-err` : null, help ? `${id}-help` : null].filter(Boolean).join(' ') || undefined
	);
</script>

<div class="tj-field">
	<label class="tj-label" for={id}>
		{label}
		{#if optional}<span class="tj-label__opt">(optional)</span>{/if}
	</label>
	{#if multiline}
		<textarea
			class="tj-textarea"
			{id}
			{rows}
			{maxlength}
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy}></textarea>
	{:else}
		<input
			class="tj-input"
			{id}
			{type}
			{maxlength}
			{autocomplete}
			{inputmode}
			bind:value
			aria-invalid={error ? 'true' : undefined}
			aria-describedby={describedBy}
		/>
	{/if}
	{#if help}<p class="tj-help" id="{id}-help">{help}</p>{/if}
	<FieldError id="{id}-err" message={error} />
</div>
