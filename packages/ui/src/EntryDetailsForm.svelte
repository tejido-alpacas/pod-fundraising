<!--
  EntryDetailsForm: the compact form the assistant places inside the conversation. It saves a
  draft on this device on every change and never files anything itself — filing happens only from
  the review card, after the person says yes.

  <EntryDetailsForm bind:draft milestones={party.milestones} onsave={saveDraft} />
-->
<script lang="ts" module>
	export interface EntryDraft {
		quantity: string;
		unit: string;
		amount: string;
		currency: string;
		/** ISO date, YYYY-MM-DD. */
		date: string;
		milestoneId: string;
		description: string;
	}
</script>

<script lang="ts">
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';

	let {
		draft = $bindable(),
		milestones,
		units = ['bags', 'tonnes', 'pallets', 'units'],
		currencies = ['USD', 'XCD'],
		savedAt = null,
		onsave
	}: {
		draft: EntryDraft;
		milestones: { id: string; position: number; title: string }[];
		units?: string[];
		currencies?: string[];
		/** When the draft was last written to this device, e.g. "16:45". */
		savedAt?: string | null;
		/** Write the draft to local storage (or IndexedDB). Called on every change. */
		onsave: (draft: EntryDraft) => void;
	} = $props();

	const uid = $props.id();
	let touched = $state(false);
	const quantityError = $derived(
		touched && draft.quantity.trim() === ''
			? 'Enter how many were delivered.'
			: touched && Number.isNaN(Number(draft.quantity.replace(/,/g, '')))
				? 'Use numbers only, like 120.'
				: ''
	);

	function changed() {
		touched = true;
		onsave(draft);
	}
</script>

<div class="tj-inform" role="group" aria-labelledby="{uid}-title">
	<p class="tj-inform__title" id="{uid}-title">
		Entry details <StatusBadge state="pending" label="Draft" plain />
	</p>

	<div class="tj-inform__grid tj-inform__grid--2">
		<div class="tj-field">
			<label class="tj-label" for="{uid}-qty">Quantity</label>
			<span class="tj-combo">
				<input
					class="tj-input"
					id="{uid}-qty"
					inputmode="decimal"
					autocomplete="off"
					bind:value={draft.quantity}
					oninput={changed}
					aria-invalid={quantityError ? 'true' : undefined}
					aria-describedby={quantityError ? `${uid}-qty-err` : undefined}
				/>
				<span class="tj-select-wrap">
					<select class="tj-select" aria-label="Unit" bind:value={draft.unit} onchange={changed}>
						{#each units as unit (unit)}<option>{unit}</option>{/each}
					</select>
					<Icon name="chevron-down" size={18} />
				</span>
			</span>
			{#if quantityError}<p class="tj-error" id="{uid}-qty-err">
					<Icon name="alert-circle" />{quantityError}
				</p>{/if}
		</div>

		<div class="tj-field">
			<label class="tj-label" for="{uid}-amt"
				>Amount spent <span class="tj-label__opt">(optional)</span></label
			>
			<span class="tj-combo">
				<input
					class="tj-input"
					id="{uid}-amt"
					inputmode="decimal"
					autocomplete="off"
					bind:value={draft.amount}
					oninput={changed}
				/>
				<span class="tj-select-wrap">
					<select
						class="tj-select"
						aria-label="Currency"
						bind:value={draft.currency}
						onchange={changed}
					>
						{#each currencies as c (c)}<option>{c}</option>{/each}
					</select>
					<Icon name="chevron-down" size={18} />
				</span>
			</span>
		</div>

		<div class="tj-field">
			<label class="tj-label" for="{uid}-date">Date</label>
			<input
				class="tj-input"
				id="{uid}-date"
				type="date"
				bind:value={draft.date}
				onchange={changed}
			/>
		</div>

		<div class="tj-field">
			<label class="tj-label" for="{uid}-ms">Milestone</label>
			<span class="tj-select-wrap">
				<select class="tj-select" id="{uid}-ms" bind:value={draft.milestoneId} onchange={changed}>
					{#each milestones as m (m.id)}<option value={m.id}>{m.position} · {m.title}</option
						>{/each}
				</select>
				<Icon name="chevron-down" size={18} />
			</span>
		</div>
	</div>

	<div class="tj-field">
		<label class="tj-label" for="{uid}-desc">What was done</label>
		<textarea
			class="tj-textarea"
			id="{uid}-desc"
			rows="2"
			bind:value={draft.description}
			oninput={changed}></textarea>
	</div>

	{#if savedAt}
		<p class="tj-inform__saved" aria-live="polite">
			<Icon name="device" size={16} />Saved on this phone at {savedAt}
		</p>
	{/if}
</div>
