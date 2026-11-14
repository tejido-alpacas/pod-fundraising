<!--
	The report form inside the chat (B6, guided collection). Track B owns this file.

	It collects what one report needs: the milestone, which report, the fields that kind of
	report takes in the contracts, the note, and photos or documents (uploaded through
	POST /api/evidence, like the upload page). Sending it files nothing: `submit` puts the values
	into the conversation, and the agent files the report once the person says yes.
-->
<script lang="ts">
	import {
		EVIDENCE_FILE_FIELD,
		evidenceUploadResponseSchema,
		MAX_PHOTOS_PER_ENTRY,
		workLogStatusSchema,
		type WorkLogStatus
	} from '@tejido/contracts';
	import {
		checkEvidenceFile,
		DOCUMENT_TYPE_NAMES,
		DOCUMENT_TYPES,
		EVIDENCE_MAX_MEGABYTES,
		PICTURE_TYPES,
		PROBLEM_SENTENCES,
		problemFromStatus,
		type EvidenceProblem
	} from '#lib/evidence.ts';
	import {
		detailFieldsFor,
		FIELD_SENTENCES,
		MILESTONE_KIND_RULES,
		REPORT_KIND_NAMES,
		reportKindsFor,
		STATUS_NAMES,
		typedNumber,
		type ReportFormMilestone,
		type ReportFormProblems,
		type ReportFormValues,
		type ReportKind
	} from '#lib/report-form.ts';

	interface Props {
		/** The milestones this person owes or confirms. */
		milestones: ReportFormMilestone[];
		/** True while the agent is replying, or cannot be reached as this person. */
		disabled: boolean;
		/**
		 * Puts the form into the conversation. Answers `null` once it has gone, or what to fix:
		 * a sentence per field, or nothing when the problem is shown elsewhere on the page.
		 */
		submit: (values: ReportFormValues) => Promise<ReportFormProblems | null>;
	}
	let { milestones, disabled, submit }: Props = $props();

	type Ended =
		{ status: 'done'; url: string; sha256: string } | { status: 'failed'; problem: string };
	type FileRow = { key: string; name: string } & (Ended | { status: 'uploading' });

	const STATUSES = workLogStatusSchema.options;
	const KIND_HINTS: Record<ReportKind, string> = {
		log_work: 'The routine update on the work so far.',
		completed: 'You are saying this milestone is finished.',
		delivered: 'You are saying the goods have been delivered.',
		funds_spent: 'You are saying the money has been spent or handed over.',
		confirm: 'You have seen for yourself that this milestone is done, and you sign it off.'
	};

	// Only milestones something can still be filed on.
	const open = $derived(milestones.filter((milestone) => reportKindsFor(milestone).length > 0));

	let milestoneId = $state('');
	let chosenKind = $state<ReportKind | null>(null);
	let summary = $state('');
	let status = $state<WorkLogStatus | ''>('');
	let percent = $state('');
	let quantity = $state('');
	let unit = $state('');
	let amount = $state('');
	let files = $state<FileRow[]>([]);
	let problems = $state<ReportFormProblems>({});
	let sending = $state(false);
	let count = 0;

	const milestone = $derived(open.find((candidate) => candidate.id === milestoneId) ?? open[0]);
	const kinds = $derived(milestone ? reportKindsFor(milestone) : []);
	const kind = $derived(chosenKind && kinds.includes(chosenKind) ? chosenKind : kinds[0]);
	const details = $derived(kind ? detailFieldsFor(kind) : []);
	const rules = $derived(milestone ? MILESTONE_KIND_RULES[milestone.kind] : null);
	const percentNeeded = $derived(
		kind === 'log_work' && rules?.workLogNeedsPercent === true && status !== 'blocked'
	);
	const attached = $derived(files.filter((row) => row.status === 'done'));
	const uploading = $derived(files.some((row) => row.status === 'uploading'));
	const full = $derived(attached.length >= MAX_PHOTOS_PER_ENTRY);
	const fileTypes = $derived(
		rules?.documentsOnly ? DOCUMENT_TYPES : [...PICTURE_TYPES, ...DOCUMENT_TYPES]
	);

	const failed = (problem: EvidenceProblem): Ended => ({
		status: 'failed',
		problem: PROBLEM_SENTENCES[problem]
	});

	async function upload(file: File): Promise<Ended> {
		const body = new FormData();
		body.set(EVIDENCE_FILE_FIELD, file);
		let response: Response;
		try {
			response = await fetch('/api/evidence', { method: 'POST', body });
		} catch {
			return failed('network');
		}
		if (!response.ok) return failed(problemFromStatus(response.status));
		let answer: unknown;
		try {
			answer = await response.json();
		} catch {
			return failed('unexpected');
		}
		const parsed = evidenceUploadResponseSchema.safeParse(answer);
		return parsed.success ? { status: 'done', ...parsed.data } : failed('unexpected');
	}

	async function chosen(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const picked = [...(input.files ?? [])];
		input.value = '';
		problems.photos = undefined;

		// Every chosen file gets its row at once; then they are sent one after another.
		const waiting: { key: string; file: File }[] = [];
		for (const file of picked) {
			const key = `file-${count++}`;
			const check = checkEvidenceFile(file);
			if (!check.ok) {
				files.push({ key, name: file.name, ...failed(check.problem) });
			} else if (rules?.documentsOnly && !DOCUMENT_TYPES.includes(check.type)) {
				files.push({
					key,
					name: file.name,
					status: 'failed',
					problem: FIELD_SENTENCES.documents_only
				});
			} else {
				files.push({ key, name: file.name, status: 'uploading' });
				waiting.push({ key, file });
			}
		}
		for (const { key, file } of waiting) {
			const ended = await upload(file);
			const at = files.findIndex((row) => row.key === key);
			if (at !== -1) files[at] = { key, name: file.name, ...ended };
		}
	}

	/** Once a field is changed, what was said about it (and about the form as a whole) is stale. */
	function touched(event: Event) {
		const field = (event.target as HTMLElement).dataset.field as
			keyof ReportFormProblems | undefined;
		if (field) problems[field] = undefined;
		problems.form = undefined;
	}

	function remove(key: string) {
		files = files.filter((row) => row.key !== key);
	}

	/** The form as typed, or the sentences saying what to fix before it can be sent. */
	function collect(): { values: ReportFormValues } | { problems: ReportFormProblems } {
		const found: ReportFormProblems = {};
		if (!milestone || !kind) return { problems: { milestone_id: FIELD_SENTENCES.milestone_id } };

		const values: ReportFormValues = {
			kind,
			milestone_id: milestone.id,
			summary: summary.trim()
		};
		if (values.summary === '') found.summary = FIELD_SENTENCES.summary;

		if (details.includes('status') && status !== '') values.status = status;
		if (details.includes('percent_complete')) {
			const typed = typedNumber(percent);
			if (typed === null || (typed !== undefined && typed > 100)) {
				found.percent_complete = FIELD_SENTENCES.percent_complete;
			} else if (typed === undefined && percentNeeded) {
				found.percent_complete = FIELD_SENTENCES.percent_needed;
			} else if (typed !== undefined) values.percent_complete = typed;
		}
		if (details.includes('quantity')) {
			const typed = typedNumber(quantity);
			if (typed === null || typed === undefined) found.quantity = FIELD_SENTENCES.quantity;
			else values.quantity = typed;
		}
		if (details.includes('unit')) {
			if (unit.trim() === '') found.unit = FIELD_SENTENCES.unit;
			else values.unit = unit.trim();
		}
		if (details.includes('amount_spent')) {
			const typed = typedNumber(amount);
			if (typed === null || typed === undefined) found.amount_spent = FIELD_SENTENCES.amount_spent;
			else values.amount_spent = typed;
		}
		if (attached.length > MAX_PHOTOS_PER_ENTRY) found.photos = FIELD_SENTENCES.photos;
		else if (attached.length > 0) {
			values.photos = attached.map(({ url, sha256 }) => ({ url, sha256 }));
		}

		return Object.keys(found).length > 0 ? { problems: found } : { values };
	}

	async function send(event: SubmitEvent) {
		event.preventDefault();
		if (disabled || sending || uploading) return;

		const collected = collect();
		if ('problems' in collected) {
			problems = collected.problems;
			return;
		}
		problems = {};
		sending = true;
		try {
			const refused = await submit(collected.values);
			if (refused) {
				problems = refused;
				return;
			}
			// It is in the conversation now. Start the next report from an empty form.
			summary = '';
			status = '';
			percent = '';
			quantity = '';
			unit = '';
			amount = '';
			files = [];
		} finally {
			sending = false;
		}
	}
