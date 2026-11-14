<!--
  StepPeople: who does the work, who confirms it, and which of them is named on each
  milestone. A person being edited is a full form; the others collapse into rows.

  <StepPeople bind:draft {errors} {notices} editKey={…} />
-->
<script lang="ts">
	import { goto } from '$app/navigation';
	import type { PartyRole } from '@tejido/contracts';
	import { Banner, Button, Icon, StatusBadge } from '@tejido/ui';
	import { initials } from '#lib/campaign-site/display.ts';
	import {
		MAX_PEOPLE,
		emptyPerson,
		type BuilderDraft,
		type DraftPerson,
		type FieldErrors,
		type Notice
	} from './draft.ts';
	import Field from './Field.svelte';
	import FieldError from './FieldError.svelte';
	import { fieldId } from './ids.ts';
	import ItemActions from './ItemActions.svelte';
	import SelectField from './SelectField.svelte';
	import { RELATIONSHIP_CHOICES, RELATIONSHIP_LABEL } from './words.ts';

	let {
		draft = $bindable(),
		errors,
		notices,
		editKey
	}: {
		draft: BuilderDraft;
		errors: FieldErrors;
		notices: Notice[];
		editKey: string | null;
	} = $props();

	const GROUPS: {
		role: PartyRole;
		title: string;
		sub: string;
		add: string;
		titleLabel: string;
		titleHelp: string;
	}[] = [
		{
			role: 'third_party',
			title: 'The people doing the work',
			sub: 'The contractors and suppliers. Each files a work report on the schedule you choose, and reports a milestone when it is done.',
			add: 'Add a contractor or supplier',
			titleLabel: 'What they do',
			titleHelp: 'For example “Contractor” or “Book supplier”. Donors see this next to their name.'
		},
		{
			role: 'confirmer',
			title: 'The people confirming it',
			sub: 'People who didn’t do the work. Donors will see how each one is related to the project.',
			add: 'Add a confirmer',
			titleLabel: 'Who they are',
			titleHelp:
				'For example “Head teacher” or “Parish building inspector”. Donors see this next to their name.'
		}
	];

	const open = (key: string | null) =>
		goto(key === null ? '?step=people' : `?step=people&edit=${key}`, { reset: false });

	function add(role: PartyRole) {
		const person = emptyPerson(role);
		draft.people.push(person);
		void open(person.key);
	}
	function remove(key: string) {
		draft.people = draft.people.filter((person) => person.key !== key);
		for (const milestone of draft.milestones) {
			if (milestone.ownerKey === key) milestone.ownerKey = '';
			if (milestone.confirmerKey === key) milestone.confirmerKey = '';
		}
		if (editKey === key) void open(null);
	}

	const named = (person: DraftPerson) => person.name.trim() || 'Unnamed';
	const option = (person: DraftPerson) => ({
		value: person.key,
		label: person.title.trim() ? `${named(person)} · ${person.title.trim()}` : named(person)
	});
	const workers = $derived(draft.people.filter((person) => person.role === 'third_party'));
	const confirmers = $derived(draft.people.filter((person) => person.role === 'confirmer'));
	const problemsOf = (key: string) =>
		Object.entries(errors).filter(([name]) => name.startsWith(`people.${key}.`));
</script>

<FieldError id={fieldId('people._')} message={errors['people._']} />

