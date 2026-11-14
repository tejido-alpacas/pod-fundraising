<!--
  TimelineEntry: one filed entry woven onto the timeline thread, as a donor sees it. The node
  and the first badge show the FILING state (receipt shapes). A claim or a confirmation adds
  the milestone's badge, and a confirmation says how the confirmer relates to the project.
  Every card ends with its deposit state and a route to the proof.

  It is given the view the server built for donors, never a stored entry: a stored entry
  carries the filer's private filing code and files that have not been checked.

  Use inside <div class="tj-timeline">.
  <TimelineEntry {entry} />
-->
<script lang="ts">
	import { Icon, STATES, StatusBadge, filingState } from '@tejido/ui';
	import type { TimelineEntry } from '../../routes/(campaign-site)/campaigns/[campaignId]/+page.server.ts';
	import ConfirmationStrength from './ConfirmationStrength.svelte';
	import { utcTime } from './dates.ts';
	import { CLAIM_LABEL, WORK_STATUS_LABEL } from './labels.ts';

	let { entry }: { entry: TimelineEntry } = $props();

	const state = $derived(filingState(entry));
	const def = $derived(STATES[state]);
	const variant = $derived(
		state === 'flagged' ? 'flagged' : state === 'incomplete' ? 'incomplete' : null
	);

	const milestoneName = $derived(entry.milestoneTitle ?? entry.milestoneId);

	/** A title is at most this long. A longer first sentence stays in the account. */
	const TITLE_LENGTH = 90;

	/**
	 * A work log's title is the first sentence of the filer's own account, and the account
	 * carries on underneath. A claim or a confirmation is titled by what it did.
	 */
	const text = $derived.by(() => {
		if (entry.kind === 'confirmation') {
			return {
				title:
					entry.milestoneBadge === 'confirmed'
						? `${milestoneName} confirmed`
						: `Confirmation filed for ${milestoneName}`,
				account: entry.summary
			};
		}
		if (entry.kind === 'claim') {
			const said = entry.claim ? CLAIM_LABEL[entry.claim] : 'done';
			return { title: `${milestoneName}: reported as ${said}`, account: entry.summary };
		}
		const [first, ...rest] = entry.summary.split(/(?<=[.!?])\s+/);
		if (first === undefined || first.length > TITLE_LENGTH) {
			return { title: `Work log on ${milestoneName}`, account: entry.summary };
		}
		return { title: first.replace(/\.$/, ''), account: rest.join(' ') };
	});

	/** "Coral Ridge Builders, contractor". Only the first letter of the role is lowered. */
	const filer = $derived.by(() => {
		if (!entry.filer) return 'The party that filed this is not on record';
		const role = entry.filer.title;
		return role
			? `${entry.filer.name}, ${role.charAt(0).toLowerCase()}${role.slice(1)}`
			: entry.filer.name;
	});

	const number = (value: number) => value.toLocaleString('en-GB');
	// An amount spent is filed as a bare number: the campaign records no currency, so none is shown.
	const money = (value: number) =>
		value.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

	const hasFacts = $derived(
		Boolean(entry.period || entry.workStatus || entry.location) ||
			entry.percentComplete !== null ||
			entry.quantity !== null ||
			entry.amountSpent !== null
	);

	const evidence = $derived(entry.evidence);
	const hasEvidence = $derived(
		evidence.photos.length + evidence.documents.length + evidence.leftOut > 0
	);

	/** Why the entry is flagged or incomplete, in the words stored with it. */
	const reason = $derived.by(() => {
		if (state === 'flagged') {
			return `${entry.statusReason ?? def.text} The report itself may still be accurate.`;
		}
		if (state === 'incomplete') {
			return `${entry.statusReason ?? def.text} The filer can add it without paying the deposit again.`;
		}
		return null;
	});

	const DEPOSIT = {
		'dep-held': 'held',
		'dep-refunded': 'refunded',
		'dep-outstanding': 'not yet refunded'
	} as const;
	const deposit = $derived(
		entry.deposit && entry.deposit.state in DEPOSIT
			? {
					def: STATES[entry.deposit.state],
					words: `Deposit ${entry.deposit.amount} ${DEPOSIT[entry.deposit.state as keyof typeof DEPOSIT]}`
				}
			: null
	);
</script>

<article
	class={['tj-entry', `tj-tone--${def.tone}`, variant && `tj-entry--${variant}`]}
	id="entry-{entry.id}"
