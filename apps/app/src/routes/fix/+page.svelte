<script lang="ts">
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { EVIDENCE_FILE_FIELD, MAX_PHOTOS_PER_ENTRY } from '@tejido/contracts';
	import { Banner, Button, Icon, StatusBadge } from '@tejido/ui';
	import { shortDate } from '#lib/dates.ts';
	import {
		checkEvidenceFile,
		DOCUMENT_TYPE_NAMES,
		DOCUMENT_TYPES,
		EVIDENCE_MAX_MEGABYTES,
		isPicture,
		PICTURE_TYPE_NAMES,
		PICTURE_TYPES,
		PROBLEM_SENTENCES
	} from '#lib/evidence.ts';
	import FieldPage from '#lib/FieldPage.svelte';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const REPORTS = {
		work_log: { name: 'work log', title: 'Work log', finish: 'this work log' },
		claim: {
			name: 'report that the milestone is done',
			title: 'Milestone reported as done',
			finish: 'your milestone report'
		},
		confirmation: { name: 'confirmation', title: 'Confirmation', finish: 'this confirmation' }
	} as const;

	/** Read to screen readers before the badge. Its trailing space must survive. */
	const DEPOSIT_LAYER = 'Deposit: ';

	const fileCount = (count: number) => (count === 1 ? '1 file' : `${count} files`);

	// One report at a time. With one incomplete report it is that one; with several, the person
	// picks, and the address remembers which.
	const selected = $derived.by(() => {
		const asked = page.url.searchParams.get('entry') ?? form?.entryId ?? null;
		const found = data.entries.find((entry) => entry.id === asked);
		return found ?? (data.entries.length === 1 ? data.entries[0] : undefined);
	});

	let saving = $state(false);
	/** The files chosen and not yet saved, with what is wrong with each, if anything. */
	let chosen = $state<{ name: string; problem: string | null }[]>([]);
	let fields = $state<HTMLFormElement>();

	function readChosen() {
		const inputs = fields?.querySelectorAll<HTMLInputElement>('input[type="file"]') ?? [];
		chosen = [...inputs].flatMap((input) =>
			[...(input.files ?? [])].map((file) => {
				const check = checkEvidenceFile(file);
				if (!check.ok) return { name: file.name, problem: PROBLEM_SENTENCES[check.problem] };
				if (selected?.documentsOnly && isPicture(file.type)) {
					return {
						name: file.name,
						problem: `This milestone takes documents only (${DOCUMENT_TYPE_NAMES}). A photo cannot be added to it.`
					};
				}
				return { name: file.name, problem: null };
			})
		);
	}

	const refusedHere = $derived(
		form?.refused && selected && form.entryId === selected.id ? form : null
	);
	const hasError = $derived(refusedHere !== null || chosen.some((file) => file.problem !== null));
</script>

<svelte:head><title>Fix an incomplete report · Tejido</title></svelte:head>

