<!--
	The chat (B2): a conversation with the assistant that drafts a report and files it, as the
	signed-in person, once they say yes. Track B owns this file.

	What is drawn here is only what POST /api/chat reports (see `#lib/chat.ts`): the assistant's
	words, a Qatom tool starting and answering, an error, the end of the reply. The page never
	shows a report as recorded or confirmed: the stream does not say either.
-->
<script lang="ts">
	import {
		Banner,
		Button,
		EmptyState,
		FieldHeader,
		Icon,
		StatusBadge,
		daysOverdue,
		shortId
	} from '@tejido/ui';
	import {
		chatReview,
		filingTool,
		readChatEvents,
		type ChatRefusal,
		type ChatRequest,
		type ChatTurn
	} from '#lib/chat.ts';
	import { DOCUMENT_TYPES, EVIDENCE_MAX_MEGABYTES, PICTURE_TYPES } from '#lib/evidence.ts';
	import {
		reportFormLines,
		reportKindsFor,
		type ReportFormProblems,
		type ReportFormValues
	} from '#lib/report-form.ts';
	import { uploadFromChat, uploadedFileMessage } from '#lib/chat-upload.ts';
	import { roleName } from '#lib/roles.ts';
	import { tick } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { PageProps } from './$types';
	import ReportForm from './ReportForm.svelte';
	import ReviewCard from './ReviewCard.svelte';

	let { data }: PageProps = $props();

	/**
	 * A tool the assistant used. `unanswered` is ours: the reply ended and the tool had not
	 * reported back, so nobody knows what it did.
	 */
	type ToolState = 'running' | 'done' | 'failed' | 'unanswered';
	type Part =
		| { kind: 'text'; text: string }
		| { kind: 'tool'; id: string; name: string; state: ToolState; at: string };
	/** A file chosen from the message box. Each state is shown only once it is true. */
	interface Attachment {
		name: string;
		picture: boolean;
		state: 'uploading' | 'uploaded' | 'failed';
		/** The person's own file, shown as a thumbnail while and after it uploads. */
		preview?: string;
		/** Set once uploaded, exactly as POST /api/evidence answered. */
		url?: string;
		sha256?: string;
		/** Why the upload failed, and whether sending the same file again could help. */
		problem?: string;
		again?: boolean;
	}
	interface Message {
		id: number;
		role: 'user' | 'assistant';
		text: string;
		/** A reply in the order it arrived: words, then a tool, then more words. */
		parts: Part[];
		/** Why this reply stopped early, in plain words. */
		problem: string | null;
		/** Set when the person sent the report form instead of typing. */
		form?: ReportFormValues;
		/** Set when the person added a file from the message box. */
		attachment?: Attachment;
		/** Local time, 24-hour. */
		at: string;
		/** A reply that has ended, or a message of the person's that reached the assistant. */
		settled: boolean;
	}
	/** How sending went: it reached the assistant, or it did not and here is what to fix. */
	type Delivery = { sent: true } | { sent: false; fields: ReportFormProblems | null };

	const NO_ANSWER =
		'Tejido did not answer. Check your connection and send your message again. Nothing was filed by this message.';
	const ASK_FIRST =
		'If the assistant was filing a report, ask it whether the report went through before you try again.';
	const MONTHS = [
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug',
		'Sep',
		'Oct',
		'Nov',
		'Dec'
	];

	// The conversation lives in this page only. Reloading the page starts a new one.
	let messages = $state<Message[]>([]);
	let draft = $state('');
	let waiting = $state(false);
	/** Set while the server is asking the assistant again by itself; what to say meanwhile. */
	let tryingAgain = $state<string | null>(null);
	/** A problem that stopped a message from being sent at all. */
	let problem = $state<string | null>(null);
	let signInAgain = $state(false);
	let stopper: AbortController | null = null;
	let formOpen = $state(false);
	let attachOpen = $state(false);
	let count = 0;
	/** The files chosen from the message box, kept until uploaded so a failed one can be retried. */
	const chosen = new SvelteMap<number, File>();
	let composer: HTMLTextAreaElement | undefined = $state();
	let formPlace: HTMLElement | undefined = $state();

	const party = $derived(data.who?.party ?? null);
	const connected = $derived(party !== null && party.connected && !signInAgain);
	const today = $derived(data.today ?? '');
	const mine = $derived(party?.milestones ?? []);
	const canFill = $derived(mine.some((milestone) => reportKindsFor(milestone).length > 0));
	/** The one milestone this chat was opened for, from a reminder. Checked by the server. */
	const about = $derived(mine.find((milestone) => milestone.id === party?.about));
	/** That milestone, while there is still something to report on it. */
	const focus = $derived(about && reportKindsFor(about).length > 0 ? about : undefined);
	/**
	 * The milestone this person acts on next: the one the chat was opened for, otherwise the
	 * earliest one not yet confirmed.
	 */
	const next = $derived(
		focus ??
			mine
				.filter((milestone) => reportKindsFor(milestone).length > 0)
				.toSorted((a, b) => a.dueDate.localeCompare(b.dueDate))[0]
	);
	/** What the first button says and sends when the chat was opened for a milestone. */
	const opener = $derived.by(() => {
		if (!focus) return null;
		if (focus.part === 'confirms') {
			return focus.state === 'claimed'
				? { label: 'Confirm this milestone', says: `I want to confirm ${focus.title}.` }
				: null;
		}
		return focus.state === 'open'
			? { label: 'Report on this milestone', says: `I want to report on ${focus.title}.` }
			: { label: 'Log work on this milestone', says: `I want to log work on ${focus.title}.` };
	});
	const filings = $derived(
		messages.flatMap((message) =>
			message.parts.filter(
				(part): part is Extract<Part, { kind: 'tool' }> =>
					part.kind === 'tool' && filingTool(part.name) !== null
			)
		)
	);
	const formsSent = $derived(
		messages.filter((message) => message.form !== undefined && message.settled).length
	);
	/** What the assistant is doing while a reply arrives. Null once its words are coming. */
	const working = $derived.by(() => {
		if (!waiting) return null;
		if (tryingAgain) return tryingAgain;
		const last = messages.at(-1);
		const part = last?.role === 'assistant' ? last.parts.at(-1) : undefined;
		if (part?.kind === 'text') return null;
		if (part?.kind === 'tool' && part.state === 'running') {
			return filingTool(part.name) ? 'Sending the filing to Tejido…' : 'Checking with Qatom…';
		}
		return 'Working on a reply…';
	});

	function clock(): string {
		return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
	}

	/** "14 Nov" within this year, "22 Jan 2027" otherwise. */
	function shortDate(iso: string): string {
		const [year, month, day] = iso.split('-');
		const name = MONTHS[Number(month) - 1];
		if (!year || !name || !day) return iso;
		return `${Number(day)} ${name}${today.startsWith(year) ? '' : ` ${year}`}`;
	}

	function overdue(milestone: { state: (typeof mine)[number]['state']; dueDate: string }): number {
		return today === '' ? 0 : daysOverdue(milestone, today);
	}

	function days(count: number): string {
		return count === 1 ? '1 day' : `${count} days`;
	}

	async function scrollDown() {
		await tick();
		window.scrollTo({ top: document.documentElement.scrollHeight });
	}

	/** The composer grows with what is typed, up to the height the stylesheet allows. */
	function fit() {
		if (!composer) return;
		composer.style.height = 'auto';
		composer.style.height = `${composer.scrollHeight + 2}px`;
	}

	/**
	 * What the server needs: who said what. A reply that produced no words is left out, and so is
	 * a file that has not reached the assistant yet, unless it is the one being sent now.
	 */
	function conversation(sending: number): ChatTurn[] {
		return messages
			.filter((message) => message.form !== undefined || message.text.trim() !== '')
			.filter(
				(message) => message.attachment === undefined || message.settled || message.id === sending
			)
			.map(({ role, text, form }) => (form ? { role, text, form } : { role, text }));
	}

	function said(text: string, form?: ReportFormValues): Message {
		const message: Message = {
			id: count++,
			role: 'user',
			text,
			parts: [],
			problem: null,
			at: clock(),
			settled: false
		};
		if (form) message.form = form;
		return message;
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		const text = draft.trim();
		if (text === '' || waiting || !connected) return;

		draft = '';
		await tick();
		fit();
		const delivery = await deliver(said(text));
		// Give the person their words back, so they can send them again.
		if (!delivery.sent) {
			draft = text;
			await tick();
			fit();
		}
	}

	/** A quick reply: the same as typing these words and sending them. */
	async function quick(text: string) {
		if (waiting || !connected) return;
		await deliver(said(text));
	}

	/** The report form's values go into the conversation as one message. Nothing is filed by it. */
	async function sendForm(values: ReportFormValues): Promise<ReportFormProblems | null> {
		if (waiting || !connected) return {};
		const delivery = await deliver(said('', values));
		if (!delivery.sent) return delivery.fields ?? {};
		formOpen = false;
		return null;
	}

	async function toggleForm() {
		formOpen = !formOpen;
		if (formOpen) await showForm();
	}

	async function showForm() {
		formOpen = true;
		await tick();
		formPlace?.scrollIntoView({ block: 'start' });
		formPlace?.querySelector<HTMLElement>('select, input, textarea')?.focus();
	}

	/** A file from the message box: it gets its row at once, is uploaded, then goes to the assistant. */
	async function attach(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		input.value = '';
		attachOpen = false;
		if (!file || !connected) return;

		const message = said('');
		const picture = file.type.startsWith('image/');
		message.attachment = { name: file.name, picture, state: 'uploading' };
		if (picture) message.attachment.preview = URL.createObjectURL(file);
		chosen.set(message.id, file);
		messages.push(message);
		void scrollDown();
		await upload(message.id);
	}

	async function upload(id: number) {
		const message = messages.find((candidate) => candidate.id === id);
		const file = chosen.get(id);
		if (!message?.attachment || !file) return;
		const attachment = message.attachment;
		attachment.state = 'uploading';

		const result = await uploadFromChat(file);
		if (!result.ok) {
			attachment.state = 'failed';
			attachment.problem = result.problem;
			attachment.again = result.again;
			return;
		}
		attachment.state = 'uploaded';
		attachment.url = result.url;
		attachment.sha256 = result.sha256;
		message.text = uploadedFileMessage({ ...result, picture: attachment.picture });
		chosen.delete(id);
		await sendFile(id);
	}

	/** Tells the assistant about an uploaded file. While a reply is arriving it waits to be sent. */
	async function sendFile(id: number) {
		if (waiting || !connected) return;
		const at = messages.findIndex((candidate) => candidate.id === id);
		const [message] = at === -1 ? [] : messages.splice(at, 1);
		if (message) await deliver(message);
	}

	function removeFile(id: number) {
		chosen.delete(id);
		messages = messages.filter((candidate) => candidate.id !== id);
	}

	/** Adds what the person said to the conversation and reads the assistant's reply to it. */
	async function deliver(theirs: Message): Promise<Delivery> {
		problem = null;
		messages.push(theirs);
		// Read it back out of the list, so that changing it changes the page.
		const sent = messages[messages.length - 1];
		const turns = conversation(theirs.id);
		waiting = true;
		void scrollDown();

		const stop = new AbortController();
		stopper = stop;
		let reply: Message | null = null;
		try {
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(
					(about
						? { messages: turns, milestone: about.id }
						: { messages: turns }) satisfies ChatRequest
				),
				signal: stop.signal
			});

			if (!response.ok || !response.body) {
				const refusal = (await response.json().catch(() => null)) as ChatRefusal | null;
				if (refusal?.error === 'sign_in_again' || refusal?.error === 'not_signed_in') {
					signInAgain = true;
				}
				problem = refusal?.message ?? NO_ANSWER;
				// An uploaded file keeps its row, marked as not sent, so it can be sent again.
				if (!theirs.attachment) messages.pop();
				return { sent: false, fields: refusal?.fields ?? null };
			}

			if (sent) sent.settled = true;
			messages.push({
				id: count++,
				role: 'assistant',
				text: '',
				parts: [],
				problem: null,
				at: clock(),
				settled: false
			});
			const current = messages[messages.length - 1];
			if (!current) return { sent: true };
			reply = current;
			let finished = false;
			await readChatEvents(response.body, (chatEvent) => {
				// Said only until the next thing arrives.
				tryingAgain = chatEvent.type === 'retrying' ? chatEvent.message : null;
				if (chatEvent.type === 'retrying') return;
				if (chatEvent.type === 'text') {
					current.text += chatEvent.text;
					const last = current.parts.at(-1);
					if (last?.kind === 'text') last.text += chatEvent.text;
					else current.parts.push({ kind: 'text', text: chatEvent.text });
				} else if (chatEvent.type === 'tool') {
					const known = current.parts.find(
						(part) => part.kind === 'tool' && part.id === chatEvent.id
					);
					if (known?.kind === 'tool') {
						known.state = chatEvent.state;
						known.at = clock();
					} else {
						current.parts.push({
							kind: 'tool',
							id: chatEvent.id,
							name: chatEvent.name,
							state: chatEvent.state,
							at: clock()
						});
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
			if (!theirs.attachment) messages.pop();
			return { sent: false, fields: null };
		} finally {
			if (reply) {
				// A tool still marked as running when the reply ends never reported back.
				for (const part of reply.parts) {
					if (part.kind === 'tool' && part.state === 'running') part.state = 'unanswered';
				}
				// The notice about a filing nobody heard back from says what to do. Not this too.
				const unknown = reply.parts.some(
					(part) =>
						part.kind === 'tool' && part.state === 'unanswered' && filingTool(part.name) !== null
				);
				if (unknown && reply.problem?.endsWith(ASK_FIRST)) {
					reply.problem = reply.problem.slice(0, -ASK_FIRST.length).trim();
				}
				reply.settled = true;
			}
			waiting = false;
			tryingAgain = null;
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

<svelte:head><title>File a report · Tejido</title></svelte:head>

{#snippet who(at: string)}
	<p class="tj-msg__who">
		<Icon name="weave" size={16} /><span>Tejido assistant</span><time>· {at}</time>
	</p>
{/snippet}

{#snippet toolLine(part: Extract<Part, { kind: 'tool' }>)}
	{@const filing = filingTool(part.name) !== null}
	{#if part.state === 'running'}
		<!-- Said by the working line under the conversation while the tool runs. -->
	{:else if filing && part.state === 'unanswered'}
		<Banner
			tone="critical"
			icon="alert-triangle"
			title="We don’t know if this was filed. Don’t file again yet."
			role="alert"
		>
			The reply stopped while the filing was being sent, so Tejido’s answer never arrived here. The
			deposit may have been paid. Wait a minute, then check your home page and the campaign’s public
			page. If the report isn’t there, file it then.
			{#snippet actions()}
				<Button size="sm" href="/">Open my home page</Button>
			{/snippet}
		</Banner>
	{:else if filing && part.state === 'done'}
		<p class="tj-toolresult tj-tone--neutral" role="status">
			<Icon name="receipt-clock" size={18} />
			<span>
				<strong>Submitted at {part.at}.</strong> Tejido answered. The assistant says next whether the
				report was accepted.
			</span>
		</p>
	{:else if filing}
		<p class="tj-toolresult tj-tone--attention" role="status">
			<Icon name="alert-triangle" size={18} />
			<span>
				<strong>The filing was sent and came back with a problem.</strong> The assistant says next what
				happened. Don’t file again until you know whether this one went through.
			</span>
		</p>
	{:else if part.state === 'done'}
		<p class="tj-toolresult tj-tone--neutral" role="status">
			<Icon name="check" size={18} />
			<span>
				<strong>Qatom answered.</strong> Nothing was filed by this.
				<span class="tool-name">Tool: <span class="tj-id">{part.name}</span></span>
			</span>
		</p>
	{:else}
		<p class="tj-toolresult tj-tone--attention" role="status">
			<Icon name="alert-triangle" size={18} />
			<span>
				<strong>
					{part.state === 'failed'
						? 'Qatom answered with a problem.'
						: 'Qatom did not answer before the reply ended.'}
				</strong>
				Nothing was filed by this.
				<span class="tool-name">Tool: <span class="tj-id">{part.name}</span></span>
			</span>
		</p>
	{/if}
{/snippet}

{#if !data.who}
	<div class="tj-fieldpage">
		<h1>File a report</h1>
		<EmptyState icon="user" title="You are not signed in">
			Open the invite link you were sent and sign in with Qatom from there. The assistant can only
			work for someone who has been invited to a campaign.
			{#snippet action()}
				<Button href="/" size="field">Go to the home page</Button>
			{/snippet}
		</EmptyState>
	</div>
{:else if !party}
	<div class="tj-fieldpage">
		<h1>File a report</h1>
		<EmptyState icon="user" title="You are not on a campaign">
			You are signed in as {data.who.email}. Open the invite link you were sent and sign in from
			there, then come back to this page.
			{#snippet action()}
				<Button href="/" size="field">Go to the home page</Button>
			{/snippet}
		</EmptyState>
	</div>
{:else}
	<div class="tj-fieldapp chat">
		<!-- The page's one header, as on the App's other pages (see FieldPage). The chat is a flow
		     off the home page, so a back arrow replaces the mark. -->
		<FieldHeader title={party.campaignTitle} subtitle="{party.name} · {roleName(party)}" back="/">
			{#snippet end()}
				<form method="POST" action="/auth/sign-out">
					<button type="submit" class="tj-btn tj-btn--quiet tj-btn--field">Sign out</button>
				</form>
			{/snippet}
		</FieldHeader>
		<h1 class="tj-vh">File a report</h1>

		<div class="notices">
			{#if !connected}
				<Banner
					tone="attention"
					icon="alert-circle"
					title="Your Qatom sign-in has run out"
					role="alert"
				>
					The assistant can’t reach Qatom as you until you sign in again. You will come straight
					back to this page. No money moves when you sign in.
					{#snippet actions()}
						<Button
							variant="primary"
							size="field"
							href="/auth/sign-in?party={party.id}&return_to=/chat"
						>
							Sign in with Qatom again
						</Button>
					{/snippet}
				</Banner>
			{/if}
		</div>

		<div class="tj-fieldapp__body body">
			<div class="column">
				<div class="tj-chat">
					<p class="tj-toolresult tj-tone--neutral">
						<Icon name="info" size={18} />
						<span>
							This conversation isn’t kept. Reloading the page clears it. Filed reports stay filed.
						</span>
					</p>
					<div class="log" aria-live="polite" aria-label="Conversation">
						<div class="tj-msg tj-msg--assistant">
							<p class="tj-msg__who">
								<Icon name="weave" size={16} /><span>Tejido assistant</span>
							</p>
							<div class="tj-msg__bubble">
								<p>
									You’re signed in as {party.name}{party.title ? `, ${party.title}` : ''}, on
									<strong>{party.campaignTitle}</strong>.
									{#if about && !focus}
										<strong>{about.title}</strong> is already confirmed. There is nothing more to file
										on it.
									{/if}
									{#if !next}
										Every milestone you are named on is confirmed. There is nothing to file.
									{:else if next.part === 'confirms' && next.state === 'claimed'}
										<strong>{next.title}</strong> has been reported as complete and is waiting for you
										to confirm it.
									{:else if next.part === 'confirms'}
										You confirm <strong>{next.title}</strong>, due {shortDate(next.dueDate)}. It
										hasn’t been reported as complete yet.
									{:else if next.state === 'claimed'}
										<strong>{next.title}</strong> is reported as complete and waiting for its confirmer.
										You can still log work on it.
									{:else}
										{focus ? 'Your reminder is about' : 'Next due from you:'}
										<strong>{next.title}</strong>, {focus ? 'due ' : ''}{shortDate(
											next.dueDate
										)}{overdue(next) > 0 ? `. It is ${days(overdue(next))} overdue` : ''}.
									{/if}
								</p>
								{#if next}
									<p>
										{party.role === 'confirmer'
											? 'Which milestone have you seen finished?'
											: 'What did you get done?'}
									</p>
									<div class="tj-chips">
										<Button
											variant="primary"
											size="field"
											disabled={waiting || !connected}
											onclick={() =>
												quick(
													opener
														? opener.says
														: party.role === 'confirmer'
															? 'I want to confirm a milestone.'
															: 'I want to log this week’s work.'
												)}
										>
											{opener
												? opener.label
												: party.role === 'confirmer'
													? 'Confirm a milestone'
													: 'Log this week’s work'}
										</Button>
										{#if canFill}
											<Button icon="list" size="field" disabled={!connected} onclick={toggleForm}>
												{formOpen ? 'Close the form' : 'Fill in the form'}
											</Button>
										{/if}
										<Button
											variant="quiet"
											size="field"
											disabled={waiting || !connected}
											onclick={() =>
												quick(
													party.role === 'confirmer'
														? 'What is waiting for me to confirm?'
														: 'What do I owe?'
												)}
										>
											{party.role === 'confirmer'
												? 'What is waiting for me?'
												: 'What is due from me?'}
										</Button>
									</div>
								{/if}
							</div>
						</div>

						{#each messages as message, index (message.id)}
							{@const last = index === messages.length - 1}
							{#if message.role === 'user'}
								<div class="tj-msg tj-msg--human">
									<p class="tj-msg__who"><span>You</span><time>· {message.at}</time></p>
									{#if message.attachment}
										{@const file = message.attachment}
										<div class="tj-attach">
											{#if file.preview}
												<img src={file.preview} alt="" />
											{:else}
												<span class="doc"><Icon name="file-text" size={24} /></span>
											{/if}
											<div class="about">
												<p class="tj-attach__name">{file.name}</p>
												{#if file.state === 'uploading'}
													<p class="tj-attach__meta"><Icon name="upload" size={14} />Uploading</p>
												{:else if file.state === 'uploaded' && file.sha256}
													<p class="tj-attach__meta">
														<Icon name="check" size={14} />
														<span>
															Uploaded · <span class="tj-id fingerprint"
																>{shortId(file.sha256)}</span
															>
														</span>
													</p>
												{:else}
													<p class="tj-attach__meta">Not uploaded</p>
												{/if}
											</div>
										</div>
										{#if file.state === 'failed'}
											<div class="after-file" role="alert">
												<p class="tj-error">
													<Icon name="alert-circle" size={18} />{file.problem}
												</p>
												<div class="tj-btn-row">
													{#if file.again}
														<Button size="sm" icon="retry" onclick={() => upload(message.id)}>
															Retry
														</Button>
													{/if}
													<Button size="sm" variant="quiet" onclick={() => removeFile(message.id)}>
														Remove
													</Button>
												</div>
											</div>
										{:else if file.state === 'uploaded' && !message.settled && !(waiting && last)}
											<div class="after-file">
												<p class="tj-help">Uploaded, but the assistant hasn’t been told yet.</p>
												<Button
													size="sm"
													disabled={waiting || !connected}
													onclick={() => sendFile(message.id)}
												>
													Tell the assistant
												</Button>
											</div>
										{/if}
									{:else if message.form}
										{@const form = message.form}
										<div class="tj-msg__bubble sent-form">
											<p><strong>Report form</strong></p>
											<dl class="tj-kv">
												{#each reportFormLines(form, mine.find((milestone) => milestone.id === form.milestone_id)?.title) as line (line.label)}
													<div class="tj-kv__row">
														<dt>{line.label}</dt>
														<dd><span class="words">{line.value}</span></dd>
													</div>
												{/each}
											</dl>
										</div>
										{#each form.photos ?? [] as file, at (file.sha256)}
											{@const document = file.url.endsWith('.pdf')}
											<div class="tj-attach">
												{#if document}
													<span class="doc"><Icon name="file-text" size={24} /></span>
												{:else}
													<img src={file.url} alt="" />
												{/if}
												<div class="about">
													<p class="tj-attach__name">{document ? 'Document' : 'Photo'} {at + 1}</p>
													<p class="tj-attach__meta">
														<Icon name="check" size={14} />
														<span
															>Uploaded · <span class="tj-id fingerprint"
																>{shortId(file.sha256)}</span
															></span
														>
													</p>
												</div>
											</div>
										{/each}
									{:else}
										<div class="tj-msg__bubble words">{message.text}</div>
									{/if}
								</div>
								{#if message.form && message.settled}
									<p class="tj-toolresult tj-tone--neutral" role="status">
										<Icon name="pencil" size={18} />
										<span>
											<strong>Sent to the assistant as a draft.</strong> Nothing is filed until you say
											yes.
										</span>
									</p>
								{/if}
							{:else}
								{#each message.parts as part, at (at)}
									{#if part.kind === 'tool'}
										{@render toolLine(part)}
									{:else if part.text.trim() !== ''}
										{@const review =
											message.settled && !message.problem ? chatReview(part.text) : null}
										<div class="tj-msg tj-msg--assistant">
											{@render who(message.at)}
											{#if review}
												<div class="tj-msg__bubble tj-msg__bubble--wide">
													{#each review.closing.filter((line) => line !== 'File this entry?') as line, n (n)}
														<p>{line}</p>
													{/each}
													<ReviewCard
														{review}
														current={last && at === message.parts.length - 1}
														disabled={waiting || !connected}
														onfile={() => quick('Yes, file this entry as shown.')}
														onchange={() => composer?.focus()}
													/>
												</div>
											{:else}
												<div class="tj-msg__bubble words">{part.text.trim()}</div>
											{/if}
										</div>
									{/if}
								{/each}
								{#if message.problem}
									<div class="tj-msg tj-msg--error tj-msg--assistant" role="alert">
										<p class="tj-msg__who">
											<Icon name="alert-circle" size={16} /><span>The reply stopped</span>
										</p>
										<div class="tj-msg__bubble"><p>{message.problem}</p></div>
									</div>
								{/if}
							{/if}
						{/each}

						{#if working}
							<div class="tj-msg tj-msg--assistant">
								<p class="tj-msg__who">
									<Icon name="weave" size={16} /><span>Tejido assistant</span>
								</p>
								<div class="tj-msg__bubble working">
									<span class="tj-msg__dots" aria-hidden="true"><i></i><i></i><i></i></span>
									<span class="tj-muted">{working}</span>
								</div>
							</div>
						{/if}
					</div>

					{#if canFill}
						<div class="tj-msg tj-msg--assistant form" bind:this={formPlace} hidden={!formOpen}>
							<p class="tj-msg__who">
								<Icon name="weave" size={16} /><span>Tejido assistant</span>
							</p>
							<div class="tj-msg__bubble tj-msg__bubble--wide">
								<p>
									Fill in what applies. Sending this files nothing and pays no deposit: I show you
									the report first and file it only when you say yes. The deposit is
									{data.deposit?.log_work} USD-TDN for a work log and {data.deposit?.milestone_hit} USD-TDN
									for a milestone report.
								</p>
								<ReportForm milestones={mine} disabled={waiting || !connected} submit={sendForm} />
							</div>
						</div>
					{/if}

					{#if problem}
						<Banner tone="attention" icon="alert-circle" title="Not sent" role="alert">
							{problem}
						</Banner>
					{/if}
				</div>

				<form class="tj-composer" onsubmit={send}>
					{#if attachOpen}
						<div class="tj-chips attach" id="attach-choices">
							<label class="tj-btn tj-btn--primary pick">
								<Icon name="camera" /><span>Take photo</span>
								<input
									class="tj-vh"
									type="file"
									accept={PICTURE_TYPES.join(',')}
									capture="environment"
									onchange={attach}
								/>
							</label>
							<label class="tj-btn tj-btn--secondary pick">
								<Icon name="paperclip" /><span>Choose file</span>
								<input
									class="tj-vh"
									type="file"
									accept={[...PICTURE_TYPES, ...DOCUMENT_TYPES].join(',')}
									onchange={attach}
								/>
							</label>
							<p class="tj-help">
								Photos or PDF documents, up to {EVIDENCE_MAX_MEGABYTES} MB. The file is uploaded so donors
								can see it, then the assistant is told. To keep a file from donors, use Upload evidence
								in the menu.
							</p>
						</div>
					{/if}
					<button
						type="button"
						class="tj-btn tj-btn--secondary tj-btn--icon"
						aria-label="Add photo or file"
						aria-expanded={attachOpen}
						aria-controls="attach-choices"
						disabled={!connected}
						onclick={() => (attachOpen = !attachOpen)}
					>
						<Icon name="camera" />
					</button>
					<div class="write">
						<label class="tj-vh" for="draft">Message</label>
						<textarea
							class="tj-textarea"
							id="draft"
							rows="1"
							maxlength="8000"
							bind:this={composer}
							bind:value={draft}
							oninput={fit}
							onkeydown={onKeydown}
							disabled={!connected}
							placeholder={party.role === 'confirmer'
								? 'What did you see?'
								: 'What did you do today?'}></textarea>
					</div>
					{#if waiting}
						<button
							type="button"
							class="tj-btn tj-btn--secondary tj-btn--icon"
							aria-label="Stop the reply"
							onclick={() => stopper?.abort()}
						>
							<Icon name="x" />
						</button>
					{:else}
						<button
							type="submit"
							class="tj-btn tj-btn--primary tj-btn--icon"
							aria-label="Send"
							disabled={!connected}
						>
							<Icon name="arrow-up" />
						</button>
					{/if}
				</form>
			</div>

			<aside class="tj-fieldapp__side side" aria-label="Context">
				<div class="tj-card">
					<p class="text-eyebrow">This conversation</p>
					<ul class="tj-checklist">
						{#if formsSent > 0}
							<li class="is-done">
								<Icon name="check" size={18} />
								{formsSent === 1
									? 'Report form sent as a draft'
									: `${formsSent} report forms sent as drafts`}
							</li>
						{/if}
						{#each filings as part (part.id)}
							{#if part.state === 'done'}
								<li class="is-done"><Icon name="check" size={18} />Submitted at {part.at}</li>
							{:else if part.state === 'running'}
								<li><Icon name="clock" size={18} />Sending a filing to Tejido</li>
							{:else if part.state === 'failed'}
								<li class="is-missing">
									<Icon name="alert-triangle" size={18} />A filing came back with a problem
								</li>
							{:else}
								<li class="is-missing">
									<Icon name="alert-triangle" size={18} />Not known whether a filing went through
								</li>
							{/if}
						{/each}
						{#if filings.length === 0}
							<li><Icon name="clock" size={18} />Filed: not yet</li>
						{/if}
					</ul>
					<p class="tj-help">
						Recorded and confirmed are not shown here. They appear on the campaign’s public page.
					</p>
				</div>

				{#if mine.length > 0}
					<div class="tj-card">
						<p class="text-eyebrow">
							{party.role === 'confirmer' ? 'Yours to confirm' : 'Due from you'}
						</p>
						{#each mine as milestone (milestone.id)}
							{@const late = overdue(milestone)}
							<div class="due">
								<p>
									<strong>{milestone.title}</strong>
									<span class="tj-help">
										{milestone.part === 'owes' ? 'You report this' : 'You confirm this'} · due
										{shortDate(milestone.dueDate)}
									</span>
								</p>
								{#if milestone.state !== 'open' || late > 0}
									<p class="badges">
										{#if milestone.state === 'claimed'}
											<StatusBadge state="claimed" />
										{:else if milestone.state !== 'open'}
											<StatusBadge state="confirmed" />
										{/if}
										{#if late > 0}
											<StatusBadge state="overdue" label="Overdue · {days(late)}" />
										{/if}
									</p>
								{/if}
							</div>
						{/each}
					</div>
				{/if}
			</aside>
		</div>
	</div>
{/if}

<style>
	/* The layout's <main> hands its whole height to the chat, so the composer rests at the bottom
	   of the screen when little has been said. */
	:global(main:has(> .chat)) {
		display: flex;
		flex-direction: column;
	}
	/* The chat names itself in its own header, as the App's other pages do (see FieldPage). The
	   layout's general header, with its links, stands down while the chat is showing. */
	:global(.tj-screen:has(.chat) > .tj-fieldheader) {
		display: none;
	}
	.chat {
		display: flex;
		flex-direction: column;
		flex: 1 0 auto;
		min-height: 0;
	}
	/* The design's header is 60px. A 48px control inside it needs the smaller padding to fit. */
	.chat > :global(.tj-fieldheader) {
		padding-block: var(--space-1);
	}
	.chat :global(.tj-fieldheader form) {
		margin: 0;
	}
	.notices:not(:empty) {
		padding: var(--space-4) var(--space-4) 0;
	}
	.body {
		flex: 1 0 auto;
		align-content: stretch;
	}
	.column {
		min-width: 0;
		display: grid;
		grid-template-rows: 1fr auto;
	}
	.log {
		display: grid;
		gap: var(--space-4);
		align-content: start;
		min-width: 0;
	}
	.words {
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.working {
		display: flex;
		gap: var(--space-2);
		align-items: center;
	}
	.sent-form {
		min-width: min(100%, 16rem);
	}
	.sent-form .tj-kv {
		padding: 0;
	}
	.about {
		min-width: 0;
	}
	.doc {
		display: grid;
		place-items: center;
		width: 72px;
		height: 54px;
		border-radius: var(--radius-sm);
		background: var(--bg-sunken);
		color: var(--text-secondary);
	}
	.fingerprint {
		white-space: nowrap;
	}
	.tool-name {
		display: block;
		font-size: 13px;
		line-height: 18px;
		color: var(--text-muted);
	}
	.form {
		scroll-margin-top: 72px;
	}
	.form[hidden] {
		display: none;
	}
	.write {
		min-width: 0;
		display: grid;
	}
	.after-file {
		display: grid;
		gap: var(--space-2);
		justify-items: end;
		max-width: 320px;
		text-align: right;
	}
	.attach {
		grid-column: 1 / -1;
	}
	.attach .tj-help {
		flex-basis: 100%;
	}
	/* The file input is invisible, so the label shows where the keyboard is. */
	.pick:focus-within {
		outline: var(--border-focus) solid var(--focus-ring);
		outline-offset: 2px;
	}
	/* The context column stays in view beside a long conversation. */
	.side {
		position: sticky;
		top: 60px;
		align-self: start;
	}
	.due {
		display: grid;
		gap: var(--space-1);
	}
	.due + .due {
		padding-top: var(--space-3);
		border-top: var(--border-hair) solid var(--border);
	}
	.due strong,
	.due .tj-help {
		display: block;
	}
	.badges {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-2);
	}
	@container (min-width: 900px) {
		.notices:not(:empty) {
			padding-inline: var(--space-8);
		}
	}
</style>
