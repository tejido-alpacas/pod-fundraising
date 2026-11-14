<script lang="ts">
	import {
		EVIDENCE_FILE_FIELD,
		EVIDENCE_NOT_PUBLIC_KIND_FIELD,
		EVIDENCE_NOT_PUBLIC_KIND_MAX,
		EVIDENCE_NOT_PUBLIC_REASON_FIELD,
		EVIDENCE_NOT_PUBLIC_REASON_MAX,
		EVIDENCE_VISIBILITY_FIELD,
		evidenceUploadResponseSchema,
		type EvidenceVisibility,
		MAX_PHOTOS_PER_ENTRY
	} from '@tejido/contracts';
	import { Banner, Button, Icon, shortId } from '@tejido/ui';
	import CopyButton from '#lib/CopyButton.svelte';
	import {
		agentList,
		checkEvidenceFile,
		DOCUMENT_TYPE_NAMES,
		DOCUMENT_TYPES,
		EVIDENCE_MAX_MEGABYTES,
		isPicture,
		PICTURE_TYPE_NAMES,
		PICTURE_TYPES,
		PROBLEM_SENTENCES,
		problemFromStatus,
		type EvidenceProblem
	} from '#lib/evidence.ts';
	import FieldPage from '#lib/FieldPage.svelte';
	import { onMount } from 'svelte';
	import { SvelteMap } from 'svelte/reactivity';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	/**
	 * Where one chosen file is. Each state is set only when the code has reached it:
	 * `waiting` (chosen, another file is being sent first), `uploading` (this request is open),
	 * `done` (POST /api/evidence answered with a URL and a fingerprint), `failed`.
	 */
	type Progress =
		| { status: 'waiting' }
		| { status: 'uploading'; sent: number; total: number | null }
		| {
				status: 'done';
				url: string;
				sha256: string;
				visibility: EvidenceVisibility;
				picture: boolean;
		  }
		| { status: 'failed'; problem: string; retry: boolean };
	type Row = { key: string; name: string; picture: boolean; preview: string | null } & Progress;

	// True once the page's script is running. Until then the form posts to this page's own
	// action and the page reloads with the results; after, each file goes to POST /api/evidence
	// as soon as it is chosen and the rows build up without a reload.
	let enhanced = $state(false);
	let sent = $state<Row[]>([]);
	let copiedAll = $state<'copied' | 'failed' | null>(null);
	let dragging = $state(false);
	let count = 0;
	let sending = false;
	/** The chosen files themselves, kept so a failed one can be sent again. */
	const files = new SvelteMap<string, File>();

	// Who may see the files chosen next. Decided before choosing, because with the script
	// running a file is sent as soon as it is chosen. Each file keeps the choice it was chosen
	// under, however long it waits its turn.
	let keepFromDonors = $state(false);
	let notPublicKind = $state('');
	let notPublicReason = $state('');
	type NotPublic = { kind: string; reason: string };
	const notPublic = new SvelteMap<string, NotPublic>();

	let picker = $state<HTMLFormElement>();

	onMount(() => {
		enhanced = true;
		// A file chosen before the script was ready has had no `change` to start it. Send it now.
		for (const input of picker?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? []) {
			take(input);
		}
	});

	// What the form action answered, when the form was posted without the script.
	const posted = $derived(
		(form?.results ?? []).map((result, index): Row => {
			const base = { key: `posted-${index}`, name: result.name, preview: null };
			return result.ok
				? {
						...base,
						picture: result.picture,
						status: 'done',
						url: result.url,
						sha256: result.sha256,
						visibility: result.visibility
					}
				: { ...base, picture: false, status: 'failed', problem: result.problem, retry: false };
		})
	);
	const rows = $derived([...posted, ...sent]);

	// The same file uploaded twice is stored once, so the second row is left out, and says so.
	const firstBySha256 = $derived.by(() => {
		const first = new SvelteMap<string, Row>();
		for (const row of rows) {
			if (row.status === 'done' && !first.has(row.sha256)) first.set(row.sha256, row);
		}
		return first;
	});
	const uploaded = $derived([...firstBySha256.values()].filter((row) => row.status === 'done'));
	const stillSending = $derived(
		rows.filter((row) => row.status === 'waiting' || row.status === 'uploading').length
	);
	const list = $derived(agentList(uploaded));

	const failed = (problem: EvidenceProblem): Progress => ({
		status: 'failed',
		problem:
			problem === 'network' || problem === 'unexpected'
				? `${PROBLEM_SENTENCES[problem]} The file is still on this phone.`
				: PROBLEM_SENTENCES[problem],
		// Sending the same file again can only help when the file itself was not the problem.
		retry: problem === 'network' || problem === 'unexpected'
	});

	function set(key: string, progress: Progress) {
		const at = sent.findIndex((row) => row.key === key);
		const row = sent[at];
		if (row) {
			sent[at] = { key, name: row.name, picture: row.picture, preview: row.preview, ...progress };
		}
	}

	/** Sends one file and reports the bytes the browser says have left the phone. */
	function post(
		file: File,
		picture: boolean,
		words: NotPublic | undefined,
		onSent: (sent: number, total: number) => void
	) {
		return new Promise<Progress>((resolve) => {
			const body = new FormData();
			body.set(EVIDENCE_FILE_FIELD, file);
			if (words) {
				body.set(EVIDENCE_VISIBILITY_FIELD, 'not_public');
				body.set(EVIDENCE_NOT_PUBLIC_KIND_FIELD, words.kind);
				body.set(EVIDENCE_NOT_PUBLIC_REASON_FIELD, words.reason);
			}

			const request = new XMLHttpRequest();
			request.open('POST', '/api/evidence');
			request.upload.onprogress = (event) => {
				if (event.lengthComputable) onSent(event.loaded, event.total);
			};
			request.onerror = request.onabort = request.ontimeout = () => resolve(failed('network'));
			request.onload = () => {
				if (request.status < 200 || request.status >= 300) {
					resolve(failed(problemFromStatus(request.status)));
					return;
				}
				let answer: unknown;
				try {
					answer = JSON.parse(request.responseText);
				} catch {
					resolve(failed('unexpected'));
					return;
				}
				const parsed = evidenceUploadResponseSchema.safeParse(answer);
				resolve(
					parsed.success ? { status: 'done', ...parsed.data, picture } : failed('unexpected')
				);
			};
			request.send(body);
		});
	}

	/** Sends the waiting files one after another. One loop at a time. */
	async function drain() {
		if (sending) return;
		sending = true;
		for (;;) {
			const next = sent.find((row) => row.status === 'waiting');
			const file = next && files.get(next.key);
			if (!next || !file) break;
			const { key, picture } = next;
			set(key, { status: 'uploading', sent: 0, total: null });
			const ended = await post(file, picture, notPublic.get(key), (bytes, total) =>
				set(key, { status: 'uploading', sent: bytes, total })
			);
			set(key, ended);
			if (ended.status === 'done') {
				files.delete(key);
				notPublic.delete(key);
			}
		}
		sending = false;
	}

	/** Every chosen file gets its row at once; then they are sent one after another. */
	function add(chosen: File[]) {
		for (const file of chosen) {
			const key = `sent-${count++}`;
			const check = checkEvidenceFile(file);
			const picture = isPicture(file.type);
			const base = { key, name: file.name, picture };
			const wordsMissing = notPublicKind.trim() === '' || notPublicReason.trim() === '';
			if (check.ok && keepFromDonors && wordsMissing) {
				// Never sent as public by mistake: without both lines it is not sent at all.
				sent.push({ ...base, preview: null, ...failed('not_public_words') });
			} else if (check.ok) {
				files.set(key, file);
				if (keepFromDonors) notPublic.set(key, { kind: notPublicKind, reason: notPublicReason });
				sent.push({
					...base,
					preview: picture ? URL.createObjectURL(file) : null,
					status: 'waiting'
				});
			} else {
				sent.push({ ...base, preview: null, ...failed(check.problem) });
			}
		}
		void drain();
	}

	function take(input: HTMLInputElement) {
		const chosen = [...(input.files ?? [])];
		input.value = '';
		add(chosen);
	}

	function retry(key: string) {
		if (!files.has(key)) return;
		set(key, { status: 'waiting' });
		void drain();
	}

	function remove(key: string) {
		const at = sent.findIndex((row) => row.key === key);
		const row = sent[at];
		if (!row) return;
		if (row.preview) URL.revokeObjectURL(row.preview);
		files.delete(key);
		notPublic.delete(key);
		sent.splice(at, 1);
	}

	function dropped(event: DragEvent) {
		event.preventDefault();
		dragging = false;
		add([...(event.dataTransfer?.files ?? [])]);
	}

	async function copyAll() {
		try {
			await navigator.clipboard.writeText(list);
			copiedAll = 'copied';
		} catch {
			copiedAll = 'failed';
		}
	}

	const megabytes = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
	const fileCount = (n: number) => (n === 1 ? '1 file' : `${n} files`);
