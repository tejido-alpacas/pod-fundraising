<script lang="ts">
	import { enhance } from '$app/forms';
	import { afterNavigate, goto } from '$app/navigation';
	import { page } from '$app/state';
	import { cadenceSchema } from '@tejido/contracts';
	import { Banner, Icon } from '@tejido/ui';
	import { onMount, untrack } from 'svelte';
	import { checkDraft, noticesFor } from '#lib/campaign-site/builder/check.ts';
	import Created from '#lib/campaign-site/builder/Created.svelte';
	import {
		STEPS,
		emptyDraft,
		isStep,
		stepOf,
		type BuilderDraft,
		type CreatedCampaign,
		type FieldErrors,
		type Step
	} from '#lib/campaign-site/builder/draft.ts';
	import ErrorSummary from '#lib/campaign-site/builder/ErrorSummary.svelte';
	import Field from '#lib/campaign-site/builder/Field.svelte';
	import FieldError from '#lib/campaign-site/builder/FieldError.svelte';
	import { fieldId } from '#lib/campaign-site/builder/ids.ts';
	import StepMilestones from '#lib/campaign-site/builder/StepMilestones.svelte';
	import StepPeople from '#lib/campaign-site/builder/StepPeople.svelte';
	import StepReview from '#lib/campaign-site/builder/StepReview.svelte';
	import {
		clearDraft,
		loadCreated,
		loadDraft,
		parseCreated,
		saveCreated,
		saveDraft
	} from '#lib/campaign-site/builder/store.ts';
	import {
		CADENCE_HELP,
		CADENCE_LABEL,
		STEP_NAME,
		UNIT
	} from '#lib/campaign-site/builder/words.ts';

	const HOME = '/';

	const QUESTION: Record<Step, { title: string; lede: string }> = {
		project: {
			title: 'What is the project?',
			lede: 'Say it the way you would to a neighbour. Donors read this first.'
		},
		funding: {
			title: 'How much does the project need?',
			lede: 'Giving happens through Qatom, a payments service. Tejido never holds the money: it reads the total afterwards and shows it beside the goal.'
		},
		milestones: {
			title: 'What will be delivered, and by when?',
			lede: 'Break the project into milestones donors can follow. Each one needs someone responsible for the work and someone else to confirm it.'
		},
		people: {
			title: 'Who does the work, and who confirms it?',
			lede: 'Name the contractors and suppliers, then the people who will confirm each milestone. Choose confirmers who didn’t do the work.'
		},
		schedule: {
			title: 'How often is work reported?',
			lede: 'Between milestones, each contractor and supplier files a short work report. Donors see every one, and see when one is missed.'
		},
		review: {
			title: 'Check it before you create it',
			lede: 'This is what will be saved. Use Edit to change a section.'
		}
	};

	// --- The draft: in the page, and in this tab's storage so a reload keeps it ---
	let draft = $state<BuilderDraft>(emptyDraft());
	let created = $state<CreatedCampaign | null>(null);
	let ready = $state(false);
	let stored = $state(true);
	onMount(() => {
		draft = loadDraft();
		created = loadCreated();
		ready = true;
	});
	$effect(() => {
		if (ready) stored = saveDraft($state.snapshot(draft));
	});

	// --- Where we are: the step and the item being edited are in the address ---
	const requested = $derived(page.url.searchParams.get('step'));
	const step = $derived<Step>(isStep(requested) ? requested : 'project');
	const index = $derived(STEPS.indexOf(step));
	const previous = $derived(STEPS[index - 1]);
	const next = $derived(STEPS[index + 1]);
	const editKey = $derived(page.url.searchParams.get('edit'));
	const showCreated = $derived(page.url.searchParams.has('created') && created !== null);

	// --- What the server said ---
	let errors = $state<FieldErrors>({});
	let refused = $state<string | null>(null);
	let failed = $state(false);
	let busy = $state(false);
	const notices = $derived(noticesFor(draft));

	// A problem the server reported disappears as soon as its field is put right, so a fixed
	// field is not left marked wrong. The server still checks everything again on Continue.
	$effect(() => {
		const still = checkDraft(draft).errors;
		const reported = untrack(() => errors);
		const names = Object.keys(reported);
		if (names.some((name) => !(name in still))) {
			errors = Object.fromEntries(
				names.filter((name) => name in still).map((name) => [name, reported[name] ?? ''])
			);
		}
	});

	function readErrors(data: unknown): FieldErrors {
		if (typeof data !== 'object' || data === null || !('errors' in data)) return {};
		const sent = data.errors;
		if (typeof sent !== 'object' || sent === null) return {};
		const read: FieldErrors = {};
		for (const [name, message] of Object.entries(sent)) {
			if (typeof message === 'string') read[name] = message;
		}
		return read;
	}

	/** A problem's link: to its field, opening the milestone or person it belongs to. */
	function linkTo(name: string): string {
		const [list, key] = name.split('.');
		const target = stepOf(name);
		const opens = (list === 'milestones' || list === 'people') && key !== undefined && key !== '_';
		const editable = opens && key !== 'third_party' && key !== 'confirmer';
		return `?step=${target}${editable ? `&edit=${key}` : ''}#${fieldId(name)}`;
	}

	const problems = $derived(
		Object.entries(errors)
			.filter(([name]) => step === 'review' || stepOf(name) === step)
			.map(([name, message]) => ({
				href: linkTo(name),
				message,
				...(step === 'review' ? { where: STEP_NAME[stepOf(name)] } : {})
			}))
	);

	let heading = $state<HTMLElement>();
	let summary = $state<HTMLElement>();
	afterNavigate((navigation) => {
		// A new step is a new screen: move focus to its question. Opening an item for editing
		// moves focus into its first field instead.
		if (navigation.type === 'enter') return;
		const from = navigation.from?.url.searchParams;
		const to = navigation.to?.url.searchParams;
		if (page.url.hash !== '') return;
		const opened = to?.get('edit');
		const closed = from?.get('edit');
		if (opened) {
			// A person's first field is their name; a milestone's is its title.
			const item = `${step}.${opened}`;
			(
				document.getElementById(fieldId(`${item}.name`)) ??
				document.getElementById(fieldId(`${item}.title`))
			)?.focus();
			return;
		}
		if (closed && from?.get('step') === to?.get('step')) {
			// Back on the row that was being edited, if it is still there.
			document.querySelector<HTMLElement>(`a[href$="edit=${CSS.escape(closed)}"]`)?.focus();
			return;
		}
		if (from?.get('step') !== to?.get('step') || from?.has('created') !== to?.has('created')) {
			heading?.focus();
		}
	});