{#snippet result()}
	{#if form?.done}
		{@const done = form.done}
		{#if done.complete}
			<Banner
				tone="record"
				icon="check"
				title="Saved. Your report on “{done.milestoneTitle}” is no longer incomplete."
				role="status"
			>
				{fileCount(done.added)} added to the same report. Donors will see {done.added === 1
					? 'it'
					: 'them'} there. No new deposit was paid.
			</Banner>
		{:else}
			<Banner
				tone="attention"
				icon="receipt-missing"
				title="Saved, but your report on “{done.milestoneTitle}” is still incomplete."
				role="status"
			>
				{fileCount(done.added)} added and kept. No new deposit was paid.
				{#if done.stillMissing}Still missing: {done.stillMissing}{/if}
			</Banner>
		{/if}
	{/if}
	{#if form?.refused && form.entryId === null}
		<Banner tone="attention" icon="alert-triangle" title="Nothing was changed" role="alert">
			{form.refused}
		</Banner>
	{/if}
{/snippet}

{#if data.viewer !== 'party'}
	<FieldPage>
		<p class="text-eyebrow">Incomplete reports</p>
		<h1>Fix an incomplete report</h1>
		{@render result()}
		{#if data.viewer === 'signed_out'}
			<Banner tone="attention" icon="alert-circle" title="Sign in to see your reports">
				You are not signed in, so your reports cannot be shown. Open the invitation link you were
				sent and sign in with Qatom from there. Then come back to this page.
				{#snippet actions()}<Button size="field" href="/">Go to the home page</Button>{/snippet}
			</Banner>
		{:else}
			<Banner tone="attention" icon="alert-circle" title="You’re not on a project yet">
				You are signed in as {data.email}, but not on a project, so there are no reports to show.
				Open the invitation link you were sent and sign in from there.
				{#snippet actions()}<Button size="field" href="/">Go to the home page</Button>{/snippet}
			</Banner>
		{/if}
	</FieldPage>
{:else if !selected}
	<FieldPage actions={data.entries.length === 0 ? back : undefined}>
		<p class="text-eyebrow">Incomplete reports</p>
		{#if data.entries.length === 0}
			<h1>Nothing to fix</h1>
			{@render result()}
			<p class="tj-fieldpage__lede">
				None of your reports is incomplete. When one arrives with something missing, it is saved,
				marked incomplete, and listed here so you can add to it without paying again.
			</p>
		{:else}
			<h1>Choose the report to fix</h1>
			{@render result()}
			<p class="tj-fieldpage__lede">
				{data.entries.length} of your reports arrived with something missing. Each was saved and its deposit
				recorded. Fix them one at a time. You won’t pay again.
			</p>
			<ul class="app-choices">
				{#each data.entries as entry (entry.id)}
					<li>
						<a class="app-choice" href="?entry={entry.id}">
							<Icon name="receipt-missing" size={24} />
							<span class="app-choice__text">
								<strong>{entry.milestoneTitle}</strong>
								<span>{REPORTS[entry.report].title} · filed {shortDate(entry.filedAt)}</span>
								<span class="app-choice__missing">
									{entry.missing ?? 'The reason was not recorded.'}
								</span>
							</span>
							<Icon name="chevron-right" />
						</a>
					</li>
				{/each}
			</ul>
		{/if}
	</FieldPage>
{:else}
	{@const entry = selected}
	{@const report = REPORTS[entry.report]}
	<FieldPage actions={entry.room > 0 ? save : back}>
		{#if data.entries.length > 1}
			<a class="tj-link tj-link--standalone" href="/fix">
				<Icon name="arrow-left" size={18} /> All {data.entries.length} incomplete reports
			</a>
		{/if}
		<div class="tj-badges">
			<StatusBadge state="incomplete" />
			<span class="tj-badge tj-tone--neutral">
				<Icon name="deposit" size={16} />
				<span><span class="tj-vh">{DEPOSIT_LAYER}</span>Deposit recorded</span>
			</span>
		</div>
		<h1>Add what is missing to finish {report.finish}</h1>
		<p class="tj-fieldpage__lede">
			Your {report.name} on “{entry.milestoneTitle}” was saved on {shortDate(entry.filedAt)}, but
			something it needs is missing. Add it here. You won’t pay the deposit again.
		</p>

		{@render result()}

		<div class="tj-card">
			<p class="text-eyebrow">Already saved</p>
			<ul class="tj-checklist">
				<li class="is-done">
					<Icon name="check" />
					<span class="app-wrap">Summary: “{entry.summary}”</span>
				</li>
				<li class="is-done">
					<Icon name="check" />
					<span>
						{#if entry.attached === 0}
							No files attached yet
						{:else}
							{fileCount(entry.attached)} attached. {entry.attached === 1
								? 'It stays'
								: 'They stay'}
							as {entry.attached === 1 ? 'it is' : 'they are'}.
						{/if}
					</span>
				</li>
				{#each entry.notPublic as file, index (index)}
					<li class="is-done">
						<Icon name="eye-off" />
						<span class="app-wrap">
							Not public: {file.kind}. {file.reason} Donors are told it exists and are not shown it, so
							it does not count as the photo or document this report needs.
						</span>
					</li>
				{/each}
				<li class="is-done">
					<Icon name="check" />
					<span>
						Deposit paid when you filed on {shortDate(entry.filedAt)}. It is recorded and will not
						be taken again.
					</span>
				</li>
				<li class="is-missing">
					<Icon name="alert-circle" />
					<span>{entry.missing ?? 'Something this milestone needs'}</span>
				</li>
			</ul>
		</div>

		{#if entry.room <= 0}
			<Banner tone="neutral" icon="info" title="This report cannot take more files">
				It already carries {MAX_PHOTOS_PER_ENTRY} files, the most a report can have.
			</Banner>
		{:else}
			<form
				id="fix"
				bind:this={fields}
				class="app-form"
				method="POST"
				action="?/attach"
				enctype="multipart/form-data"
				use:enhance={() => {
					saving = true;
					return async ({ update }) => {
						await update();
						saving = false;
						chosen = [];
					};
				}}
			>
				<input type="hidden" name="entry" value={entry.id} />
				<div class="tj-field tj-field--field">
					<p class="tj-label" id="files-label">
						{entry.documentsOnly ? 'Add documents' : 'Add photos or documents'}
					</p>
					<div class="tj-picker" role="group" aria-labelledby="files-label">
						{#if !entry.documentsOnly}
							<label class="tj-picker__opt tj-picker__opt--primary">
								<Icon name="camera" size={28} />
								<span>Take a photo</span>
								<small>Opens the camera</small>
								<input
									type="file"
									name={EVIDENCE_FILE_FIELD}
									accept={PICTURE_TYPES.join(',')}
									capture="environment"
									aria-describedby="files-limits{hasError ? ' files-error' : ''}"
									onchange={readChosen}
								/>
							</label>
						{/if}
						<label class={['tj-picker__opt', entry.documentsOnly && 'app-picker__wide']}>
							<Icon name="paperclip" size={28} />
							<span>Choose files</span>
							<small>
								{entry.documentsOnly
									? `${DOCUMENT_TYPE_NAMES} documents`
									: `Photos or ${DOCUMENT_TYPE_NAMES}s`}
							</small>
							<input
								type="file"
								name={EVIDENCE_FILE_FIELD}
								accept={(entry.documentsOnly
									? DOCUMENT_TYPES
									: [...PICTURE_TYPES, ...DOCUMENT_TYPES]
								).join(',')}
								multiple
								aria-describedby="files-limits{hasError ? ' files-error' : ''}"
								aria-invalid={hasError ? 'true' : undefined}
								onchange={readChosen}
							/>
						</label>
						<p class="tj-picker__limits" id="files-limits">
							{#if entry.documentsOnly}
								This milestone takes documents only ({DOCUMENT_TYPE_NAMES}), no photos.
							{:else}
								Photos ({PICTURE_TYPE_NAMES}) or {DOCUMENT_TYPE_NAMES} documents.
							{/if}
							Up to {EVIDENCE_MAX_MEGABYTES} MB each. This report can take {fileCount(entry.room)} more.
						</p>
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
						</noscript>
					</div>

					{#if chosen.length > 0}
						<ul class="app-chosen" aria-label="Chosen, not saved yet">
							{#each chosen as file, index (index)}
								<li class={{ 'is-wrong': file.problem !== null }}>
									<Icon name={file.problem ? 'alert-triangle' : 'paperclip'} size={18} />
									<span>
										<strong>{file.name}</strong>
										{file.problem ?? 'Chosen. Not saved yet.'}
									</span>
								</li>
							{/each}
						</ul>
					{/if}

					{#if refusedHere}
						<div class="tj-error" id="files-error" role="alert">
							<Icon name="alert-circle" size={18} />
							<div>
								<p>{refusedHere.refused}</p>
								{#if refusedHere.problems?.length}
									<ul class="app-problems">
										{#each refusedHere.problems as problem (problem)}<li>{problem}</li>{/each}
									</ul>
								{/if}
							</div>
						</div>
					{:else if hasError}
						<p class="tj-error" id="files-error">
							<Icon name="alert-circle" size={18} />
							A chosen file cannot be used. Choose again before you save.
						</p>
					{/if}
				</div>

				<details class="app-pasted">
					<summary>
						<Icon name="chevron-down" />
						<span>Already uploaded the files?</span>
					</summary>
					<div class="tj-field">
						<label class="tj-label" for="uploaded">Paste the block from the evidence page</label>
						<textarea class="tj-textarea app-block" id="uploaded" name="uploaded" rows="4"
						></textarea>
						<p class="tj-help">
							The block the <a href="/upload">evidence page</a> copies for your report, exactly as copied.
						</p>
					</div>
				</details>
			</form>
		{/if}

		<p class="tj-plain">
			<Icon name="info" />
			<span>
				Saving updates the same report. It doesn’t create a new filing, no deposit is paid, and
				donors will see the files you add.
			</span>
		</p>
		<p class="tj-help">
			Only photos and documents can be added here. If something else is missing, such as a quantity
			or an amount, it cannot be added on this page.
		</p>
	</FieldPage>
{/if}

{#snippet save()}
	<Button variant="primary" size="field" block type="submit" form="fix" busy={saving}>
		{saving ? 'Saving…' : 'Save to this report'}
	</Button>
{/snippet}

{#snippet back()}
	<Button variant="primary" size="field" block href="/">Back to your project</Button>
{/snippet}

<style>
	.app-wrap {
		overflow-wrap: anywhere;
	}
	.app-form {
		display: grid;
		gap: var(--space-4);
		min-width: 0;
	}
	.app-picker__wide {
		grid-column: 1 / -1;
	}
	.app-chosen {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-2);
	}
	.app-chosen li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-2);
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
		overflow-wrap: anywhere;
	}
	.app-chosen strong {
		display: block;
		color: var(--text-primary);
	}
	.app-chosen li.is-wrong {
		color: var(--status-critical-text);
		font-weight: 600;
	}
	.app-problems {
		list-style: disc;
		margin-top: var(--space-1);
		padding-left: var(--space-5);
		overflow-wrap: anywhere;
	}
	.app-pasted > summary {
		display: flex;
		align-items: center;
		gap: var(--space-2);
		min-height: var(--size-touch-field);
		list-style: none;
		cursor: pointer;
		font: 600 14px/20px var(--font-sans);
		color: var(--link);
	}
	.app-pasted > summary::-webkit-details-marker {
		display: none;
	}
	.app-pasted[open] > summary > :global(.tj-icon) {
		transform: rotate(180deg);
	}
	.app-block {
		font-family: var(--font-mono);
	}
	.app-choices {
		display: grid;
		gap: var(--space-3);
	}
	.app-choice {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: center;
		min-height: 72px;
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		color: var(--text-primary);
		border: var(--border-control) solid var(--border-strong);
		border-radius: var(--radius-lg);
		text-decoration: none;
	}
	.app-choice:hover {
		background-image: linear-gradient(var(--state-hover), var(--state-hover));
	}
	.app-choice > :global(.tj-icon:first-child) {
		color: var(--status-attention-icon);
	}
	.app-choice > :global(.tj-icon:last-child) {
		color: var(--text-muted);
	}
	.app-choice__text {
		display: grid;
		gap: 2px;
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
	}
	.app-choice__text strong {
		font: 600 17px/24px var(--font-sans);
		color: var(--text-primary);
	}
	.app-choice__missing {
		color: var(--status-attention-text);
		font-weight: 600;
	}
</style>