>
	<span class="tj-entry__node" aria-hidden="true"><Icon name={def.icon} size={18} /></span>
	<div class="tj-entry__card">
		<header class="tj-entry__head">
			<p class="tj-entry__kicker">
				{entry.heading}{entry.milestonePosition !== null
					? ` · Milestone ${entry.milestonePosition}`
					: ''}
			</p>
			<h4 class="tj-entry__title">{text.title}</h4>
			<p class="tj-entry__meta">
				{filer} · <time datetime={entry.filedAt}>{utcTime(entry.filedAt)}</time>
			</p>
		</header>

		<div class="tj-badges">
			<StatusBadge {state} />
			{#if entry.milestoneBadge}<StatusBadge state={entry.milestoneBadge} />{/if}
		</div>

		{#if text.account}<p class="tj-entry__summary">{text.account}</p>{/if}

		{#if hasFacts}
			<div class="tj-entry__facts">
				{#if entry.period}<span><Icon name="calendar" size={16} />{entry.period}</span>{/if}
				{#if entry.workStatus}
					<span>
						<Icon name={entry.workStatus === 'on_track' ? 'check' : 'alert-circle'} size={16} />
						Reported as {WORK_STATUS_LABEL[entry.workStatus].toLowerCase()}
					</span>
				{/if}
				{#if entry.percentComplete !== null}
					<!-- The reporter's own figure. Tejido never works out a delivery percentage. -->
					<span>{number(entry.percentComplete)}% complete, as reported</span>
				{/if}
				{#if entry.quantity !== null}
					<span>
						<Icon name="package" size={16} />
						{number(entry.quantity)}{entry.unit ? ` ${entry.unit}` : ''}, as reported
					</span>
				{/if}
				{#if entry.amountSpent !== null}
					<span>{money(entry.amountSpent)} spent, as reported</span>
				{/if}
				{#if entry.location}<span><Icon name="map-pin" size={16} />{entry.location}</span>{/if}
			</div>
		{/if}

		{#if hasEvidence}
			<div class="evidence">
				<ul class="tj-entry__thumbs thumbs" aria-label="Evidence">
					{#each evidence.photos as photo (photo.url)}
						<li>
							<a href={photo.url}>
								<img
									src={photo.url}
									alt={photo.caption ?? 'Photo filed as evidence, with no caption'}
									loading="lazy"
									decoding="async"
								/>
							</a>
						</li>
					{/each}
					{#each evidence.documents as document (document.url)}
						<li>
							<a class="tj-thumb" href={document.url}>
								<Icon name="file-text" size={26} />
								<span class="tj-vh">Document: {document.caption ?? 'no caption'} (PDF)</span>
							</a>
						</li>
					{/each}
					{#each { length: evidence.leftOut } as _, index (index)}
						<li>
							<span class="tj-thumb tj-thumb--excluded">
								<Icon name="excluded" /><span class="tj-vh">One file left out</span>
							</span>
						</li>
					{/each}
				</ul>
				{#if evidence.leftOut > 0}
					<p class="left-out">
						{evidence.leftOut === 1
							? '1 file was left out'
							: `${number(evidence.leftOut)} files were left out`}. A file is shown only when Tejido
						can check it is the one that was filed. Pictures are never shown on a milestone that
						takes documents only.
					</p>
				{/if}
			</div>
		{/if}

		{#if reason}
			<p class="tj-entry__reason tj-tone--{def.tone}">
				<Icon name={def.icon} size={18} />
				<span>{reason}</span>
			</p>
		{/if}

		{#if entry.strength && entry.filer}
			<ConfirmationStrength
				strength={entry.strength}
				who="{filer}.{entry.filer.relationshipReason ? ` ${entry.filer.relationshipReason}` : ''}"
			/>
		{/if}

		<footer class="tj-entry__foot">
			{#if deposit}
				<span class="deposit" title={deposit.def.text}>
					<Icon name={deposit.def.icon} size={16} />{deposit.words}
				</span>
			{:else}
				<span>No deposit on record</span>
			{/if}
			<a class="tj-link--standalone" href={entry.proofPath}>
				View proof <Icon name="arrow-right" size={18} />
			</a>
		</footer>
	</div>
</article>

<style>
	/* Where a link from the flagged notice lands. */
	.tj-entry {
		scroll-margin-top: var(--space-4);
	}
	.tj-entry__title,
	.tj-entry__summary,
	.tj-entry__meta {
		overflow-wrap: anywhere;
	}
	.evidence {
		display: grid;
		gap: var(--space-2);
	}
	/* The design shows one row of thumbnails. An entry may carry ten files, so ours wraps. */
	.thumbs {
		flex-wrap: wrap;
	}
	.thumbs li {
		display: flex;
	}
	.thumbs a {
		display: block;
		border-radius: var(--radius-md);
	}
	/* The caption, shown small if the picture cannot be loaded. */
	.thumbs img {
		overflow: hidden;
		font-size: 12px;
		line-height: 16px;
		color: var(--text-muted);
	}
	.thumbs a.tj-thumb {
		display: grid;
	}
	.left-out {
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
	}
	.deposit {
		display: inline-flex;
		align-items: center;
		gap: var(--space-1);
	}
	.deposit :global(.tj-icon) {
		color: var(--text-muted);
	}
</style>
