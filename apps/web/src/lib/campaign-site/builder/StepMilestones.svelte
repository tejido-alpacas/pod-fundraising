<!--
  StepMilestones: the builder's milestones. The one being edited is a full form; the others
  collapse into rows, each a link that opens it. Add, reorder and remove are buttons.

  <StepMilestones bind:draft {errors} editKey={…} />
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { milestoneKindSchema } from '@tejido/contracts';
	import { Button, EmptyState, MilestoneRow } from '@tejido/ui';
	import { MAX_MILESTONES, emptyMilestone, type BuilderDraft, type FieldErrors } from './draft.ts';
	import Field from './Field.svelte';
	import FieldError from './FieldError.svelte';
	import { fieldId } from './ids.ts';
	import ItemActions from './ItemActions.svelte';
	import SelectField from './SelectField.svelte';
	import { KIND_HELP, KIND_LABEL, formatDue } from './words.ts';

	let {
		draft = $bindable(),
		errors,
		editKey
	}: { draft: BuilderDraft; errors: FieldErrors; editKey: string | null } = $props();

	const KINDS = milestoneKindSchema.options.map((kind) => ({
		value: kind,
		label: KIND_LABEL[kind]
	}));

	const open = (key: string | null) =>
		goto(key === null ? '?step=milestones' : `?step=milestones&edit=${key}`, { reset: false });

	function add() {
		const milestone = emptyMilestone();
		draft.milestones.push(milestone);
		void open(milestone.key);
	}
	function remove(key: string) {
		draft.milestones = draft.milestones.filter((milestone) => milestone.key !== key);
		if (editKey === key) void open(null);
	}
	function move(index: number, by: -1 | 1) {
		const next = [...draft.milestones];
		const [moved] = next.splice(index, 1);
		if (!moved) return;
		next.splice(index + by, 0, moved);
		draft.milestones = next;
	}

	const problemsOf = (key: string) =>
		Object.entries(errors).filter(([name]) => name.startsWith(`milestones.${key}.`));
</script>

<FieldError id={fieldId('milestones._')} message={errors['milestones._']} />

{#if draft.milestones.length === 0}
	<EmptyState icon="flag" title="No milestones yet">
		A milestone is one thing a donor could check with their own eyes: a slab poured, books on the
		shelves. Add the first one.
	</EmptyState>
{/if}

{#each draft.milestones as milestone, index (milestone.key)}
	{@const at = `milestones.${milestone.key}`}
	{@const what = `milestone ${index + 1}`}
	{#if milestone.key === editKey}
		<div class="tj-card editing">
			<p class="text-eyebrow">Milestone {index + 1}</p>
			<Field
				id={fieldId(`${at}.title`)}
				label="Name"
				bind:value={milestone.title}
				error={errors[`${at}.title`]}
			/>
			<Field
				id={fieldId(`${at}.description`)}
				label="What will be delivered"
				multiline
				bind:value={milestone.description}
				help="Describe it so a donor could check it with their own eyes."
				error={errors[`${at}.description`]}
			/>
			<SelectField
				id={fieldId(`${at}.kind`)}
				label="Kind of milestone"
				placeholder="Choose a kind"
				options={KINDS}
				bind:value={milestone.kind}
				help={milestone.kind === '' ? undefined : KIND_HELP[milestone.kind]}
				error={errors[`${at}.kind`]}
			/>
			<Field
				id={fieldId(`${at}.dueDate`)}
				label="Due date"
				type="date"
				bind:value={milestone.dueDate}
				error={errors[`${at}.dueDate`]}
			/>
			<div class="item-foot">
				<ItemActions
					{what}
					first={index === 0}
					last={index === draft.milestones.length - 1}
					onup={() => move(index, -1)}
					ondown={() => move(index, 1)}
					onremove={() => remove(milestone.key)}
				/>
				<Button size="sm" icon="check" onclick={() => open(null)}>
					Done<span class="tj-vh"> editing {what}</span>
				</Button>
			</div>
		</div>
	{:else}
		<div class="collapsed" data-sveltekit-reset="false">
			<div class="tj-msrows">
				<MilestoneRow
					milestone={{ position: index + 1, title: milestone.title.trim() || 'Untitled milestone' }}
					owner={milestone.kind === '' ? 'Kind not chosen' : KIND_LABEL[milestone.kind]}
					when={milestone.dueDate === ''
						? 'No due date yet'
						: `Due ${formatDue(milestone.dueDate)}`}
					status="not-started"
					href="?step=milestones&edit={milestone.key}"
				/>
			</div>
			{#each problemsOf(milestone.key) as [name, message] (name)}
				<FieldError id={fieldId(name)} {message} />
			{/each}
			<ItemActions
				{what}
				first={index === 0}
				last={index === draft.milestones.length - 1}
				onup={() => move(index, -1)}
				ondown={() => move(index, 1)}
				onremove={() => remove(milestone.key)}
			/>
		</div>
	{/if}
{/each}

{#if draft.milestones.length < MAX_MILESTONES}
	<Button block size="field" icon="plus" onclick={add}>Add milestone</Button>
{/if}

<style>
	.editing {
		gap: var(--space-4);
	}
	.item-foot {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
		align-items: center;
		justify-content: space-between;
		padding-top: var(--space-3);
		border-top: var(--border-hair) solid var(--border);
	}
	.collapsed {
		display: grid;
		gap: var(--space-2);
	}
</style>