</script>

<svelte:head><title>Add evidence · Tejido</title></svelte:head>

<FieldPage actions={enhanced && uploaded.length > 0 ? actions : undefined}>
	<h1 class="tj-vh">Add photos and documents</h1>

	{#if data.viewer === 'signed_out'}
		<Banner tone="attention" icon="alert-circle" title="Sign in to add evidence">
			You are not signed in, so nothing can be uploaded yet. Open the invitation link you were sent
			and sign in with Qatom from there. Then come back to this page.
			{#snippet actions()}<Button size="field" href="/">Go to the home page</Button>{/snippet}
		</Banner>
	{:else if data.viewer === 'no_party'}
		<Banner tone="attention" icon="alert-circle" title="You’re not on a project yet">
			You are signed in as {data.email}, but not on a project, so nothing can be uploaded yet. Open
			the invitation link you were sent and sign in from there. Then come back to this page.
			{#snippet actions()}<Button size="field" href="/">Go to the home page</Button>{/snippet}
		</Banner>
	{:else}
		<form
			bind:this={picker}
			class="tj-picker"
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			onsubmit={(event) => {
				if (enhanced) event.preventDefault();
			}}
		>
			<label class="tj-picker__opt tj-picker__opt--primary">
				<Icon name="camera" size={28} />
				<span>Take a photo</span>
				<small>Opens the camera</small>
				<input
					type="file"
					name={EVIDENCE_FILE_FIELD}
					accept={PICTURE_TYPES.join(',')}
					capture="environment"
					onchange={(event) => take(event.currentTarget)}
				/>
			</label>
			<label class="tj-picker__opt">
				<Icon name="paperclip" size={28} />
				<span>Choose files</span>
				<small>Photos or {DOCUMENT_TYPE_NAMES}s</small>
				<input
					type="file"
					name={EVIDENCE_FILE_FIELD}
					accept={[...PICTURE_TYPES, ...DOCUMENT_TYPES].join(',')}
					multiple
					onchange={(event) => take(event.currentTarget)}
				/>
			</label>
			{#if enhanced}
				<div
					class={['tj-picker__drop', dragging && 'is-over']}
					role="presentation"
					ondragover={(event) => {
						event.preventDefault();
						dragging = true;
					}}
					ondragleave={() => (dragging = false)}
					ondrop={dropped}
				>
					Or drop files here
				</div>
			{/if}
			<p class="tj-picker__limits">
				Photos ({PICTURE_TYPE_NAMES}) or {DOCUMENT_TYPE_NAMES} documents, up to
				{EVIDENCE_MAX_MEGABYTES} MB each. Up to {MAX_PHOTOS_PER_ENTRY} files per report.
			</p>
			<fieldset class="app-who">
				<legend class="tj-label">Who may see the files you choose next</legend>
				<label class="tj-check">
					<input
						type="checkbox"
						name={EVIDENCE_VISIBILITY_FIELD}
						value="not_public"
						bind:checked={keepFromDonors}
					/>
					<span class="tj-check__text">
						<span>Keep these files from donors</span>
						<small>
							Tick this before you choose a file. A file is sent as soon as you choose it.
						</small>
					</span>
				</label>
				<!-- Without the page's script the two lines cannot appear on a tick, so they are always there. -->
				{#if keepFromDonors || !enhanced}
					<p class="tj-help" id="who-help">
						Left unticked, donors see the files. Tick it for something donors should not see, such
						as a list with pupils’ names. Then only you and this project’s confirmers can open the
						file. Donors are told it exists, with the two lines below, and are not shown it. A file
						kept from donors does not count as the photo or document a milestone report needs.
					</p>
					<div class="tj-field tj-field--field">
						<label class="tj-label" for="np-kind">What it is</label>
						<input
							class="tj-input"
							id="np-kind"
							type="text"
							name={EVIDENCE_NOT_PUBLIC_KIND_FIELD}
							maxlength={EVIDENCE_NOT_PUBLIC_KIND_MAX}
							aria-describedby="np-kind-help"
							bind:value={notPublicKind}
						/>
						<p class="tj-help" id="np-kind-help">
							For example: Class list. Fill this in before choosing the file.
						</p>
					</div>
					<div class="tj-field tj-field--field">
						<label class="tj-label" for="np-reason">Why donors are not shown it</label>
						<input
							class="tj-input"
							id="np-reason"
							type="text"
							name={EVIDENCE_NOT_PUBLIC_REASON_FIELD}
							maxlength={EVIDENCE_NOT_PUBLIC_REASON_MAX}
							aria-describedby="np-reason-help"
							bind:value={notPublicReason}
						/>
						<p class="tj-help" id="np-reason-help">For example: It has pupils’ names on it.</p>
					</div>
					<p class="tj-toolresult tj-tone--attention">
						<Icon name="alert-circle" size={18} />
						<span>
							Donors read both lines. Do not put anyone’s name, or anything else private, in them.
						</span>
					</p>
				{/if}
			</fieldset>
			<!-- Without the page's script nothing starts by itself, so the inputs are shown as the
			     browser draws them and the form gets a button. -->
			<noscript class="app-noscript">
				<style>
					.tj-picker {
						grid-template-columns: minmax(0, 1fr);
					}
					.tj-picker__opt input {
						position: static;
						opacity: 1;
						width: 100%;
						min-width: 0;
						font-size: 14px;
					}
				</style>
				<button type="submit" class="tj-btn tj-btn--primary tj-btn--field tj-btn--block">
					Upload the chosen files
				</button>
			</noscript>
		</form>
	{/if}

	{#if form?.refused}
		<Banner tone="attention" icon="alert-triangle" title="Nothing was uploaded" role="alert">
			{form.refused}
		</Banner>
	{/if}

	{#if rows.length > 0}
		<section class="tj-section" aria-labelledby="files">
			<div class="tj-section__head">
				<h2 class="tj-section__title" id="files">Your files</h2>
				<p class="tj-section__sub">
					{rows.length} chosen · {uploaded.length} uploaded
				</p>
			</div>

			{#if uploaded.length > MAX_PHOTOS_PER_ENTRY}
				<Banner tone="attention" icon="alert-circle" title="More files than one report can carry">
					You have uploaded {uploaded.length} files. One report can carry at most
					{MAX_PHOTOS_PER_ENTRY}, so hand over no more than {MAX_PHOTOS_PER_ENTRY} for each report.
				</Banner>
			{/if}

			<ul class="app-rows">
				{#each rows as row (row.key)}
					{@const first = row.status === 'done' ? firstBySha256.get(row.sha256) : undefined}
					{@const leftOut = first !== undefined && first.key !== row.key}
					<li
						class={[
							'tj-upload',
							row.status === 'waiting' && 'is-queued',
							row.status === 'uploading' && 'is-uploading',
							row.status === 'failed' && 'is-failed',
							row.status === 'done' && (leftOut ? 'is-excluded' : 'is-done')
						]}
					>
						{#if leftOut}
							<span class="tj-upload__thumb"><Icon name="excluded" /></span>
						{:else if row.status === 'failed'}
							<span class="tj-upload__thumb"><Icon name="alert-triangle" /></span>
						{:else if row.status === 'done' && row.visibility === 'not_public'}
							<a class="tj-upload__thumb app-thumblink" href={row.url} aria-label="Open {row.name}">
								<Icon name="eye-off" />
							</a>
						{:else if row.status === 'done' && row.picture}
							<a class="app-thumblink" href={row.url} aria-label="Open {row.name}">
								<img class="tj-upload__thumb" src={row.url} alt="" />
							</a>
						{:else if row.preview}
							<img class="tj-upload__thumb" src={row.preview} alt="" />
						{:else if row.status === 'done'}
							<a class="tj-upload__thumb app-thumblink" href={row.url} aria-label="Open {row.name}">
								<Icon name="file-text" />
							</a>
						{:else}
							<span class="tj-upload__thumb">
								<Icon name={row.picture ? 'image' : 'file-text'} />
							</span>
						{/if}

						<div class="app-rowtext">
							<p class="tj-upload__name">{row.name}</p>
							{#if row.status === 'failed'}
								<p class="tj-upload__meta" role="alert">
									<Icon name="alert-triangle" size={16} />
									<span>{row.problem}</span>
								</p>
							{:else}
								<p class="tj-upload__meta" aria-live="polite">
									{#if leftOut}
										<Icon name="excluded" size={16} />
										<span>Left out: it is the same file as {first.name}, which is uploaded.</span>
									{:else if row.status === 'done'}
										<Icon name="check" size={16} />
										<span>
											{row.visibility === 'not_public'
												? 'Uploaded. Not public: only you and this project’s confirmers can open it.'
												: 'Uploaded. Donors can see it.'}
											Fingerprint <code class="tj-id tj-id--chip">{shortId(row.sha256)}</code>
										</span>
									{:else if row.status === 'uploading'}
										<Icon name="upload" size={16} />
										<span>
											{#if row.total === null}
												Uploading. Keep this page open.
											{:else if row.sent < row.total}
												Uploading · {megabytes(row.sent)} of {megabytes(row.total)} MB
											{:else}
												Sent. Waiting for Tejido to answer.
											{/if}
										</span>
									{:else}
										<Icon name="clock" size={16} />
										<span>Next to send. Keep this page open.</span>
									{/if}
								</p>
							{/if}
						</div>

						{#if leftOut || (row.status === 'failed' && !row.retry)}
							{#if row.key.startsWith('sent-')}
								<button
									type="button"
									class="tj-btn tj-btn--quiet tj-btn--icon"
									aria-label="Remove {row.name} from this list"
									onclick={() => remove(row.key)}
								>
									<Icon name="x" />
								</button>
							{:else}
								<span></span>
							{/if}
						{:else if row.status === 'failed'}
							<Button size="sm" icon="retry" onclick={() => retry(row.key)}>Retry</Button>
						{:else if row.status === 'done' && enhanced}
							<CopyButton text={row.sha256} label="Copy the file fingerprint of {row.name}" />
						{:else}
							<span></span>
						{/if}

						{#if row.status === 'uploading' && row.total !== null}
							{@const percent = Math.min(100, Math.round((row.sent / row.total) * 100))}
							<div
								class="tj-upload__bar"
								role="progressbar"
								aria-label="Uploading {row.name}"
								aria-valuenow={percent}
								aria-valuemin="0"
								aria-valuemax="100"
							>
								<span style:--value="{percent}%"></span>
							</div>
						{/if}
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if uploaded.length > 0}
		<section class="tj-section" aria-labelledby="next">
			<h2 class="tj-section__title" id="next">Hand them to your report</h2>
			<p class="tj-plain">
				<Icon name="info" />
				<span>
					Uploading stores a file. It does not file anything. A file reaches donors only when it is
					attached to a report: copy the {uploaded.length === 1 ? 'file' : 'files'}, open your
					report, and paste. If you have not started a report,
					<a href="/chat">file one now</a>.
				</span>
			</p>

			<details class="tj-card app-technical">
				<summary>
					<Icon name="chevron-down" />
					<span>Technical details</span>
				</summary>
				<div class="app-technical__body">
					{#each uploaded as row (row.key)}
						{#if row.status === 'done'}
							<dl class="tj-dl">
								<div>
									<dt>{row.name}: web address</dt>
									<dd class="app-value">
										<a class="tj-id tj-id--host" href={row.url}>{row.url}</a>
										{#if enhanced}
											<CopyButton text={row.url} label="Copy the web address of {row.name}" />
										{/if}
									</dd>
								</div>
								<div>
									<dt>{row.name}: file fingerprint (SHA-256)</dt>
									<dd class="app-value">
										<code class="tj-id">{row.sha256}</code>
										{#if enhanced}
											<CopyButton
												text={row.sha256}
												label="Copy the file fingerprint of {row.name}"
											/>
										{/if}
									</dd>
								</div>
							</dl>
						{/if}
					{/each}
					<div class="tj-field">
						<label class="tj-label" for="block">
							{uploaded.length === 1 ? 'This file' : `All ${uploaded.length} files`}, as the block a
							report takes
						</label>
						<textarea
							class="tj-textarea app-block"
							id="block"
							readonly
							rows={Math.min(uploaded.length * 4 + 2, 14)}
							value={list}></textarea>
						<p class="tj-help">
							The copy button below copies exactly this. You can also select it and copy it by hand.
						</p>
					</div>
				</div>
			</details>
		</section>
	{/if}
</FieldPage>

{#snippet actions()}
	<Button variant="primary" size="field" block icon="copy" onclick={copyAll}>
		{#if copiedAll === 'copied'}
			Copied. Now paste it into your report
		{:else}
			Copy {fileCount(uploaded.length)} for your report
		{/if}
	</Button>
	<p class="tj-help app-center" role="status">
		{#if copiedAll === 'failed'}
			Copying did not work in this browser. Open Technical details and copy the block by hand.
		{:else if stillSending > 0}
			{fileCount(stillSending)} still sending. {stillSending === 1 ? 'It is' : 'They are'} not included
			until uploaded.
		{:else}
			Nothing is filed until you say so in your report.
		{/if}
	</p>
	{#if copiedAll === 'copied'}
		<Button variant="secondary" size="field" block href="/chat">Go to your report</Button>
	{/if}
{/snippet}

<style>
	.app-center {
		text-align: center;
	}
	.app-who {
		grid-column: 1 / -1;
		display: grid;
		gap: var(--space-3);
		min-width: 0;
		margin: 0;
		padding: var(--space-4);
		background: var(--surface);
		border: var(--border-hair) solid var(--border);
		border-radius: var(--radius-lg);
	}
	.app-who legend {
		float: left;
		width: 100%;
		padding: 0;
	}
	.app-rows {
		display: grid;
		gap: var(--space-3);
	}
	.app-rowtext {
		min-width: 0;
	}
	.app-thumblink {
		display: grid;
		border-radius: var(--radius-md);
	}
	.tj-picker__drop.is-over {
		border-color: var(--accent);
		background: var(--accent-subtle);
	}
	/* The disclosure, drawn as the design's "Technical details": a quiet row that opens. */
	.app-technical {
		padding: 0;
		gap: 0;
	}
	.app-technical > summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--size-touch-field);
		padding: 0 var(--space-4);
		list-style: none;
		cursor: pointer;
		font: 600 14px/20px var(--font-sans);
		color: var(--link);
	}
	.app-technical > summary::-webkit-details-marker {
		display: none;
	}
	.app-technical[open] > summary > :global(.tj-icon) {
		transform: rotate(180deg);
	}
	.app-technical__body {
		display: grid;
		gap: var(--space-4);
		padding: 0 var(--space-4) var(--space-4);
		min-width: 0;
	}
	.app-value {
		display: flex;
		gap: var(--space-2);
		align-items: flex-start;
		justify-content: space-between;
		min-width: 0;
	}
	.app-value > :first-child {
		min-width: 0;
	}
	.app-block {
		font-family: var(--font-mono);
		font-size: 16px;
		line-height: 22px;
		overflow-wrap: anywhere;
	}
</style>
