<!--
	The report form inside the chat (B6, guided collection). Track B owns this file.

	It is drawn as the design system's in-chat form (`tj-inform`). `@tejido/ui` has an
	`EntryDetailsForm`, but it does not fit: it has a currency, a date and a draft saved on the
	device, none of which a report carries, and it lacks the kind of report, the status, the
	percent complete and the files, which a report does carry.

	It collects what one report needs: the milestone, which report, the fields that kind of
	report takes in the contracts, the note, and photos or documents (uploaded through
	POST /api/evidence, like the upload page). Sending it files nothing: `submit` puts the values
	into the conversation, and the agent files the report once the person says yes.
-->
<script lang="ts">
	import { Button, Icon, StatusBadge, shortId } from '@tejido/ui';
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

	const uid = $props.id();

	type Ended =
		{ status: 'done'; url: string; sha256: string } | { status: 'failed'; problem: string };
	type FileRow = { key: string; name: string; picture: boolean } & (
		Ended | { status: 'uploading' }
	);

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
		const waiting: { key: string; file: File; picture: boolean }[] = [];
		for (const file of picked) {
			const key = `file-${count++}`;
			const picture = file.type.startsWith('image/');
			const check = checkEvidenceFile(file);
			if (!check.ok) {
				files.push({ key, name: file.name, picture, ...failed(check.problem) });
			} else if (rules?.documentsOnly && !DOCUMENT_TYPES.includes(check.type)) {
				files.push({
					key,
					name: file.name,
					picture,
					status: 'failed',
					problem: FIELD_SENTENCES.documents_only
				});
			} else {
				files.push({ key, name: file.name, picture, status: 'uploading' });
				waiting.push({ key, file, picture });
			}
		}
		for (const { key, file, picture } of waiting) {
			const ended = await upload(file);
			const at = files.findIndex((row) => row.key === key);
			if (at !== -1) files[at] = { key, name: file.name, picture, ...ended };
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
		<p class="tj-error" role="alert" {id}><Icon name="alert-circle" size={18} />{text}</p>
	{/if}
{/snippet}

{#if open.length === 0}
	<div class="tj-inform">
		<p class="tj-help">
			Every milestone you are named on is confirmed, so there is nothing to fill in. You can still
			ask the assistant a question.
		</p>
	</div>
{:else}
	<form
		class="tj-inform"
		onsubmit={send}
		oninput={touched}
		novalidate
		aria-labelledby="{uid}-title"
	>
		<p class="tj-inform__title" id="{uid}-title">
			Report details <StatusBadge state="pending" label="Draft" plain />
		</p>
		<div class="tj-field">
			<label class="tj-label" for="{uid}-milestone">Milestone</label>
			<span class="tj-select-wrap">
				<select
					class="tj-select"
					id="{uid}-milestone"
					value={milestone?.id}
					onchange={(event) => (milestoneId = event.currentTarget.value)}
					aria-invalid={problems.milestone_id ? 'true' : undefined}
					aria-describedby={problems.milestone_id ? `${uid}-milestone-problem` : undefined}
				>
					{#each open as choice (choice.id)}
						<option value={choice.id}>{choice.title}</option>
					{/each}
				</select>
				<Icon name="chevron-down" size={18} />
			</span>
			{@render problem(problems.milestone_id, `${uid}-milestone-problem`)}
		</div>

		{#if kind}
			<fieldset
				class="tj-field"
				aria-describedby={problems.kind ? `${uid}-kind-problem` : undefined}
			>
				<legend class="tj-label">Which report</legend>
				<div class="tj-choices">
					{#each kinds as choice (choice)}
						<label class="tj-check tj-choice">
							<input
								type="radio"
								name="{uid}-kind"
								value={choice}
								checked={choice === kind}
								onchange={() => (chosenKind = choice)}
							/>
							<span class="tj-check__text">
								<strong>{REPORT_KIND_NAMES[choice]}</strong>
								<small>{KIND_HINTS[choice]}</small>
							</span>
						</label>
					{/each}
				</div>
				{@render problem(problems.kind, `${uid}-kind-problem`)}
			</fieldset>
		{/if}

		{#if details.includes('status') || details.includes('percent_complete')}
			<div class="tj-inform__grid tj-inform__grid--2">
				{#if details.includes('status')}
					<div class="tj-field">
						<label class="tj-label" for="{uid}-status">
							How the work is going <span class="tj-label__opt">(optional)</span>
						</label>
						<span class="tj-select-wrap">
							<select
								class="tj-select"
								id="{uid}-status"
								data-field="status"
								bind:value={status}
								aria-invalid={problems.status ? 'true' : undefined}
								aria-describedby={problems.status ? `${uid}-status-problem` : undefined}
							>
								<option value="">Not said</option>
								{#each STATUSES as choice (choice)}
									<option value={choice}>{STATUS_NAMES[choice]}</option>
								{/each}
							</select>
							<Icon name="chevron-down" size={18} />
						</span>
						{@render problem(problems.status, `${uid}-status-problem`)}
					</div>
				{/if}

				{#if details.includes('percent_complete')}
					<div class="tj-field">
						<label class="tj-label" for="{uid}-percent">
							Percent complete
							{#if !percentNeeded}<span class="tj-label__opt">(optional)</span>{/if}
						</label>
						<span class="tj-combo">
							<input
								class="tj-input"
								id="{uid}-percent"
								type="text"
								inputmode="decimal"
								autocomplete="off"
								data-field="percent_complete"
								bind:value={percent}
								aria-invalid={problems.percent_complete ? 'true' : undefined}
								aria-describedby="{uid}-percent-help{problems.percent_complete
									? ` ${uid}-percent-problem`
									: ''}"
							/>
							<span class="affix" aria-hidden="true">%</span>
						</span>
						<p class="tj-help" id="{uid}-percent-help">A number from 0 to 100, as you judge it.</p>
						{@render problem(problems.percent_complete, `${uid}-percent-problem`)}
					</div>
				{/if}
			</div>
		{/if}

		{#if details.includes('quantity')}
			<div class="tj-field">
				<label class="tj-label" for="{uid}-quantity">Quantity delivered</label>
				<span class="tj-combo">
					<input
						class="tj-input"
						id="{uid}-quantity"
						type="text"
						inputmode="decimal"
						autocomplete="off"
						data-field="quantity"
						bind:value={quantity}
						aria-invalid={problems.quantity ? 'true' : undefined}
						aria-describedby="{uid}-quantity-help{problems.quantity
							? ` ${uid}-quantity-problem`
							: ''}"
					/>
					<input
						class="tj-input unit"
						type="text"
						autocomplete="off"
						autocapitalize="none"
						maxlength="50"
						data-field="unit"
						bind:value={unit}
						aria-label="Unit: what the quantity counts"
						aria-invalid={problems.unit ? 'true' : undefined}
						aria-describedby="{uid}-quantity-help{problems.unit ? ` ${uid}-unit-problem` : ''}"
						placeholder="unit"
					/>
				</span>
				<p class="tj-help" id="{uid}-quantity-help">
					The number, then what it counts. For example 600 and books.
				</p>
				{@render problem(problems.quantity, `${uid}-quantity-problem`)}
				{@render problem(problems.unit, `${uid}-unit-problem`)}
			</div>
		{/if}

		{#if details.includes('amount_spent')}
			<div class="tj-field">
				<label class="tj-label" for="{uid}-amount">Amount spent</label>
				<input
					class="tj-input"
					id="{uid}-amount"
					type="text"
					inputmode="decimal"
					autocomplete="off"
					data-field="amount_spent"
					bind:value={amount}
					aria-invalid={problems.amount_spent ? 'true' : undefined}
					aria-describedby="{uid}-amount-help{problems.amount_spent
						? ` ${uid}-amount-problem`
						: ''}"
				/>
				<p class="tj-help" id="{uid}-amount-help">The number only. For example 1250.50.</p>
				{@render problem(problems.amount_spent, `${uid}-amount-problem`)}
			</div>
		{/if}

		<div class="tj-field">
			<label class="tj-label" for="{uid}-summary">
				{kind === 'confirm' ? 'What you checked before confirming' : 'What was done'}
			</label>
			<textarea
				class="tj-textarea"
				id="{uid}-summary"
				rows="3"
				maxlength="4000"
				data-field="summary"
				bind:value={summary}
				aria-invalid={problems.summary ? 'true' : undefined}
				aria-describedby={problems.summary ? `${uid}-summary-problem` : undefined}></textarea>
			{@render problem(problems.summary, `${uid}-summary-problem`)}
		</div>

		<fieldset
			class="tj-field"
			aria-describedby="{uid}-files-help{problems.photos ? ` ${uid}-photos-problem` : ''}"
		>
			<legend class="tj-label">
				{rules?.documentsOnly ? 'Documents' : 'Photos and documents'}
				<span class="tj-label__opt">(optional)</span>
			</legend>
			<div class="tj-picker" class:one={rules?.documentsOnly}>
				{#if !rules?.documentsOnly}
					<label class="tj-picker__opt tj-picker__opt--primary" class:is-off={full}>
						<Icon name="camera" size={28} />
						<span>Take a photo<small>Opens the camera</small></span>
						<input
							type="file"
							accept={PICTURE_TYPES.join(',')}
							capture="environment"
							disabled={full}
							onchange={chosen}
						/>
					</label>
				{/if}
				<label class="tj-picker__opt" class:is-off={full}>
					<Icon name="paperclip" size={28} />
					<span>
						Choose files<small>{rules?.documentsOnly ? 'PDF documents' : 'Photos or PDFs'}</small>
					</span>
					<input
						type="file"
						accept={fileTypes.join(',')}
						multiple
						disabled={full}
						onchange={chosen}
					/>
				</label>
				<p class="tj-picker__limits" id="{uid}-files-help">
					{#if rules?.documentsOnly}
						This milestone takes documents only, such as a receipt or a letter, as
						{DOCUMENT_TYPE_NAMES}. No pictures.
					{/if}
					Up to {EVIDENCE_MAX_MEGABYTES} MB each. Up to {MAX_PHOTOS_PER_ENTRY} files per report. Uploading
					starts as soon as you choose a file.
				</p>
			</div>
			{#if files.length > 0}
				<ul class="files" aria-live="polite">
					{#each files as row (row.key)}
						<li class="tj-upload is-{row.status}">
							{#if row.status === 'done' && row.picture}
								<img class="tj-upload__thumb" src={row.url} alt="" />
							{:else}
								<span class="tj-upload__thumb">
									<Icon name={row.picture ? 'image' : 'file-text'} size={24} />
								</span>
							{/if}
							<div class="about">
								<p class="tj-upload__name">{row.name}</p>
								{#if row.status === 'uploading'}
									<p class="tj-upload__meta">
										<Icon name="upload" size={16} /><span>Uploading. Keep this page open.</span>
									</p>
								{:else if row.status === 'done'}
									<p class="tj-upload__meta">
										<Icon name="check" size={16} />
										<span
											>Uploaded · fingerprint <span class="tj-id fingerprint"
												>{shortId(row.sha256)}</span
											></span
										>
									</p>
								{:else}
									<p class="tj-upload__meta" role="alert">
										<Icon name="alert-triangle" size={16} /><span>{row.problem}</span>
									</p>
								{/if}
							</div>
							{#if row.status !== 'uploading'}
								<button
									type="button"
									class="tj-btn tj-btn--quiet tj-btn--icon"
									aria-label="Remove {row.name}"
									onclick={() => remove(row.key)}
								>
									<Icon name="x" />
								</button>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			{@render problem(problems.photos, `${uid}-photos-problem`)}
		</fieldset>

		{@render problem(problems.form, `${uid}-form-problem`)}

		<Button
			variant="secondary"
			size="field"
			block
			type="submit"
			busy={sending || uploading}
			disabled={disabled || sending || uploading}
		>
			{#if uploading}
				Waiting for the files…
			{:else if sending}
				Sending…
			{:else}
				Send to the assistant
			{/if}
		</Button>
	</form>
{/if}

<style>
	fieldset {
		border: 0;
		padding: 0;
		margin: 0;
	}
	legend {
		padding: 0;
		margin-bottom: var(--space-1);
	}
	/* The unit is typed, not chosen: a second input joined to the number, one boundary. */
	.tj-combo > .unit {
		flex: 0 1 9rem;
		margin-left: -1px;
		text-align: left;
		background: var(--surface-2);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
	}
	.affix {
		display: inline-flex;
		align-items: center;
		padding: 0 var(--space-3);
		margin-left: -1px;
		border: var(--border-control) solid var(--border-strong);
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		background: var(--surface-2);
		color: var(--text-secondary);
		font-weight: 600;
	}
	.tj-picker.one {
		grid-template-columns: minmax(0, 1fr);
	}
	.tj-picker__opt span {
		display: grid;
		gap: 2px;
	}
	/* The file input is invisible, so the label shows where the keyboard is. */
	.tj-picker__opt:focus-within {
		outline: var(--border-focus) solid var(--focus-ring);
		outline-offset: 2px;
	}
	.tj-picker__opt.is-off {
		background: var(--disabled-bg);
		border-color: var(--disabled-border);
		color: var(--disabled-text);
		cursor: not-allowed;
	}
	.tj-picker__opt.is-off :global(.tj-icon),
	.tj-picker__opt.is-off small {
		color: var(--disabled-text);
	}
	.tj-picker__opt.is-off input {
		cursor: not-allowed;
	}
	.files {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.about {
		min-width: 0;
	}
	.fingerprint {
		white-space: nowrap;
	}
</style>
