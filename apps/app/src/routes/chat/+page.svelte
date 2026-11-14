<script lang="ts">
	import { readChatEvents, type ChatRefusal, type ChatTurn } from '#lib/chat.ts';
	import {
		reportFormLines,
		type ReportFormProblems,
		type ReportFormValues
	} from '#lib/report-form.ts';
	import { ROLES } from '#lib/roles.ts';
	import { tick } from 'svelte';
	import type { PageProps } from './$types';
	import ReportForm from './ReportForm.svelte';

	let { data }: PageProps = $props();

	interface ToolUse {
		id: string;
		name: string;
		state: 'running' | 'done' | 'failed';
	}
	interface Message {
		role: 'user' | 'assistant';
		text: string;
		tools: ToolUse[];
		/** Why this reply stopped early, in plain words. */
		problem: string | null;
		/** Set when the person sent the report form instead of typing. */
		form?: ReportFormValues;
	}
	/** How sending went: it reached the agent, or it did not and here is what to fix. */
	type Delivery = { sent: true } | { sent: false; fields: ReportFormProblems | null };

	const STATE_WORDS = {
		open: 'open',
		claimed: 'claimed, awaiting confirmation',
		confirmed_independent: 'confirmed',
		confirmed_creator: 'confirmed by the creator'
	};
	const NO_ANSWER =
		'The App did not answer. Check your connection and send your message again. Nothing was filed by this message.';
	const ASK_FIRST =
		'If the agent was filing a report, ask it whether the report went through before you try again.';

	// The conversation lives in this page only. Reloading the page starts a new one.
	let messages = $state<Message[]>([]);
	let draft = $state('');
	let waiting = $state(false);
	/** A problem that stopped a message from being sent at all. */
	let problem = $state<string | null>(null);
	let signInAgain = $state(false);
	let stopper: AbortController | null = null;
	let log: HTMLElement | undefined = $state();
	let formOpen = $state(false);

	const party = $derived(data.who?.party ?? null);
	const connected = $derived(party !== null && party.connected && !signInAgain);

	async function scrollDown() {
		await tick();
		log?.scrollTo({ top: log.scrollHeight });
	}

	/** What the server needs: who said what. A reply that produced no words is left out. */
	function conversation(): ChatTurn[] {
		return messages
			.filter((message) => message.form !== undefined || message.text.trim() !== '')
			.map(({ role, text, form }) => (form ? { role, text, form } : { role, text }));
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (text === '' || waiting || !connected) return;

		draft = '';
		const delivery = await deliver({ role: 'user', text, tools: [], problem: null });
		// Give the person their words back, so they can send them again.
		if (!delivery.sent) draft = text;
	}

	/** The report form's values go into the conversation as one message. Nothing is filed by it. */
	async function sendForm(values: ReportFormValues): Promise<ReportFormProblems | null> {
		if (waiting || !connected) return {};
		const delivery = await deliver({
			role: 'user',
			text: '',
			tools: [],
			problem: null,
			form: values
		});
		if (!delivery.sent) return delivery.fields ?? {};
		formOpen = false;
		return null;
	}

	/** Adds what the person said to the conversation and reads the agent's reply to it. */
	async function deliver(said: Message): Promise<Delivery> {
		problem = null;
		messages.push(said);
		const turns = conversation();
		waiting = true;
		void scrollDown();

		const stop = new AbortController();
		stopper = stop;
		let reply: Message | null = null;
		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ messages: turns }),
				signal: stop.signal
			});

			if (!response.ok || !response.body) {
				const refusal = (await response.json().catch(() => null)) as ChatRefusal | null;
				if (refusal?.error === 'sign_in_again' || refusal?.error === 'not_signed_in') {
					signInAgain = true;
				}
				problem = refusal?.message ?? NO_ANSWER;
				messages.pop();
				return { sent: false, fields: refusal?.fields ?? null };
			}

			messages.push({ role: 'assistant', text: '', tools: [], problem: null });
			// Read it back out of the list, so that changing it changes the page.
			const current = messages[messages.length - 1];
			if (!current) return { sent: true };
			reply = current;
			let finished = false;
			await readChatEvents(response.body, (chatEvent) => {
				if (chatEvent.type === 'text') {
					current.text += chatEvent.text;
				} else if (chatEvent.type === 'tool') {
					const known = current.tools.find((tool) => tool.id === chatEvent.id);
					if (known) known.state = chatEvent.state;
					else {
						current.tools.push({ id: chatEvent.id, name: chatEvent.name, state: chatEvent.state });
					}
				} else if (chatEvent.type === 'error') {
					current.problem = chatEvent.message;
					finished = true;
				} else {
					finished = true;
				}
				void scrollDown();
			});
			if (!finished) current.problem = `The reply was cut off. ${ASK_FIRST}`;
			return { sent: true };
		} catch {
			if (reply) {
				reply.problem = stop.signal.aborted
					? `You stopped this reply. ${ASK_FIRST}`
					: `The connection dropped during this reply. ${ASK_FIRST}`;
				return { sent: true };
			}
			if (!stop.signal.aborted) problem = NO_ANSWER;
			messages.pop();
			return { sent: false, fields: null };
		} finally {
			// A tool still marked as running when the reply ends never reported back.
			for (const tool of reply?.tools ?? []) {
				if (tool.state === 'running') tool.state = 'failed';
			}
			waiting = false;
			stopper = null;
			void scrollDown();
		}
	}

	function onKeydown(event: KeyboardEvent) {
		// Enter sends; Shift+Enter makes a new line.
		if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
			event.preventDefault();
			(event.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
		}
	}