{#each GROUPS as group (group.role)}
	{@const members = draft.people.filter((person) => person.role === group.role)}
	<section class="tj-section" aria-labelledby="people-{group.role}">
		<div class="head">
			<h2 class="tj-section__title" id="people-{group.role}">{group.title}</h2>
			<p class="tj-section__sub">{group.sub}</p>
		</div>
		<FieldError id={fieldId(`people.${group.role}`)} message={errors[`people.${group.role}`]} />

		{#each members as person (person.key)}
			{@const at = `people.${person.key}`}
			{#if person.key === editKey}
				<div class="tj-card editing">
					<Field
						id={fieldId(`${at}.name`)}
						label="Name"
						bind:value={person.name}
						error={errors[`${at}.name`]}
					/>
					<Field
						id={fieldId(`${at}.title`)}
						label={group.titleLabel}
						bind:value={person.title}
						help={group.titleHelp}
						error={errors[`${at}.title`]}
					/>
					<Field
						id={fieldId(`${at}.email`)}
						label="Email for the invitation"
						type="email"
						inputmode="email"
						bind:value={person.email}
						help="Only this address can accept the invitation. It is never shown to donors."
						error={errors[`${at}.email`]}
					/>
					{#if person.role === 'confirmer'}
						{@const relId = fieldId(`${at}.relationship`)}
						<fieldset
							class="choices"
							aria-describedby="{relId}-help{errors[`${at}.relationship`] ? ` ${relId}-err` : ''}"
						>
							<legend class="tj-label">How are they related to the project?</legend>
							<div class="tj-choices" id={relId}>
								{#each RELATIONSHIP_CHOICES as choice (choice.value)}
									<label class="tj-check tj-choice">
										<input
											type="radio"
											name="relationship-{person.key}"
											value={choice.value}
											bind:group={person.relationship}
										/>
										<span class="tj-check__text">
											<span>{choice.label}</span>
											<small>{choice.example}</small>
										</span>
									</label>
								{/each}
							</div>
							<p class="tj-help" id="{relId}-help">
								Donors see this next to every confirmation. Don’t choose independent for anyone who
								benefits from the project.
							</p>
							<FieldError id="{relId}-err" message={errors[`${at}.relationship`]} />
						</fieldset>
						<Field
							id={fieldId(`${at}.relationshipReason`)}
							label="Why"
							optional={person.relationship !== 'independent'}
							multiline
							rows={2}
							bind:value={person.relationshipReason}
							help="A sentence donors can read, such as “Employed by the parish council. Not paid by the project.”"
							error={errors[`${at}.relationshipReason`]}
						/>
						{#each notices.filter((notice) => notice.key === person.key) as notice (notice.kind)}
							<Banner tone="attention" icon="alert-triangle" title={notice.title} role="note">
								{notice.body}
							</Banner>
						{/each}
					{/if}
					<div class="foot">
						<ItemActions what={named(person)} onremove={() => remove(person.key)} />
						<Button size="sm" icon="check" onclick={() => open(null)}>
							Done<span class="tj-vh"> editing {named(person)}</span>
						</Button>
					</div>
				</div>
			{:else}
				<div class="collapsed" data-sveltekit-reset="false">
					<a class="tj-card person" href="?step=people&edit={person.key}">
						<div class="tj-party">
							<span class="tj-avatar" aria-hidden="true">{initials(named(person))}</span>
							<div>
								<p class="tj-party__name">{named(person)}</p>
								<p class="tj-party__role">{person.title.trim() || 'Role not given yet'}</p>
							</div>
							{#if person.role === 'confirmer' && person.relationship !== ''}
								<div class="tj-party__rel">
									<StatusBadge
										state={person.relationship}
										label={RELATIONSHIP_LABEL[person.relationship]}
										plain
									/>
								</div>
							{/if}
						</div>
						<span class="tj-vh">Edit</span>
						<Icon name="chevron-right" size={20} />
					</a>
					{#each problemsOf(person.key) as [name, message] (name)}
						<FieldError id={fieldId(name)} {message} />
					{/each}
					{#each notices.filter((notice) => notice.key === person.key) as notice (notice.kind)}
						<Banner tone="attention" icon="alert-triangle" title={notice.title} role="note">
							{notice.body}
						</Banner>
					{/each}
					<ItemActions what={named(person)} onremove={() => remove(person.key)} />
				</div>
			{/if}
		{/each}

		{#if draft.people.length < MAX_PEOPLE}
			<Button block size="field" icon="plus" onclick={() => add(group.role)}>{group.add}</Button>
		{/if}
	</section>
{/each}

{#if draft.milestones.length > 0 && workers.length > 0 && confirmers.length > 0}
	<section class="tj-section" aria-labelledby="people-assign">
		<div class="head">
			<h2 class="tj-section__title" id="people-assign">Who does and who confirms each milestone</h2>
			<p class="tj-section__sub">
				Nobody confirms a milestone they did the work on. One person can confirm several.
			</p>
		</div>
		{#each draft.milestones as milestone, index (milestone.key)}
			{@const at = `assign.${milestone.key}`}
			<div class="tj-card editing">
				<div>
					<p class="text-eyebrow">Milestone {index + 1}</p>
					<p class="assign-title">{milestone.title.trim() || 'Untitled milestone'}</p>
				</div>
				<SelectField
					id={fieldId(`${at}.owner`)}
					label="Who does the work"
					placeholder="Choose a contractor or supplier"
					options={workers.map(option)}
					bind:value={milestone.ownerKey}
					error={errors[`${at}.owner`]}
				/>
				<SelectField
					id={fieldId(`${at}.confirmer`)}
					label="Who confirms it"
					placeholder="Choose a confirmer"
					options={confirmers.map(option)}
					bind:value={milestone.confirmerKey}
					error={errors[`${at}.confirmer`]}
				/>
			</div>
			{#each notices.filter((notice) => notice.key === milestone.key) as notice (notice.kind)}
				<Banner title={notice.title} role="note">{notice.body}</Banner>
			{/each}
		{/each}
	</section>
{:else if draft.milestones.length > 0}
	<Banner title="Next: name who does and who confirms each milestone" role="note">
		Add at least one contractor or supplier and one confirmer. The milestones then appear here.
	</Banner>
{/if}

<style>
	.head {
		display: grid;
		gap: var(--space-1);
	}
	.editing {
		gap: var(--space-4);
	}
	.choices {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: grid;
		gap: var(--space-2);
	}
	.choices legend {
		margin-bottom: var(--space-2);
	}
	.foot {
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
	.person {
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		min-height: 44px;
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.person:hover {
		border-color: var(--border-strong);
	}
	.person :global(.tj-icon) {
		color: var(--text-muted);
	}
	.assign-title {
		font: 600 16px/24px var(--font-sans);
		overflow-wrap: anywhere;
	}
</style>
