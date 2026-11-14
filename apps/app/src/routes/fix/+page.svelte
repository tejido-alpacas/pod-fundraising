<script lang="ts">
	import { EVIDENCE_FILE_FIELD, MAX_PHOTOS_PER_ENTRY } from '@tejido/contracts';
	import {
		DOCUMENT_TYPE_NAMES,
		DOCUMENT_TYPES,
		EVIDENCE_MAX_MEGABYTES,
		PICTURE_TYPE_NAMES,
		PICTURE_TYPES
	} from '#lib/evidence.ts';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const REPORTS = {
		work_log: 'Work log',
		claim: 'Milestone claim',
		confirmation: 'Confirmation'
	} as const;

	const day = (timestamp: string) =>
		new Date(timestamp).toLocaleDateString('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		});
	const files = (count: number) => (count === 1 ? '1 file' : `${count} files`);
</script>

<svelte:head><title>Fix an incomplete report · Tejido App</title></svelte:head>

<article>
	<p class="eyebrow">Incomplete reports</p>
	<h1>Add what is missing</h1>
	<p class="lede">
		A report that arrived with something missing was saved and marked incomplete. Here you can add
		the missing photos or documents to it. You do not pay again: nothing is bought, and no deposit
		is taken.
	</p>

	{#if form?.done}
		{@const done = form.done}
		<div class="ok" role="status">
			{#if done.complete}
				<p>
					<strong>Your report on “{done.milestoneTitle}” is now complete.</strong>
					{files(done.added)} added. You did not pay again.
				</p>
			{:else}
				<p>
					<strong>{files(done.added)} added to your report on “{done.milestoneTitle}”.</strong>
					It is still incomplete. You did not pay again.
				</p>
				{#if done.stillMissing}<p>Still missing: {done.stillMissing}</p>{/if}
			{/if}
		</div>
	{/if}
	{#if form?.refused && form.entryId === null}
		<p class="problem" role="alert">{form.refused}</p>
	{/if}

	{#if data.viewer === 'signed_out'}
		<p class="note">
			You are not signed in, so your reports cannot be shown. Open the invite link you were sent and
			sign in with Qatom from there. Then come back to this page.
		</p>
	{:else if data.viewer === 'no_party'}
		<p class="note">
			You are signed in as {data.email}, but not on a campaign, so there are no reports to show.
			Open the invite link you were sent and sign in from there. Then come back to this page.
		</p>
	{:else if data.entries.length === 0}
		<p class="note">None of your reports is incomplete. There is nothing to add.</p>
	{:else}
		<ul>
			{#each data.entries as entry (entry.id)}
				<li>
					<p class="eyebrow">{REPORTS[entry.report]} · filed {day(entry.filedAt)}</p>
					<h2>{entry.milestoneTitle}</h2>
					<p class="summary">{entry.summary}</p>
					<dl>
						<dt>What is missing</dt>
						<dd class="missing">{entry.missing ?? 'The reason was not recorded.'}</dd>
						<dt>Attached so far</dt>
						<dd>{files(entry.attached)}. They stay as they are.</dd>
					</dl>

					{#if form?.refused && form.entryId === entry.id}
						<div class="problem" role="alert">
							<p>{form.refused}</p>
							{#if form.problems?.length}
								<ul class="problems">
									{#each form.problems as problem (problem)}<li>{problem}</li>{/each}
								</ul>
							{/if}
						</div>
					{/if}

					{#if entry.room <= 0}
						<p class="note">
							This report already carries {MAX_PHOTOS_PER_ENTRY} files, the most a report can have, so
							no more can be added.
						</p>
					{:else}
						<form method="POST" action="?/attach" enctype="multipart/form-data">
							<input type="hidden" name="entry" value={entry.id} />
							{#if entry.documentsOnly}
								<p class="limits">
									This milestone takes documents only ({DOCUMENT_TYPE_NAMES}). Photos cannot be
									added to it.
								</p>
							{:else}
								<label>
									<span>Add photos</span>
									<small>{PICTURE_TYPE_NAMES}. You can pick several.</small>
									<input
										type="file"
										name={EVIDENCE_FILE_FIELD}
										accept={PICTURE_TYPES.join(',')}
										multiple
									/>
								</label>
							{/if}
							<label>
								<span>Add documents</span>
								<small>A receipt or a letter, as {DOCUMENT_TYPE_NAMES}. You can pick several.</small
								>
								<input
									type="file"
									name={EVIDENCE_FILE_FIELD}
									accept={DOCUMENT_TYPES.join(',')}
									multiple
								/>
							</label>
							<details>
								<summary>Already uploaded the files?</summary>
								<label>
									<span>Paste the block from the <a href="/upload">upload page</a></span>
									<small>The block it gives you “for your agent”, exactly as copied.</small>
									<textarea name="uploaded" rows="4"></textarea>
								</label>
							</details>
							<p class="limits">
								Each file can be at most {EVIDENCE_MAX_MEGABYTES} MB. This report can take
								{files(entry.room)} more.
							</p>
							<button type="submit" class="button">Add to this report</button>
						</form>
					{/if}
					<p class="limits">
						Only photos and documents can be added here. If something else is missing, such as a
						quantity or an amount, it cannot be added on this page.
					</p>
				</li>
			{/each}
		</ul>
	{/if}
</article>

<style>
	article {
		max-width: 44rem;
	}
	.lede,
	.summary {
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
	.problem p {
		margin: 0;
	}
	.problems {
		list-style: disc;
		display: block;
		margin: 0.4rem 0 0;
		padding-left: 1.25rem;
		overflow-wrap: anywhere;
	}
	.problems li {
		background: none;
		border: 0;
		padding: 0;
	}
	.ok {
		border-left: 3px solid var(--a);
		padding-left: 0.75rem;
		color: var(--a);
	}
	.ok p {
		margin: 0.2rem 0;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 1.5rem 0 0;
		display: grid;
		gap: 1rem;
	}
	li,
	form {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 1rem 1.25rem;
	}
	li h2 {
		margin: 0.2rem 0 0.4rem;
	}
	.summary {
		margin: 0;
	}
	dl {
		display: grid;
		gap: 0.2rem;
		margin: 0.9rem 0;
	}
	dt {
		font-size: 0.9rem;
		color: var(--muted);
	}
	dd {
		margin: 0 0 0.5rem;
	}
	.missing {
		font-weight: 600;
		color: var(--warn);
	}
	form {
		display: grid;
		gap: 1rem;
		margin: 1rem 0 0.75rem;
		background: var(--bg);
	}
	label {
		display: grid;
		gap: 0.2rem;
	}
	label > span:first-child,
	summary {
		font-weight: 600;
	}
	summary {
		cursor: pointer;
	}
	details label {
		margin-top: 0.6rem;
	}
	details label > span:first-child {
		font-weight: 400;
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
	textarea {
		font-family: ui-monospace, 'SF Mono', Menlo, monospace;
		font-size: 0.85rem;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
		resize: vertical;
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
</style>