</script>

{#snippet problem(text: string | undefined, id: string)}
	{#if text}
		<p class="problem" role="alert" {id}>{text}</p>
	{/if}
{/snippet}

{#if open.length === 0}
	<p class="hint">
		Every milestone you are named on is confirmed, so there is nothing to fill in. You can still ask
		the agent anything below.
	</p>
{:else}
	<form onsubmit={send} oninput={touched} novalidate>
		<p class="hint">
			Fill this in and the agent will not need to ask for each piece. Sending the form does not file
			the report or spend anything: the agent shows you the report first and files it only when you
			say yes.
		</p>

		<label>
			<span>Milestone</span>
			<select
				value={milestone?.id}
				onchange={(event) => (milestoneId = event.currentTarget.value)}
				aria-describedby="rf-milestone-problem"
			>
				{#each open as choice (choice.id)}
					<option value={choice.id}>{choice.title}</option>
				{/each}
			</select>
		</label>
		{@render problem(problems.milestone_id, 'rf-milestone-problem')}

		{#if kind}
			<fieldset>
				<legend>Which report</legend>
				{#each kinds as choice (choice)}
					<label class="choice">
						<input
							type="radio"
							name="rf-kind"
							value={choice}
							checked={choice === kind}
							onchange={() => (chosenKind = choice)}
						/>
						<span>
							<strong>{REPORT_KIND_NAMES[choice]}</strong>
							<small>{KIND_HINTS[choice]}</small>
						</span>
					</label>
				{/each}
			</fieldset>
			{@render problem(problems.kind, 'rf-kind-problem')}
		{/if}

		{#if details.includes('status')}
			<label>
				<span>How is the work going? <small>(optional)</small></span>
				<select data-field="status" bind:value={status} aria-describedby="rf-status-problem">
					<option value="">Not said</option>
					{#each STATUSES as choice (choice)}
						<option value={choice}>{STATUS_NAMES[choice]}</option>
					{/each}
				</select>
			</label>
			{@render problem(problems.status, 'rf-status-problem')}
		{/if}

		{#if details.includes('percent_complete')}
			<label>
				<span>
					Percent complete, 0 to 100
					{#if !percentNeeded}<small>(optional)</small>{/if}
				</span>
				<input
					type="text"
					inputmode="decimal"
					autocomplete="off"
					data-field="percent_complete"
					bind:value={percent}
					aria-describedby="rf-percent-problem"
					placeholder="For example 40"
				/>
			</label>
			{@render problem(problems.percent_complete, 'rf-percent-problem')}
		{/if}

		{#if details.includes('quantity')}
			<div class="pair">
				<label>
					<span>How many were delivered</span>
					<input
						type="text"
						inputmode="decimal"
						autocomplete="off"
						data-field="quantity"
						bind:value={quantity}
						aria-describedby="rf-quantity-problem"
						placeholder="For example 600"
					/>
				</label>
				<label>
					<span>Of what</span>
					<input
						type="text"
						autocomplete="off"
						maxlength="50"
						data-field="unit"
						bind:value={unit}
						aria-describedby="rf-unit-problem"
						placeholder="For example books"
					/>
				</label>
			</div>
			{@render problem(problems.quantity, 'rf-quantity-problem')}
			{@render problem(problems.unit, 'rf-unit-problem')}
		{/if}

		{#if details.includes('amount_spent')}
			<label>
				<span>Amount spent <small>(the number only)</small></span>
				<input
					type="text"
					inputmode="decimal"
					autocomplete="off"
					data-field="amount_spent"
					bind:value={amount}
					aria-describedby="rf-amount-problem"
					placeholder="For example 1250.50"
				/>
			</label>
			{@render problem(problems.amount_spent, 'rf-amount-problem')}
		{/if}

		<label>
			<span>
				{kind === 'confirm' ? 'What you checked before confirming' : 'Note: what was done'}
			</span>
			<textarea
				rows="4"
				maxlength="4000"
				data-field="summary"
				bind:value={summary}
				aria-describedby="rf-summary-problem"></textarea>
		</label>
		{@render problem(problems.summary, 'rf-summary-problem')}

		<fieldset>
			<legend>
				{rules?.documentsOnly ? 'Documents' : 'Photos and documents'} <small>(optional)</small>
			</legend>
			{#if rules?.documentsOnly}
				<small>
					This milestone takes documents only, such as a receipt or a letter, as
					{DOCUMENT_TYPE_NAMES}. No pictures.
				</small>
			{:else}
				<label class="file">
					<span>Take a photo</span>
					<input
						type="file"
						accept={PICTURE_TYPES.join(',')}
						capture="environment"
						disabled={full}
						onchange={chosen}
					/>
				</label>
			{/if}
			<label class="file">
				<span>{rules?.documentsOnly ? 'Choose documents' : 'Choose photos or documents'}</span>
				<input
					type="file"
					accept={fileTypes.join(',')}
					multiple
					disabled={full}
					onchange={chosen}
				/>
			</label>
			<small>
				Each file can be at most {EVIDENCE_MAX_MEGABYTES} MB. One report can carry at most
				{MAX_PHOTOS_PER_ENTRY} files. Uploading starts as soon as you choose a file.
			</small>
			{#if files.length > 0}
				<ul aria-live="polite">
					{#each files as row (row.key)}
						<li>
							<span class="name">{row.name}</span>
							{#if row.status === 'uploading'}
								<span class="state">Uploading…</span>
							{:else if row.status === 'done'}
								<span class="state ok">Attached</span>
							{/if}
							{#if row.status !== 'uploading'}
								<button type="button" class="quiet" onclick={() => remove(row.key)}>
									Remove<span class="sr"> {row.name}</span>
								</button>
							{/if}
							{#if row.status === 'failed'}
								<p class="problem" role="alert">{row.problem}</p>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</fieldset>
		{@render problem(problems.photos, 'rf-photos-problem')}
		{@render problem(problems.form, 'rf-form-problem')}

		<button type="submit" disabled={disabled || sending || uploading}>
			{#if uploading}
				Waiting for the files…
			{:else if sending}
				Waiting for the agent…
			{:else}
				Send to the agent
			{/if}
		</button>
	</form>
{/if}

<style>
	form {
		display: grid;
		gap: 0.9rem;
		margin-top: 0.75rem;
	}
	.hint {
		margin: 0.5rem 0 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
	label {
		display: grid;
		gap: 0.25rem;
	}
	label > span:first-child,
	legend {
		font-weight: 600;
	}
	small {
		font-size: 0.9rem;
		font-weight: 400;
		color: var(--muted);
	}
	input[type='text'],
	select,
	textarea {
		/* 16px and up, so a phone does not zoom in on the field. */
		font: inherit;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.6rem 0.75rem;
		min-height: 2.75rem;
		width: 100%;
		box-sizing: border-box;
	}
	textarea {
		resize: vertical;
	}
	input[type='file'] {
		font: inherit;
		width: 100%;
		min-width: 0;
	}
	fieldset > :global(*) {
		min-width: 0;
	}
	fieldset {
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.6rem 0.75rem 0.75rem;
		margin: 0;
		min-width: 0;
		display: grid;
		gap: 0.6rem;
	}
	legend {
		padding: 0 0.3rem;
	}
	.choice {
		grid-template-columns: auto 1fr;
		gap: 0.6rem;
		align-items: start;
		min-height: 2.75rem;
		cursor: pointer;
	}
	.choice input {
		width: 1.25rem;
		height: 1.25rem;
		margin: 0.2rem 0 0;
		accent-color: var(--a);
	}
	.choice span {
		display: grid;
		font-weight: 400;
	}
	.pair {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 0.75rem;
		align-items: end;
	}
	.file > span:first-child {
		font-weight: 400;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.5rem;
	}
	li {
		display: flex;
		flex-wrap: wrap;
		gap: 0.25rem 0.75rem;
		align-items: center;
		border-top: 1px solid var(--line);
		padding-top: 0.5rem;
	}
	.name {
		flex: 1 1 8rem;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.state {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.state.ok {
		font-weight: 600;
		color: var(--a);
	}
	.problem {
		flex-basis: 100%;
		margin: 0;
		border-left: 3px solid var(--warn);
		padding-left: 0.75rem;
		color: var(--warn);
	}
	button {
		font: inherit;
		font-weight: 600;
		color: var(--surface);
		background: var(--a);
		border: 1px solid var(--a);
		border-radius: 6px;
		padding: 0.6rem 1.1rem;
		min-height: 2.75rem;
		cursor: pointer;
	}
	button.quiet {
		color: var(--ink);
		background: var(--surface);
		border-color: var(--line);
		padding: 0.3rem 0.8rem;
		min-height: 2.75rem;
	}
	button:disabled {
		opacity: 0.55;
		cursor: default;
	}
	.sr {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	@media (max-width: 24rem) {
		.pair {
			grid-template-columns: 1fr;
		}
	}
</style>
