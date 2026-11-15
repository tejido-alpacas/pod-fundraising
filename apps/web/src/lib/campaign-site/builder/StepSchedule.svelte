<!--
  StepSchedule: how often work is reported. Four choices: every week, every two weeks, every
  day, or chosen days of the week. Choosing the last opens a group of seven day toggles, like
  the repeat picker of a calendar invitation. Each toggle is a native checkbox, so it works
  with Tab and Space and is announced as "Monday, checkbox, checked". At least one day must
  be chosen: the check refuses the step until one is.

  <StepSchedule bind:draft {errors} />
-->
<script lang="ts">
	import {
		cadencePhrase,
		cadenceSchema,
		daysCadence,
		daysNamedIn,
		WEEKDAYS,
		weekdayName,
		type Weekday
	} from '@tejido/contracts';
	import { Banner } from '@tejido/ui';
	import type { BuilderDraft, FieldErrors } from './draft.ts';
	import FieldError from './FieldError.svelte';
	import { fieldId } from './ids.ts';
	import {
		CADENCE_CHOICE_HELP,
		CADENCE_CHOICE_LABEL,
		CADENCE_CHOICES,
		cadenceChoice,
		type CadenceChoice
	} from './words.ts';

	let { draft = $bindable(), errors }: { draft: BuilderDraft; errors: FieldErrors } = $props();

	const cadenceId = fieldId('schedule.cadence');
	const daysId = `${cadenceId}-days`;
	const error = $derived(errors['schedule.cadence']);

	const choice = $derived(cadenceChoice(draft.schedule.cadence));
	/** The days picked so far. Empty while another choice is made, or none is picked yet. */
	const chosen = $derived<readonly Weekday[]>(
		choice === 'custom' ? (daysNamedIn(draft.schedule.cadence) ?? []) : []
	);
	/** The days last picked, kept so that trying another choice and coming back loses nothing. */
	let remembered = $state<readonly Weekday[]>([]);
	/** The whole choice in words, once it is a cadence: "every Monday and Thursday". */
	const inWords = $derived.by(() => {
		const cadence = cadenceSchema.safeParse(draft.schedule.cadence);
		return cadence.success ? cadencePhrase(cadence.data) : null;
	});

	function choose(next: CadenceChoice) {
		draft.schedule.cadence = next === 'custom' ? daysCadence(remembered) : next;
	}

	function toggle(day: Weekday, on: boolean) {
		const days = WEEKDAYS.filter((each) => (each === day ? on : chosen.includes(each)));
		remembered = days;
		draft.schedule.cadence = daysCadence(days);
	}
</script>

<fieldset class="choices" aria-describedby={error ? `${cadenceId}-err` : undefined}>
	<legend class="tj-label">Work is reported</legend>
	<div class="tj-choices" id={cadenceId}>
		{#each CADENCE_CHOICES as option (option)}
			<label class="tj-check tj-choice">
				<input
					type="radio"
					name="cadence"
					value={option}
					checked={choice === option}
					onchange={() => choose(option)}
				/>
				<span class="tj-check__text">
					<span>{CADENCE_CHOICE_LABEL[option]}</span>
					<small>{CADENCE_CHOICE_HELP[option]}</small>
				</span>
			</label>
		{/each}
	</div>

	{#if choice === 'custom'}
		<fieldset class="days" aria-describedby="{daysId}-help{error ? ` ${cadenceId}-err` : ''}">
			<legend class="tj-label">Days a work report is due</legend>
			<div class="day-toggles" id={daysId}>
				{#each WEEKDAYS as day (day)}
					<label class="day">
						<input
							type="checkbox"
							name="cadence-day"
							value={day}
							checked={chosen.includes(day)}
							onchange={(event) => toggle(day, event.currentTarget.checked)}
						/>
						<!-- Read out in full ("Monday"); shown short where there is no room. -->
						<span class="day-name">
							<span class="day-short" aria-hidden="true">{weekdayName(day).slice(0, 3)}</span>
							<span class="day-full">{weekdayName(day)}</span>
						</span>
					</label>
				{/each}
			</div>
			<p class="tj-help" id="{daysId}-help">
				Choose at least one day. A day runs from midnight to midnight UTC.
			</p>
			<p class="tj-help said" aria-live="polite">
				{#if inWords}Work is reported <strong>{inWords}</strong>.{:else}No day chosen yet.{/if}
			</p>
		</fieldset>
	{/if}

	<FieldError id="{cadenceId}-err" message={error} />
</fieldset>
<Banner title="Reminders are not sent yet" role="note">
	Tejido shows donors when a report is late. It does not yet remind the person who owes it.
</Banner>

<style>
	.choices,
	.days {
		border: 0;
		margin: 0;
		padding: 0;
		min-width: 0;
		display: grid;
		gap: var(--space-2);
	}
	.choices > legend,
	.days > legend {
		margin-bottom: var(--space-2);
		padding: 0;
	}
	.days {
		margin-top: var(--space-2);
		padding: var(--space-4);
		border: var(--border-hair) solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
	/*
		Seven toggles in one row where each can be a 44px touch target; on a very narrow phone
		they wrap onto a second row rather than shrink.
	*/
	.day-toggles {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(var(--size-touch), 1fr));
		gap: var(--space-1);
	}
	.day {
		position: relative;
		display: grid;
		cursor: pointer;
	}
	/* The checkbox itself covers its toggle, invisible, so it takes the tap and the focus. */
	.day input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		opacity: 0;
		cursor: pointer;
	}
	.day-name {
		display: grid;
		place-items: center;
		min-height: var(--size-touch);
		padding: 0 var(--space-1);
		border: var(--border-control) solid var(--border-strong);
		border-radius: var(--radius-full);
		background: var(--surface);
		color: var(--text-primary);
		font: 600 14px/20px var(--font-sans);
		text-align: center;
	}
	.day input:checked + .day-name {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent);
	}
	.day input:focus-visible + .day-name {
		outline: 3px solid var(--focus-ring, var(--accent));
		outline-offset: 2px;
	}
	/* The full name is always there for a screen reader; it is shown when there is room. */
	.day-full {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	.said {
		color: var(--text-primary);
	}
</style>
