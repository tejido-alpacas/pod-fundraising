<script lang="ts">
	import { formatAmount, type MilestoneState } from '@tejido/contracts';
	import EntryStatus from '#lib/campaign-site/EntryStatus.svelte';
	import {
		CLAIM_LABEL,
		MILESTONE_STATE_LABEL,
		PARTY_ROLE_LABEL,
		formatDate,
		formatDateTime
	} from '#lib/campaign-site/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const campaignPath = $derived(`/campaigns/${data.campaign.id}`);
	const totals = $derived(data.totals);
	const held = $derived(totals.paid - totals.returned);

	/** What each confirmation strength means, in the same words as the milestone status page. */
	const STATE_MEANS: Record<MilestoneState, string> = {
		confirmed_independent:
			'The named confirmer, who did not do the work, signed it off from their own wallet.',
		confirmed_creator:
			'No independent confirmer answered in the waiting period, so the campaign’s creator signed it off.',
		claimed: 'The party doing the work says it is done. Nobody has confirmed it yet.',
		open: 'Nobody has reported this milestone as done yet.'
	};

	const words = (value: string) => value.replaceAll('_', ' ');
	const count = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);
</script>

{#snippet stateBadge(state: MilestoneState)}
	<span class="badge state-{state}">
		<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
			{#if state === 'confirmed_independent'}
				<path d="M1.5 8.7l2.8 2.8 5-6.5" fill="none" stroke="currentColor" stroke-width="2" />
				<path d="M8 11.5l1 1 5.5-7.500" fill="none" stroke="currentColor" stroke-width="2" />
			{:else if state === 'confirmed_creator'}
				<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" />
			{:else if state === 'claimed'}
				<circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.6" />
				<path d="M8 2a6 6 0 0 1 0 12z" fill="currentColor" />
			{:else}
				<circle
					cx="8"
					cy="8"
					r="6"
					fill="none"
					stroke="currentColor"
					stroke-width="1.6"
					stroke-dasharray="2.6 2.1"
				/>
			{/if}
		</svg>
		{MILESTONE_STATE_LABEL[state]}
	</span>
{/snippet}

<svelte:head><title>Final report · {data.campaign.title} · Tejido</title></svelte:head>

<p class="eyebrow">
	<a href={campaignPath}>{data.campaign.title}</a> · final report
</p>
<h1>{data.delivered ? 'Delivered' : 'Not finished yet'}</h1>

{#if data.delivered}
	<section class="verdict delivered" aria-label="Where this campaign stands">
		<p class="verdict-title">
			Every milestone of this campaign is confirmed{#if data.deliveredAt}. The last one was
				confirmed on
				<time datetime={data.deliveredAt}>{formatDateTime(data.deliveredAt)}</time>{/if}.
		</p>
		<p>
			{#if totals.byCreator === 0}
				{totals.milestones === 1
					? 'It was confirmed independently'
					: `All ${totals.milestones} were confirmed independently`}: by a named confirmer who did
				not do the work.
			{:else if totals.independent === 0}
				{totals.milestones === 1 ? 'It was' : `All ${totals.milestones} were`} confirmed by the campaign’s
				creator, not by an independent confirmer.
			{:else}
				{totals.independent} of {totals.milestones}
				{totals.independent === 1 ? 'was' : 'were'} confirmed independently. {totals.byCreator}
				{totals.byCreator === 1 ? 'was' : 'were'} confirmed by the campaign’s creator, because no independent
				confirmer answered.
			{/if}
		</p>
	</section>
{:else}
	<section class="verdict unfinished" aria-label="Where this campaign stands">
		{#if totals.milestones === 0}
			<p class="verdict-title">This campaign has no milestones, so there is nothing to report.</p>
		{:else}
			<p class="verdict-title">
				This campaign is not finished. {totals.confirmed} of {count(
					totals.milestones,
					'milestone',
					'milestones'
				)}
				{totals.confirmed === 1 ? 'is' : 'are'} confirmed.
			</p>
			<p>Still outstanding:</p>
			<ul>
				{#each data.outstanding as milestone (milestone.id)}
					<li>
						<a href="#{milestone.id}">{milestone.title}</a>, due {formatDate(milestone.dueDate)}.
						{#if milestone.state === 'claimed'}
							Reported as done{milestone.owner ? ` by ${milestone.owner.name}` : ''}, and waiting
							for
							{milestone.namedConfirmer ? milestone.namedConfirmer.name : 'its confirmer'} to confirm
							it.
						{:else}
							Not reported as done yet{milestone.owner ? `. Owed by ${milestone.owner.name}` : ''}.
						{/if}
					</li>
				{/each}
			</ul>
			<p class="muted">
				This page becomes the final report once every milestone is confirmed. What is confirmed so
				far is below.
			</p>
		{/if}
	</section>
{/if}

<section class="card summary" aria-label="The campaign in brief">
	{#if data.campaign.summary}<p>{data.campaign.summary}</p>{/if}
	<dl class="facts">
		{#if data.campaign.beneficiary}
			<dt>For</dt>
			<dd>{data.campaign.beneficiary}</dd>
		{/if}
		<dt>Created by</dt>
		<dd>{data.campaign.creatorName}</dd>
		<dt>Milestones</dt>
		<dd>{totals.confirmed} of {totals.milestones} confirmed</dd>
		<dt>Work logs filed</dt>
		<dd>{totals.workLogs}</dd>
		<dt>Deposits</dt>
		<dd>
			{#if totals.entries === 0}
				<span class="muted">None paid.</span>
			{:else}
				{formatAmount(totals.paid)} paid by the people filing · {formatAmount(totals.returned)}
				returned
				{#if held > 0}· {formatAmount(held)} still held{/if}
			{/if}
		</dd>
		{#if totals.flagged > 0}
			<dt>Flagged entries</dt>
			<dd>
				<strong class="warn">{totals.flagged}</strong> · paid from a wallet that is not the one
				registered for the party. <a href={campaignPath}>See them on the timeline</a>
			</dd>
		{/if}
	</dl>
</section>

<ol class="milestones">
	{#each data.milestones as milestone, index (milestone.id)}
		<li class="card state-{milestone.state}" id={milestone.id}>
			<header>
				<h2><span class="number">{index + 1}.</span> {milestone.title}</h2>
				<p class="standing">{@render stateBadge(milestone.state)}</p>
				<p class="means">{STATE_MEANS[milestone.state]}</p>
			</header>

			{#if milestone.description}<p>{milestone.description}</p>{/if}

			<dl class="facts">
				<dt>Confirmed by</dt>
				<dd>
					{#if milestone.confirmedBy}
						<strong>{milestone.confirmedBy.name}</strong>{milestone.confirmedBy.title
							? `, ${milestone.confirmedBy.title}`
							: ''}
						<span class="muted">
							({milestone.confirmedBy.who === 'creator'
								? 'the campaign’s creator'
								: PARTY_ROLE_LABEL.confirmer})
						</span>
					{:else if milestone.confirmed}
						<span class="muted">The confirmer is not on record.</span>
					{:else}
						<strong class="pending">Not confirmed yet.</strong>
						{#if milestone.namedConfirmer}
							<span class="muted">
								Named to confirm it: {milestone.namedConfirmer.name}, {milestone.namedConfirmer
									.title}
							</span>
						{/if}
					{/if}
				</dd>
				{#if milestone.confirmed}
					<dt>Confirmed</dt>
					<dd>
						{#if milestone.confirmedAt}
							<time datetime={milestone.confirmedAt}>{formatDateTime(milestone.confirmedAt)}</time>
						{:else}
							<span class="muted">The time is not on record.</span>
						{/if}
					</dd>
					<dt>Receipt of the sign-off</dt>
					<dd>
						{#if milestone.signOff}
							{#if milestone.signOff.twistId}
								Transaction <code>{milestone.signOff.twistId}</code>
								{#if milestone.signOff.payingWallet}
									paid from <code>{milestone.signOff.payingWallet}</code>
								{/if}
							{:else}
								<span class="muted">Not matched to the payment ledger yet.</span>
							{/if}
							· <a href={milestone.signOff.proofPath}>see the proof</a>
						{:else}
							<span class="muted">No confirmation entry is on record for this milestone.</span>
						{/if}
					</dd>
				{/if}
				<dt>Work done by</dt>
				<dd>
					{#if milestone.owner}
						{milestone.owner.name}, {milestone.owner.title}
						<span class="muted">({PARTY_ROLE_LABEL[milestone.owner.role]})</span>
					{:else}
						<span class="muted">Not on record</span>
					{/if}
				</dd>
				<dt>Kind · due</dt>
				<dd>
					{words(milestone.kind)} ·
					<time datetime={milestone.dueDate}>{formatDate(milestone.dueDate)}</time>
				</dd>
				<dt>Work logs</dt>
				<dd>
					{#if milestone.workLogs === 0}
						<span class="muted">None filed on this milestone.</span>
					{:else}
						{count(milestone.workLogs, 'work log', 'work logs')} filed ·
						<a href={campaignPath}>read them on the timeline</a>
					{/if}
					{#if milestone.flaggedCount > 0}
						<br />
						<strong class="warn">
							{count(milestone.flaggedCount, 'entry', 'entries')} on this milestone
							{milestone.flaggedCount === 1 ? 'is' : 'are'} flagged.
						</strong>
					{/if}
				</dd>
				<dt>Deposits</dt>
				<dd>
					{#if milestone.entryCount === 0}
						<span class="muted">None paid.</span>
					{:else}
						{formatAmount(milestone.deposits.paid)} paid · {formatAmount(
							milestone.deposits.returned
						)} returned
						{#if milestone.deposits.returned < milestone.deposits.paid}
							· {formatAmount(milestone.deposits.paid - milestone.deposits.returned)} still held
						{/if}
						{#if milestone.deposits.lastRefundedAt}
							<span class="muted">
								· last sent back
								<time datetime={milestone.deposits.lastRefundedAt}
									>{formatDateTime(milestone.deposits.lastRefundedAt)}</time
								>
							</span>
						{/if}
					{/if}
					{#if milestone.refunds.length > 0}
						<ul class="refunds">
							{#each milestone.refunds as refund, refundIndex (refundIndex)}
								<li>
									{formatAmount(refund.amount)}
									{refund.outcome === 'sent' ? 'sent back' : 'refund started'}
									to {refund.to ?? 'a party not on record'}, at wallet
									<code>{refund.wallet}</code>
									{#if refund.outcome === 'sent'}
										{#if refund.at}
											on <time datetime={refund.at}>{formatDateTime(refund.at)}</time>
										{/if}
									{:else}
										<strong class="pending">· not confirmed as arrived</strong>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
				</dd>
			</dl>

			<h3>The evidence behind it</h3>
			{#if milestone.evidence.length === 0}
				<p class="muted">Nobody has filed a claim or a confirmation on this milestone.</p>
			{:else}
				<ul class="evidence">
					{#each milestone.evidence as entry (entry.entryId)}
						<li>
							<div class="top">
								<EntryStatus status={entry.status} />
								<strong>
									{entry.kind === 'confirmation'
										? 'Confirmation'
										: `Milestone claim: ${CLAIM_LABEL[entry.claim]}`}
								</strong>
								<span class="muted">
									{#if entry.filedBy}· {entry.filedBy.name}{/if}
									· <time datetime={entry.filedAt}>{formatDateTime(entry.filedAt)}</time>
								</span>
							</div>
							<p class="said">{entry.summary}</p>

							{#if entry.files.photos.length > 0}
								<ul class="photos">
									{#each entry.files.photos as photo (photo.url)}
										<li>
											<figure>
												<a href={entry.proofPath}>
													<img
														src={photo.url}
														alt={photo.caption ?? 'Photo filed as evidence, with no caption'}
														loading="lazy"
														decoding="async"
													/>
												</a>
												{#if photo.caption}<figcaption>{photo.caption}</figcaption>{/if}
											</figure>
										</li>
									{/each}
								</ul>
							{/if}
							{#if entry.files.documents.length > 0}
								<ul class="documents">
									{#each entry.files.documents as document (document.url)}
										<li>
											<a href={document.url}>{document.caption ?? 'Document'}</a>
											<span class="muted">(PDF)</span>
										</li>
									{/each}
								</ul>
							{/if}
							{#if entry.files.leftOut > 0}
								<p class="left-out">
									{entry.files.leftOut === 1
										? '1 attached file is not shown'
										: `${entry.files.leftOut} attached files are not shown`}: we could not confirm
									{entry.files.leftOut === 1 ? 'it is' : 'they are'} from Tejido’s evidence store and
									allowed on this milestone.
								</p>
							{:else if entry.files.photos.length + entry.files.documents.length === 0}
								<p class="muted">No photos or documents were attached.</p>
							{/if}

							<p class="proof"><a href={entry.proofPath}>See the proof behind this entry</a></p>
						</li>
					{/each}
				</ul>
			{/if}
		</li>
	{/each}
</ol>

<p class="muted note">
	A confirmation shows that a second person, paying from their own wallet, signed the milestone off.
	It does not prove by itself that what was written is true; the proof page behind each entry shows
	exactly what is and is not checked.
</p>

<p class="muted back">
	<a href="{campaignPath}/milestones">Milestone status</a> ·
	<a href={campaignPath}>Back to the timeline</a>
</p>

<style>
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.eyebrow a {
		color: inherit;
	}
	.warn {
		color: var(--warn);
	}
	.pending {
		color: var(--c);
	}
	.verdict,
	.card {
		max-width: 46rem;
		box-sizing: border-box;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.9rem 1rem;
	}
	.verdict {
		margin: 1rem 0 0.75rem;
		border-left-width: 8px;
	}
	.verdict.delivered {
		border: 2px solid var(--a);
		border-left-width: 8px;
	}
	.verdict.unfinished {
		border: 2px solid var(--c);
		border-left-width: 8px;
	}
	.verdict p {
		margin: 0.3rem 0;
	}
	.verdict ul {
		margin: 0.3rem 0;
		padding-left: 1.2rem;
	}
	.verdict-title {
		font-weight: 700;
		font-size: 1.1rem;
	}
	.delivered .verdict-title {
		color: var(--a);
	}
	.unfinished .verdict-title {
		color: var(--c);
	}
	.summary {
		margin-bottom: 0.75rem;
	}
	.summary p {
		margin: 0 0 0.5rem;
	}
	.milestones {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
		gap: 0.75rem;
	}
	.milestones > .card {
		border-left: 5px solid var(--line);
		scroll-margin-top: 1rem;
	}
	.card.state-confirmed_independent {
		border-left-color: var(--a);
	}
	.card.state-confirmed_creator,
	.card.state-claimed {
		border-left-color: var(--c);
	}
	.card h2 {
		margin: 0;
	}
	.card h3 {
		font-size: 1rem;
		margin: 1rem 0 0.4rem;
	}
	.card p {
		margin: 0.4rem 0;
	}
	.number {
		color: var(--muted);
		font-weight: 400;
	}
	.standing {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}
	.means {
		font-size: 0.9rem;
		color: var(--muted);
	}
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.85rem;
		font-weight: 650;
		line-height: 1.3;
		border-radius: 999px;
		padding: 2px 11px 2px 8px;
		border: 1.5px dashed currentColor;
		color: var(--muted);
		white-space: nowrap;
	}
	.badge svg {
		flex: none;
	}
	/* Strongest: filled. Creator: a solid outline. Reported only: dashed. Open: dashed grey. */
	.badge.state-confirmed_independent {
		border: 1.5px solid var(--a);
		background: var(--a);
		color: #fff;
	}
	.badge.state-confirmed_creator {
		border: 1.5px solid var(--c);
		color: var(--c);
	}
	.badge.state-claimed {
		color: var(--c);
	}
	.facts {
		display: grid;
		grid-template-columns: minmax(7rem, 10rem) 1fr;
		gap: 0.45rem 1rem;
		margin: 0.75rem 0 0;
	}
	.facts dt {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.facts dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.refunds {
		margin: 0.3rem 0 0;
		padding-left: 1.2rem;
		font-size: 0.9rem;
	}
	.evidence {
		list-style: none;
		padding: 0;
		margin: 0;
		display: grid;
	}
	.evidence > li {
		padding: 0.6rem 0;
		border-top: 1px solid var(--line);
		min-width: 0;
	}
	.top {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: 0.25rem 0.6rem;
	}
	.said {
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	.photos {
		list-style: none;
		padding: 0;
		margin: 0.6rem 0;
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(9rem, 1fr));
		gap: 0.6rem;
	}
	figure {
		margin: 0;
	}
	img {
		display: block;
		width: 100%;
		aspect-ratio: 4 / 3;
		object-fit: cover;
		border-radius: 6px;
		background: var(--line);
		/* The caption text shown if the picture cannot be loaded. */
		font-size: 0.8rem;
		color: var(--muted);
	}
	figcaption {
		font-size: 0.85rem;
		color: var(--muted);
		margin-top: 0.25rem;
	}
	.documents {
		margin: 0.6rem 0;
		padding-left: 1.2rem;
		font-size: 0.95rem;
	}
	.left-out {
		font-size: 0.9rem;
		color: var(--c);
		border-left: 3px dashed var(--c);
		padding-left: 0.6rem;
	}
	.proof {
		font-size: 0.95rem;
		font-weight: 600;
	}
	.note {
		max-width: 46rem;
		margin-top: 1rem;
	}
	.back {
		margin-top: 1rem;
	}
	@media (max-width: 34rem) {
		.facts {
			grid-template-columns: 1fr;
			gap: 0.1rem;
		}
		.facts dd {
			margin-bottom: 0.5rem;
		}
	}
</style>