</script>

<svelte:head><title>Your agent · Tejido App</title></svelte:head>

<article>
	<p class="eyebrow">Your agent</p>
	<h1>Talk to your agent</h1>

	{#if !data.who}
		<p class="note">
			You are not signed in. Open the invite link you were sent and sign in with Qatom from there.
			The agent can only work for someone who has been invited to a campaign.
		</p>
	{:else if !party}
		<p class="note">
			You are signed in as {data.who.email}, but not on a campaign. Open the invite link you were
			sent and sign in from there, then come back to this page.
		</p>
	{:else}
		<p class="lede">
			{party.name}, this agent works for you on “{party.campaignTitle}” as
			{ROLES[party.role].name.toLowerCase()}. Tell it what you have done. It will ask for what a
			report needs, show you the report, and file it only when you say yes. Filing is paid from your
			own Qatom agent wallet.
		</p>

		{#if party.milestones.length > 0}
			<details>
				<summary>Your milestones ({party.milestones.length})</summary>
				<ul class="milestones">
					{#each party.milestones as milestone (milestone.id)}
						<li>
							<strong>{milestone.title}</strong>
							<span>
								{milestone.part === 'owes' ? 'You owe this' : 'You confirm this'} · due
								{milestone.dueDate} · {STATE_WORDS[milestone.state]}
							</span>
						</li>
					{/each}
				</ul>
			</details>
		{/if}

		<p class="upload">
			Photos and documents go through the
			<a href="/upload" target="_blank" rel="noopener">upload page</a> (opens in a new tab). It gives
			you a URL and a SHA-256 for each file. Paste both here. Or attach them in the report form below,
			which does that for you.
		</p>

		{#if !connected}
			<p class="problem" role="alert">
				The agent cannot reach Qatom as you right now: your Qatom sign-in has run out, or you signed
				out. <a href="/invite/{party.id}">Open your invite</a> and sign in again, then come back here.
			</p>
		{/if}

		<section class="log" bind:this={log} aria-live="polite" aria-label="Conversation">
			{#if messages.length === 0}
				<p class="empty">
					Nothing said yet. You could start with “What do I owe?” or “I want to log this week’s
					work.”
				</p>
			{/if}
			{#each messages as message, index (index)}
				<div class="message {message.role}">
					<p class="speaker">{message.role === 'user' ? 'You' : 'Agent'}</p>
					{#each message.tools as tool (tool.id)}
						<p class="tool {tool.state}">
							{#if tool.state === 'running'}
								The agent is using a Qatom tool: <code>{tool.name}</code>…
							{:else if tool.state === 'done'}
								The agent used a Qatom tool: <code>{tool.name}</code>
							{:else}
								A Qatom tool did not work: <code>{tool.name}</code>
							{/if}
						</p>
					{/each}
					{#if message.form}
						<p class="tool done">You sent the report form. Nothing is filed until you say yes.</p>
						<dl class="sent-form">
							{#each reportFormLines(message.form, party.milestones.find((milestone) => milestone.id === message.form?.milestone_id)?.title) as line (line.label)}
								<div>
									<dt>{line.label}</dt>
									<dd>{line.value}</dd>
								</div>
							{/each}
						</dl>
					{/if}
					{#if message.text}
						<p class="text">{message.text}</p>
					{/if}
					{#if message.problem}
						<p class="problem" role="alert">{message.problem}</p>
					{/if}
				</div>
			{/each}
			{#if waiting}
				<p class="thinking">The agent is working…</p>
			{/if}
		</section>

		{#if problem}
			<p class="problem" role="alert">{problem}</p>
		{/if}

		{#if party.milestones.length > 0}
			<details class="guided" bind:open={formOpen}>
				<summary>Fill in a report form instead of typing</summary>
				<ReportForm
					milestones={party.milestones}
					disabled={waiting || !connected}
					submit={sendForm}
				/>
			</details>
		{/if}

		<form onsubmit={send}>
			<label for="draft">Your message</label>
			<textarea
				id="draft"
				rows="3"
				maxlength="8000"
				bind:value={draft}
				onkeydown={onKeydown}
				disabled={!connected}
				placeholder="Write to your agent. Enter sends; Shift and Enter makes a new line."
			></textarea>
			<div class="actions">
				{#if waiting}
					<button type="button" class="quiet" onclick={() => stopper?.abort()}>Stop</button>
				{/if}
				<button type="submit" disabled={waiting || !connected || draft.trim() === ''}>
					{waiting ? 'Waiting for the agent…' : 'Send'}
				</button>
			</div>
		</form>

		<p class="small">
			This conversation is kept in this page only. Reloading or closing the page clears it; reports
			already filed stay filed.
		</p>
	{/if}
</article>

<style>
	article {
		max-width: 44rem;
	}
	.lede {
		color: var(--muted);
	}
	.note {
		border-left: 3px solid var(--line);
		padding-left: 0.75rem;
		color: var(--muted);
	}
	details {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.6rem 1rem;
		margin: 1rem 0;
	}
	summary {
		cursor: pointer;
		font-weight: 600;
	}
	.milestones {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0 0.2rem;
		display: grid;
		gap: 0.5rem;
	}
	.milestones span {
		display: block;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.upload,
	.small {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.log {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 1rem;
		min-height: 12rem;
		max-height: 60vh;
		overflow-y: auto;
		display: grid;
		align-content: start;
		gap: 0.9rem;
	}
	.empty,
	.thinking {
		color: var(--muted);
		margin: 0;
	}
	.message {
		border-left: 3px solid var(--line);
		padding-left: 0.75rem;
	}
	.message.user {
		border-left-color: var(--b);
	}
	.message.assistant {
		border-left-color: var(--a);
	}
	.message p {
		margin: 0.15rem 0;
	}
	.speaker {
		font-size: 0.8rem;
		font-weight: 600;
		color: var(--muted);
	}
	.text,
	.sent-form dd {
		white-space: pre-wrap;
		overflow-wrap: anywhere;
	}
	.sent-form {
		margin: 0.3rem 0;
		display: grid;
		gap: 0.3rem;
	}
	.sent-form dt {
		font-size: 0.8rem;
		color: var(--muted);
	}
	.sent-form dd {
		margin: 0;
	}
	.tool {
		font-size: 0.9rem;
		color: var(--c);
	}
	.tool.done {
		color: var(--muted);
	}
	.tool.failed,
	.problem {
		color: var(--warn);
	}
	.problem {
		border-left: 3px solid var(--warn);
		padding-left: 0.75rem;
	}
	form {
		margin-top: 1rem;
		display: grid;
		gap: 0.4rem;
	}
	label {
		font-size: 0.9rem;
		color: var(--muted);
	}
	textarea {
		font: inherit;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		resize: vertical;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.5rem;
	}
	button {
		font: inherit;
		font-weight: 600;
		color: var(--surface);
		background: var(--a);
		border: 1px solid var(--a);
		border-radius: 6px;
		padding: 0.5rem 1.1rem;
		cursor: pointer;
	}
	button.quiet {
		color: var(--ink);
		background: var(--surface);
		border-color: var(--line);
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
</style>
