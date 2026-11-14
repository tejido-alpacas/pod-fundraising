<!--
	The review step in the chat (B2): the report as the assistant is about to file it, the filing
	deposit. The assistant's limit is written above the card by the page. Track B owns this file.

	Every word of the report here is the assistant's own message, taken apart by `chatReview`. The
	card adds only the title, the steps and the two buttons. "File this entry" files nothing by
	itself: it sends the person's yes into the conversation, and the assistant files.
-->
<script lang="ts">
	import { Button, Icon } from '@tejido/ui';
	import type { ChatReview } from '#lib/chat.ts';

	interface Props {
		review: ChatReview;
		/** True for the newest message only. An older review cannot be answered. */
		current: boolean;
		/** True while a reply is arriving, or the assistant cannot be reached. */
		disabled: boolean;
		onfile: () => void;
		onchange: () => void;
	}
	let { review, current, disabled, onfile, onchange }: Props = $props();

	// "Uploaded" is only a step when the assistant says the report carries files.
	const files = $derived(review.rows.find((row) => row.label === 'Files')?.value ?? '');
	const hasFiles = $derived(/^[1-9]/.test(files));
	const steps = $derived([
		{ name: 'Drafted', at: 'done' },
		...(hasFiles ? [{ name: 'Uploaded', at: 'done' }] : []),
		{ name: 'Submitted', at: 'current' },
		{ name: 'Recorded', at: 'later' },
		{ name: 'Confirmed', at: 'later' }
	]);
	const now = $derived(steps.findIndex((step) => step.at === 'current') + 1);
</script>

<div class="tj-review" role="group" aria-label="Review before you file">
	<p class="tj-review__title">Review before you file</p>

	{#if current}
		<div class="tj-stepswrap">
			<ol
				class="tj-steps"
				style:grid-template-columns="repeat({steps.length}, minmax(0, 1fr))"
				aria-label="Where this entry is"
			>
				{#each steps as step (step.name)}
					<li
						class="tj-step is-{step.at}"
						aria-current={step.at === 'current' ? 'step' : undefined}
					>
						<span class="tj-step__name">{step.name}</span>
					</li>
				{/each}
			</ol>
			<p class="tj-steps__now">
				Step {now} of {steps.length} · Next: you file it with Tejido
			</p>
		</div>
	{/if}

	<dl class="tj-kv">
		{#each review.rows as row, index (index)}
			<div class="tj-kv__row">
				<dt>{row.label}</dt>
				<dd><span class="value">{row.value}</span></dd>
			</div>
		{/each}
	</dl>

	<p class="tj-review__deposit">
		<Icon name="deposit" size={18} />
		<span><strong>Filing deposit.</strong> {review.deposit}</span>
	</p>

	{#if current}
		<div class="tj-btn-row">
			<Button variant="primary" size="field" block {disabled} onclick={onfile}>
				File this entry
			</Button>
			<Button variant="quiet" size="field" block {disabled} onclick={onchange}>
				Change something
			</Button>
		</div>
	{/if}
</div>

<style>
	.value {
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
</style>