</script>

<svelte:head>
	<title>Start a campaign · Tejido</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="tj-page builder">
	{#if showCreated && created}
		<Created {created} bind:heading />
	{:else}
		<form
			method="POST"
			action={step === 'review' ? '?/create' : '?/check'}
			novalidate
			use:enhance={({ formData }) => {
				formData.set('draft', JSON.stringify(draft));
				formData.set('step', step);
				const checking = step;
				busy = true;
				refused = null;
				failed = false;
				return async ({ result }) => {
					busy = false;
					if (result.type === 'success' && checking === 'review') {
						const made = parseCreated(
							typeof result.data === 'object' && result.data !== null && 'created' in result.data
								? result.data.created
								: null
						);
						if (!made) {
							failed = true;
							return;
						}
						created = made;
						saveCreated(made);
						clearDraft();
						draft = emptyDraft();
						errors = {};
						await goto('?created=1');
					} else if (result.type === 'success') {
						errors = Object.fromEntries(
							Object.entries(errors).filter(([name]) => stepOf(name) !== checking)
						);
						if (next) await goto(`?step=${next}`);
					} else if (result.type === 'failure') {
						const sent = readErrors(result.data);
						errors =
							checking === 'review'
								? sent
								: {
										...Object.fromEntries(
											Object.entries(errors).filter(([name]) => stepOf(name) !== checking)
										),
										...sent
									};
						refused =
							typeof result.data === 'object' &&
							result.data !== null &&
							'refused' in result.data &&
							typeof result.data.refused === 'string'
								? result.data.refused
								: null;
						summary?.focus();
					} else {
						failed = true;
						summary?.focus();
					}
				};
			}}
		>
			<div class="builder-top">
				<div class="progress">
					<p class="tj-stepper">
						<span>Step {index + 1} of {STEPS.length} · {STEP_NAME[step]}</span>
					</p>
					<div class="tj-stepper" aria-hidden="true">
						{#each STEPS as name, at (name)}<i class={at <= index ? 'on' : ''}></i>{/each}
					</div>
				</div>
				<div class="tj-pagehead">
					<h1 tabindex="-1" bind:this={heading}>{QUESTION[step].title}</h1>
					<p class="tj-pagehead__meta">{QUESTION[step].lede}</p>
				</div>
			</div>

			<div class="status" tabindex="-1" bind:this={summary}>
				{#if refused}
					<Banner tone="attention" icon="clock" title="Not created: try again later" role="alert">
						{refused}
					</Banner>
				{/if}
				{#if failed}
					<Banner tone="critical" icon="alert-circle" title="That didn’t reach Tejido" role="alert">
						Nothing was lost: your answers are still on this device. Check your connection and try
						again.
					</Banner>
				{/if}
				<ErrorSummary {problems} />
				{#if ready && !stored}
					<Banner
						tone="attention"
						icon="alert-triangle"
						title="Your answers can’t be saved on this device"
						role="note"
					>
						This browser is not letting the page store anything. Keep this tab open until you have
						created the campaign: a reload would empty the form.
					</Banner>
				{/if}
			</div>

			{#if step === 'project'}
				<div class="tj-card fields">
					<Field
						id={fieldId('project.title')}
						label="Project name"
						bind:value={draft.project.title}
						help="For example “Rebuild the library wing”."
						error={errors['project.title']}
					/>
					<Field
						id={fieldId('project.summary')}
						label="What it is"
						optional
						multiline
						rows={4}
						bind:value={draft.project.summary}
						help="Two or three sentences: what happened, and what the money will pay for."
						error={errors['project.summary']}
					/>
					<Field
						id={fieldId('project.beneficiary')}
						label="Who it is for"
						optional
						bind:value={draft.project.beneficiary}
						help="For example “The 214 pupils of Mangrove Bay Primary School”. They need no account."
						error={errors['project.beneficiary']}
					/>
				</div>
				<div class="tj-card fields">
					<p class="text-eyebrow">The organiser</p>
					<Field
						id={fieldId('project.creatorName')}
						label="Your name, or your group’s"
						autocomplete="organization"
						bind:value={draft.project.creatorName}
						help="Shown to donors as “Organised by”."
						error={errors['project.creatorName']}
					/>
					<Field
						id={fieldId('project.creatorEmail')}
						label="Your email"
						type="email"
						inputmode="email"
						autocomplete="email"
						bind:value={draft.project.creatorEmail}
						help="So Tejido can reach the organiser. It is never shown publicly."
						error={errors['project.creatorEmail']}
					/>
				</div>
			{:else if step === 'funding'}
				{@const goalId = fieldId('funding.goal')}
				<div class="tj-card fields">
					<div class="tj-field">
						<label class="tj-label" for={goalId}>
							Goal <span class="tj-label__opt">(optional)</span>
						</label>
						<span class="tj-combo">
							<input
								class="tj-input"
								id={goalId}
								type="text"
								inputmode="decimal"
								autocomplete="off"
								bind:value={draft.funding.goal}
								aria-invalid={errors['funding.goal'] ? 'true' : undefined}
								aria-describedby="{goalId}-help{errors['funding.goal'] ? ` ${goalId}-err` : ''}"
							/>
							<span class="tj-combo__affix unit" aria-hidden="true">{UNIT}</span>
						</span>
						<p class="tj-help" id="{goalId}-help">
							In {UNIT}, the unit Qatom uses. For example 12,000. Leave it empty if there is no goal
							yet: Tejido never makes one up.
						</p>
						<FieldError id="{goalId}-err" message={errors['funding.goal']} />
					</div>
				</div>
				<Banner title="Giving is not open yet for a new campaign" role="note">
					Donors give through Qatom once the campaign’s donation item exists there. This page does
					not create it. Until it exists, the campaign’s page says its funding is not known rather
					than showing zero.
				</Banner>
			{:else if step === 'milestones'}
				<StepMilestones bind:draft {errors} {editKey} />
			{:else if step === 'people'}
				<StepPeople bind:draft {errors} {notices} {editKey} />
			{:else if step === 'schedule'}
				{@const cadenceId = fieldId('schedule.cadence')}
				<fieldset
					class="choices"
					aria-describedby={errors['schedule.cadence'] ? `${cadenceId}-err` : undefined}
				>
					<legend class="tj-label">Work is reported</legend>
					<div class="tj-choices" id={cadenceId}>
						{#each cadenceSchema.options as cadence (cadence)}
							<label class="tj-check tj-choice">
								<input
									type="radio"
									name="cadence"
									value={cadence}
									bind:group={draft.schedule.cadence}
								/>
								<span class="tj-check__text">
									<span>{CADENCE_LABEL[cadence]}</span>
									<small>{CADENCE_HELP[cadence]}</small>
								</span>
							</label>
						{/each}
					</div>
					<FieldError id="{cadenceId}-err" message={errors['schedule.cadence']} />
				</fieldset>
				<Banner title="Reminders are not sent yet" role="note">
					Tejido shows donors when a report is late. It does not yet remind the person who owes it.
				</Banner>
			{:else}
				<StepReview {draft} {notices} />
			{/if}

			<!--
				The floating bar reads as the header's sibling: the same rounded, frosted bar, with
				the first site's buttons (`btn`, from the root stylesheet) in place of the design
				system's, which are squarer.
			-->
			<div class="tj-stickyactions bar">
				<div class="bar-inner">
					{#if previous}
						<a class="btn btn-ghost" href="?step={previous}">
							<Icon name="arrow-left" />
							<span>Back</span>
						</a>
					{:else}
						<a class="btn btn-ghost" href={HOME}><span>Cancel</span></a>
					{/if}
					<button
						class="btn btn-blue"
						type="submit"
						disabled={busy}
						aria-busy={busy ? 'true' : undefined}
					>
						{#if busy}<span class="tj-spinner" aria-hidden="true"></span>{/if}
						<span>
							{#if step === 'review'}
								{busy ? 'Creating…' : 'Create campaign'}
							{:else if next}
								Continue to {STEP_NAME[next].toLowerCase()}
							{/if}
						</span>
					</button>
				</div>
			</div>
		</form>
	{/if}
</div>

<style>
	.builder {
		max-width: calc(var(--layout-reading) + 2 * var(--layout-gutter));
		gap: var(--space-5);
		padding-bottom: 0;
	}
	form {
		display: grid;
		gap: var(--space-5);
		min-width: 0;
	}
	.builder-top {
		display: grid;
		gap: var(--space-5);
	}
	.progress {
		display: grid;
		gap: var(--space-2);
	}
	h1:focus {
		outline: none;
	}
	.status {
		display: grid;
		gap: var(--space-3);
	}
	.status:empty {
		display: none;
	}
	.status:focus {
		outline: none;
	}
	.fields {
		gap: var(--space-4);
	}
	.unit {
		white-space: nowrap;
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
	/*
		The floating Back / Continue bar, in the header's family: `header.top` in the first
		site's stylesheet is a 16px-rounded, frosted white bar held 10px clear of the screen
		edge. This is the same bar at the bottom. Its values are that stylesheet's own.
	*/
	.bar {
		--bar-inset: 8px;
		/* Clear of the bottom edge, and of the phone's home indicator and keyboard safe area. */
		bottom: calc(10px + env(safe-area-inset-bottom));
		z-index: 2;
		/* The buttons line up with the cards above; the bar itself sits a little outside them. */
		margin-inline: calc(-1 * var(--bar-inset));
		margin-top: var(--space-3);
		padding: var(--bar-inset);
		border: 1px solid var(--glass-edge);
		border-radius: var(--r);
		/* A little more opaque than the header: form text passes under it, not a page background. */
		background: var(--glass-strong);
		-webkit-backdrop-filter: var(--blur);
		backdrop-filter: var(--blur);
		box-shadow: var(--hi), var(--shadow);
	}
	/* Without backdrop-filter the bar is solid, as the header is. */
	@supports not ((-webkit-backdrop-filter: blur(1px)) or (backdrop-filter: blur(1px))) {
		.bar {
			background: rgba(255, 255, 255, 0.95);
		}
	}
	/*
		Up to 1000px the site's tab bar is fixed to the bottom of the screen (8px up, 68px tall).
		The bar floats 8px above it rather than underneath it.
	*/
	@media (max-width: 1000px) {
		.bar {
			bottom: calc(84px + env(safe-area-inset-bottom));
		}
	}
	.bar-inner {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2);
	}
	/* A long label ("Continue to milestones") wraps on a narrow phone instead of overflowing. */
	.bar-inner .btn {
		white-space: normal;
		text-align: center;
	}
	/*
		A field reached with Tab or by a problem's link stops well above the bar (and the tab
		bar on a phone), never underneath it.
	*/
	form :global(:is(input, textarea, select, button, a, [tabindex])) {
		scroll-margin-bottom: 11rem;
	}
</style>
