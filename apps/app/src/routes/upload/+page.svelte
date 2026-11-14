<script lang="ts">
	import {
		EVIDENCE_FILE_FIELD,
		evidenceUploadResponseSchema,
		MAX_PHOTOS_PER_ENTRY
	} from '@tejido/contracts';
	import {
		agentEntry,
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
	import { onMount } from 'svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	type Ended =
		| { status: 'done'; url: string; sha256: string; picture: boolean }
		| { status: 'failed'; problem: string };
	type Row = { key: string; name: string } & (Ended | { status: 'uploading' });

	// True once the page's script is running. Until then the form posts to this page's own
	// action and the page reloads with the results; after, each file goes to POST /api/evidence
	// as soon as it is chosen and the results build up without a reload.
	let enhanced = $state(false);
	let sent = $state<Row[]>([]);
	let copied = $state<string | null>(null);
	let copyFailed = $state(false);
	let count = 0;

	let picker = $state<HTMLFormElement>();

	onMount(() => {
		enhanced = true;
		// A file chosen before the script was ready has had no `change` to start it. Send it now.
		for (const input of picker?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? []) {
			void send(input);
		}
	});

	// What the form action answered, when the form was posted without the script.
	const posted = $derived(
		(form?.results ?? []).map((result, index): Row =>
			result.ok
				? { key: `posted-${index}`, status: 'done', ...result }
				: { key: `posted-${index}`, status: 'failed', ...result }
		)
	);
	const rows = $derived([...posted, ...sent]);
	const done = $derived(rows.filter((row) => row.status === 'done'));
	const list = $derived(agentList(done));
	const distinct = $derived(new Set(done.map((row) => row.sha256)).size);

	const failed = (problem: EvidenceProblem): Ended => ({
		status: 'failed',
		problem: PROBLEM_SENTENCES[problem]
	});

	async function post(file: File, picture: boolean): Promise<Ended> {
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
		return parsed.success ? { status: 'done', ...parsed.data, picture } : failed('unexpected');
	}

	function chosen(event: Event & { currentTarget: HTMLInputElement }) {
		void send(event.currentTarget);
	}

	async function send(input: HTMLInputElement) {
		const files = [...(input.files ?? [])];
		input.value = '';

		// Every chosen file gets its row at once; then they are sent one after another.
		const waiting: { key: string; file: File; picture: boolean }[] = [];
		for (const file of files) {
			const key = `sent-${count++}`;
			const check = checkEvidenceFile(file);
			if (check.ok) {
				sent.push({ key, name: file.name, status: 'uploading' });
				waiting.push({ key, file, picture: isPicture(check.type) });
			} else {
				sent.push({ key, name: file.name, ...failed(check.problem) });
			}
		}
		for (const { key, file, picture } of waiting) {
			const ended = await post(file, picture);
			const at = sent.findIndex((row) => row.key === key);
			if (at !== -1) sent[at] = { key, name: file.name, ...ended };
		}
	}

	async function copy(what: string, text: string) {
		try {
			await navigator.clipboard.writeText(text);
			copied = what;
			copyFailed = false;
		} catch {
			copied = null;
			copyFailed = true;
		}
	}
</script>

<svelte:head><title>Upload evidence · Tejido</title></svelte:head>

{#snippet copyButton(what: string, text: string)}
	{#if enhanced}
		<button type="button" class="copy" onclick={() => copy(what, text)}>
			{copied === what ? 'Copied' : 'Copy'}
		</button>
	{/if}
{/snippet}

<article>
	<p class="eyebrow">Evidence</p>
	<h1>Upload photos and documents</h1>
	<p class="lede">
		Upload the photos or documents that show your work. For each one you get a web address and a
		fingerprint (its SHA-256). Give both to your agent, and it attaches them to your report.
	</p>

	{#if data.viewer === 'signed_out'}
		<p class="note">
			You are not signed in, so you cannot upload yet. Open the invite link you were sent and sign
			in with Qatom from there. Then come back to this page.
		</p>
		<p><a class="way" href="/">Go to the home page</a></p>
	{:else if data.viewer === 'no_party'}
		<p class="note">
			You are signed in as {data.email}, but not on a campaign, so you cannot upload yet. Open the
			invite link you were sent and sign in from there. Then come back to this page.
		</p>
		<p><a class="way" href="/">Go to the home page</a></p>
	{:else}
		<form
			bind:this={picker}
			method="POST"
			action="?/upload"
			enctype="multipart/form-data"
			onsubmit={(event) => event.preventDefault()}
		>
			<label>
				<span>Take a photo</span>
				<small>On a phone this opens the camera.</small>
				<input
					type="file"
					name={EVIDENCE_FILE_FIELD}
					accept={PICTURE_TYPES.join(',')}
					capture="environment"
					onchange={chosen}
				/>
			</label>
			<label>
				<span>Choose photos</span>
				<small>Pictures you already have: {PICTURE_TYPE_NAMES}. You can pick several.</small>
				<input
					type="file"
					name={EVIDENCE_FILE_FIELD}
					accept={PICTURE_TYPES.join(',')}
					multiple
					onchange={chosen}
				/>
			</label>
			<label>
				<span>Choose documents</span>
				<small>A receipt or a letter, as {DOCUMENT_TYPE_NAMES}. You can pick several.</small>
				<input
					type="file"
					name={EVIDENCE_FILE_FIELD}
					accept={DOCUMENT_TYPES.join(',')}
					multiple
					onchange={chosen}
				/>
			</label>
			<p class="limits">
				Each file can be at most {EVIDENCE_MAX_MEGABYTES} MB. One report can carry at most
				{MAX_PHOTOS_PER_ENTRY} files.
			</p>
			{#if enhanced}
				<p class="limits">Uploading starts as soon as you choose a file.</p>
			{:else}
				<button type="submit" class="button">Upload</button>
			{/if}
		</form>
	{/if}

	{#if form?.refused}
		<p class="problem" role="alert">{form.refused}</p>
	{/if}

	<div aria-live="polite">
		{#if rows.length > 0}
			<h2>Your files</h2>
			{#if distinct > MAX_PHOTOS_PER_ENTRY}
				<p class="problem">
					You have uploaded {distinct} files. One report can carry at most {MAX_PHOTOS_PER_ENTRY},
					so give your agent no more than {MAX_PHOTOS_PER_ENTRY} of them for each report.
				</p>
			{/if}
			{#if copyFailed}
				<p class="problem" role="alert">
					Copying did not work in this browser. Select the text and copy it by hand.
				</p>
			{/if}
			<ul>
				{#each rows as row (row.key)}
					<li class="file">
						<h3>{row.name}</h3>
						{#if row.status === 'uploading'}
							<p class="note">Uploading…</p>
						{:else if row.status === 'failed'}
							<p class="problem" role="alert">{row.problem}</p>
						{:else}
							{@const entry = agentEntry(row)}
							<div class="stored">
								{#if row.picture}
									<a class="preview" href={row.url}>
										<img src={row.url} alt="Preview of {row.name}" />
									</a>
								{:else}
									<a class="preview document" href={row.url}>
										<strong>{DOCUMENT_TYPE_NAMES}</strong>
										<span>Document. Open it to check.</span>
									</a>
								{/if}
								<div class="values">
									<p class="ok">Uploaded.</p>
									<label>
										<span>Web address (URL)</span>
										<span class="value">
											<input type="text" readonly value={row.url} />
											{@render copyButton(`${row.key}-url`, row.url)}
										</span>
									</label>
									<label>
										<span>Fingerprint (SHA-256)</span>
										<span class="value">
											<input type="text" readonly value={row.sha256} />
											{@render copyButton(`${row.key}-sha256`, row.sha256)}
										</span>
									</label>
									<label>
										<span>For your agent: copy this whole block and paste it in</span>
										<span class="value">
											<textarea readonly rows="4" value={entry}></textarea>
											{@render copyButton(`${row.key}-entry`, entry)}
										</span>
									</label>
								</div>
							</div>
						{/if}
					</li>
				{/each}
			</ul>

			<p class="next">
				Next, give these to your agent. If your report is open in another tab, go back to it and
				paste the block there. If you have not started one,
				<a href="/chat">file a report</a>.
			</p>

			{#if distinct > 1}
				<section class="all">
					<h2>All {distinct} files, for your agent</h2>
					<p>
						Copy this whole block and paste it to your agent. It is the list of everything on this
						page that uploaded, ready to attach to a report.
					</p>
					<span class="value">
						<textarea readonly rows={Math.min(distinct * 4 + 2, 16)} value={list}></textarea>
						{@render copyButton('all', list)}
					</span>
				</section>
			{/if}
		{/if}
	</div>
</article>

<style>
	article {
		max-width: 44rem;
	}
	.lede {
		color: var(--muted);
	}
	.way {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.next {
		color: var(--muted);
	}
	.note {
		border-left: 3px solid var(--line);
		padding-left: 0.75rem;
		color: var(--muted);
	}
	.problem {
		border-left: 3px solid var(--warn);
		padding-left: 0.75rem;
		color: var(--warn);
	}
	.ok {
		margin: 0;
		font-weight: 600;
		color: var(--a);
	}
	form,
	.file,
	.all {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 1rem 1.25rem;
	}
	form {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 1rem;
		margin: 1.5rem 0;
	}
	label {
		display: grid;
		grid-template-columns: minmax(0, 1fr);
		gap: 0.2rem;
	}
	label > span:first-child {
		font-weight: 600;
	}
	.values label > span:first-child {
		font-weight: 400;
		font-size: 0.9rem;
		color: var(--muted);
	}
	small,
	.limits {
		margin: 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
	input[type='file'] {
		font: inherit;
		max-width: 100%;
	}
	.button {
		justify-self: start;
		font: inherit;
		font-weight: 600;
		color: var(--surface);
		background: var(--a);
		border: 0;
		border-radius: 6px;
		padding: 0.6rem 1.1rem;
		cursor: pointer;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 1rem 0 0;
		display: grid;
		gap: 0.9rem;
	}
	h3 {
		margin: 0 0 0.5rem;
		font-size: 1rem;
		overflow-wrap: anywhere;
	}
	.file p {
		margin-bottom: 0;
	}
	.stored {
		display: grid;
		grid-template-columns: 9rem 1fr;
		gap: 1rem;
		align-items: start;
	}
	.preview {
		display: block;
		border: 1px solid var(--line);
		border-radius: 6px;
		overflow: hidden;
		background: var(--bg);
	}
	.preview img {
		display: block;
		width: 100%;
		height: 9rem;
		object-fit: cover;
	}
	.document {
		display: grid;
		gap: 0.25rem;
		place-content: center;
		text-align: center;
		min-height: 9rem;
		padding: 0.5rem;
		text-decoration: none;
		font-size: 0.85rem;
		color: var(--muted);
	}
	.document strong {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 1.4rem;
		color: var(--c);
	}
	.values {
		display: grid;
		gap: 0.7rem;
		min-width: 0;
	}
	.value {
		display: flex;
		gap: 0.5rem;
		align-items: start;
	}
	.value input,
	.value textarea {
		flex: 1;
		min-width: 0;
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.85rem;
		color: var(--ink);
		background: var(--bg);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
	}
	.value textarea {
		resize: vertical;
	}
	.copy {
		font: inherit;
		font-weight: 600;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.35rem 0.8rem;
		min-width: 4.75rem;
		cursor: pointer;
	}
	.all {
		margin-top: 1.5rem;
	}
	.all h2 {
		margin-top: 0;
	}
	@media (max-width: 32rem) {
		.stored {
			grid-template-columns: 1fr;
		}
	}
</style>
