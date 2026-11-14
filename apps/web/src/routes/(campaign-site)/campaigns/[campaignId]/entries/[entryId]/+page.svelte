<script lang="ts">
	import { formatAmount } from '@tejido/contracts';
	import CampaignNav from '#lib/campaign-site/CampaignNav.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const entry = $derived(data.entry);
	const filed = $derived(data.filed);
	const receipt = $derived(data.receipt);
	const filer = $derived(data.filer);

	/** A receipt time is shown to the second: it is what a donor compares. */
	const when = (timestamp: string) =>
		new Date(timestamp).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZone: 'UTC',
			timeZoneName: 'short'
		});

	const words = (value: string) => value.replaceAll('_', ' ');

	// The same words and badge shapes as the donor timeline, so the two pages read as one site.
	const STATUS_LABEL = {
		verified: 'Verified',
		filed: 'Filed, not yet verified',
		incomplete: 'Incomplete',
		flagged: 'Flagged'
	} as const;

	const ROLE_LABEL = { third_party: 'does the work', confirmer: 'independent confirmer' } as const;

	const LEFT_OUT = {
		not_in_our_store:
			'Not shown because it could not be verified: this file is not held by Tejido, so we cannot check what it is.',
		hash_mismatch:
			'Not shown because it could not be verified: the fingerprint (SHA-256) filed with it does not match the file we hold.',
		picture_on_documents_only:
			'Not shown: it is a picture, and this milestone takes documents only.'
	} as const;

	const heading = $derived(
		filed.item === 'log_work'
			? 'Work log'
			: filed.claim === 'confirm'
				? 'Confirmation'
				: `Milestone claim: ${words(filed.claim)}`
	);

	const hasReceipt = $derived(receipt.twistId !== null);
	const leftOut = $derived(data.evidence.filter((file) => !file.shown).length);
</script>

<svelte:head><title>{heading} · proof · {data.campaign.title} · Tejido</title></svelte:head>

<CampaignNav campaignId={data.campaign.id} title={data.campaign.title} current={null} />

<p class="eyebrow">Proof of one entry</p>
<h1>{heading}</h1>
<p class="muted">
	{data.milestone.title} · filed by {filer.name}, {filer.title} · {when(entry.filedAt)}
</p>

<!-- What the status means, in full. A flag is the first thing a donor must see. -->
<section class="verdict status-{entry.status}" aria-label="Status of this entry">
	<p class="verdict-title">
		<span class="pill status-{entry.status}">
			<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
				{#if entry.status === 'verified'}
					<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" />
				{:else if entry.status === 'flagged'}
					<path d="M8 1.5l7 12.5H1z" fill="none" stroke="currentColor" stroke-width="1.6" />
					<path d="M8 6v4M8 11.4v1.4" stroke="currentColor" stroke-width="1.8" />
				{:else if entry.status === 'incomplete'}
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
			{STATUS_LABEL[entry.status]}
		</span>
	</p>
	{#if entry.status === 'verified'}
		<p>
			Qatom’s ledger has a payment for this entry, and it was paid from the wallet registered for
			{filer.name}. That is the receipt below.
		</p>
	{:else if entry.status === 'flagged'}
		<p class="reason"><strong>{entry.statusReason ?? 'This entry has been flagged.'}</strong></p>
		<p>
			Qatom’s ledger has a payment for this entry, but it did not come from the wallet registered
			for {filer.name}. So the receipt below does not show that {filer.name} filed it. Treat this entry
			with care.
		</p>
	{:else if entry.status === 'incomplete'}
		<p class="reason">
			<strong>{entry.statusReason ?? 'Something this milestone requires is missing.'}</strong>
		</p>
		<p>
			The entry was saved, but it is missing something this milestone requires. The filer can add it
			without paying again.
			{#if hasReceipt}
				Its payment has been matched to Qatom’s ledger and came from the wallet registered for
				{filer.name}.
			{:else}
				It has not been matched to Qatom’s ledger yet, so there is no receipt to show yet.
			{/if}
		</p>
	{:else}
		<p>
			This entry has been saved, but it has not been matched to Qatom’s ledger yet. That does not
			mean it is false: matching happens after filing, and the receipt appears here once it is done.
			{#if receipt.registeredWallet === null}
				{filer.name} has not linked a Qatom wallet yet, and an entry cannot be matched until they have.
			{/if}
		</p>
	{/if}
</section>

<div class="sections">
	<section class="card">
		<h2>The receipt</h2>
		{#if hasReceipt}
			<dl>
				<dt>Transaction id</dt>
				<dd><code>{receipt.twistId}</code></dd>
				<dt>Stamped by Qatom</dt>
				<dd>
					{#if receipt.stampedAt}
						<time datetime={receipt.stampedAt}>{when(receipt.stampedAt)}</time>
					{:else}
						Not recorded
					{/if}
				</dd>
				<dt>Wallet that paid</dt>
				<dd>
					{#if receipt.payingWallet}<code>{receipt.payingWallet}</code>{:else}Not recorded{/if}
				</dd>
				<dt>Wallet registered for {filer.name}</dt>
				<dd>
					{#if receipt.registeredWallet}
						<code>{receipt.registeredWallet}</code>
					{:else}
						None registered
					{/if}
				</dd>
				<dt>Do the two match?</dt>
				<dd>
					{#if receipt.walletsMatch === true}
						<strong class="yes">Yes.</strong> The wallet that paid is the wallet registered for
						{filer.name}.
						{#if entry.status === 'flagged'}
							They were not the same when this entry was matched to the ledger, which is why it is
							flagged; the registered wallet is different now.
						{/if}
					{:else if receipt.walletsMatch === false}
						<strong class="no">No.</strong> The wallet that paid is not the wallet registered for
						{filer.name}.
						{#if entry.status === 'verified' || entry.status === 'incomplete'}
							They were the same when this entry was matched to the ledger; the registered wallet is
							different now.
						{/if}
					{:else}
						They cannot be compared: one of the two wallets is not on record.
					{/if}
				</dd>
			</dl>
			<p class="muted">
				Qatom is the payment service Tejido uses. The transaction id and time come from Qatom’s
				ledger, not from the filer. They show that this wallet paid to file this entry, and when.
				They do not show that what was written is true.
			</p>
		{:else}
			<p>
				No receipt yet. This entry has not been matched to a transaction in Qatom’s ledger, so there
				is no transaction id, stamp time or paying wallet to show.
			</p>
			<dl>
				<dt>Wallet registered for {filer.name}</dt>
				<dd>
					{#if receipt.registeredWallet}
						<code>{receipt.registeredWallet}</code>
					{:else}
						None registered yet
					{/if}
				</dd>
			</dl>
		{/if}
	</section>

	<section class="card">
		<h2>What was filed</h2>
		<dl>
			<dt>Kind of entry</dt>
			<dd>
				{#if filed.item === 'log_work'}
					Work log, a routine progress report
				{:else if filed.claim === 'confirm'}
					Confirmation that a milestone is done
				{:else}
					Claim that a milestone is done
				{/if}
			</dd>
			<dt>Milestone</dt>
			<dd>
				<a href="/campaigns/{data.campaign.id}/milestones#{data.milestone.id}"
					>{data.milestone.title}</a
				>
			</dd>
			<dt>Filed by</dt>
			<dd>{filer.name}, {filer.title} ({ROLE_LABEL[filer.role]})</dd>
			<dt>Filed</dt>
			<dd><time datetime={entry.filedAt}>{when(entry.filedAt)}</time></dd>
			{#if filed.item === 'milestone_hit'}
				<dt>Claim</dt>
				<dd>{words(filed.claim)}</dd>
			{/if}
			<dt>Summary</dt>
			<dd class="summary">{filed.summary}</dd>
			{#if filed.item === 'log_work'}
				<dt>Status of the work</dt>
				<dd class:muted={filed.status === null}>
					{filed.status ? words(filed.status) : 'Not given'}
				</dd>
				<dt>Period</dt>
				<dd class:muted={filed.period === null}>{filed.period ?? 'Not given'}</dd>
				<dt>Percent complete</dt>
				<dd class:muted={filed.percentComplete === null}>
					{filed.percentComplete === null ? 'Not given' : `${filed.percentComplete}%`}
				</dd>
			{:else}
				<dt>Quantity</dt>
				<dd class:muted={filed.quantity === null}>{filed.quantity ?? 'Not given'}</dd>
				<dt>Unit</dt>
				<dd class:muted={filed.unit === null}>{filed.unit ?? 'Not given'}</dd>
				<dt>Amount spent</dt>
				<dd class:muted={filed.amountSpent === null}>{filed.amountSpent ?? 'Not given'}</dd>
			{/if}
			<dt>Location</dt>
			<dd class:muted={filed.location === null}>{filed.location ?? 'Not given'}</dd>
			<dt>Photos or documents</dt>
			<dd class:muted={data.evidence.length === 0}>
				{data.evidence.length === 0 ? 'None attached' : `${data.evidence.length} attached, below`}
			</dd>
		</dl>
	</section>

	<section class="card">
		<h2>The deposit</h2>
		{#if data.deposit}
			<p>
				{filer.name} paid a deposit of <strong>{formatAmount(data.deposit.amount)}</strong> to file this
				entry.
			</p>
			{#if data.deposit.refund === 'returned'}
				<p>
					<strong class="yes">Returned.</strong> It was sent back to {filer.name}
					{#if data.deposit.refundedAt}
						on <time datetime={data.deposit.refundedAt}>{when(data.deposit.refundedAt)}</time>
					{/if}
					after the milestone was confirmed.
				</p>
			{:else if data.deposit.refund === 'being_returned'}
				<p>
					<strong>Not confirmed as returned.</strong> A refund was started, and we have no record yet
					that it went through.
				</p>
			{:else if data.deposit.refund === 'outcome_unknown'}
				<p>
					<strong>Not confirmed as returned.</strong> A refund was sent, but no answer came back, so we
					do not know whether it arrived. It needs a person to check, and it will not be sent a second
					time.
				</p>
			{:else}
				<p>
					<strong>Held, not refunded.</strong>
					{#if entry.status === 'flagged'}
						Deposits on flagged entries are not sent back until a person has looked at them.
					{:else if !data.milestone.confirmed}
						Deposits are sent back when the milestone is confirmed. This one is not confirmed yet.
					{:else if !hasReceipt}
						The milestone is confirmed, but a deposit is only sent back once its entry has been
						matched to Qatom’s ledger.
					{:else}
						The milestone is confirmed and the refund has not been sent yet.
					{/if}
				</p>
			{/if}
		{:else}
			<p>No deposit is on record for this entry.</p>
		{/if}
	</section>

	<section class="card">
		<h2>Evidence</h2>
		{#if data.evidence.length === 0}
			<p class="muted">No photos or documents were attached to this entry.</p>
		{:else}
			<p>
				To check a file, download it, work out its SHA-256 (<code>shasum -a 256 file</code> on a Mac
				or Linux, <code>certutil -hashfile file SHA256</code> on Windows) and compare it with the one
				shown here: if every character matches, it is exactly the file that was filed.
			</p>
			{#if data.documentsOnly}
				<p class="muted">This milestone takes documents only, so no pictures are shown on it.</p>
			{/if}
			{#if leftOut > 0}
				<p class="left-out">
					{leftOut === 1 ? '1 attached file is' : `${leftOut} attached files are`} not shown here, for
					the reason given beside {leftOut === 1 ? 'it' : 'each'}.
				</p>
			{/if}
			<ul class="evidence">
				{#each data.evidence as file, index (index)}
					<li>
						{#if file.shown}
							{#if file.kind === 'photo'}
								<a href={file.url}>
									<img src={file.url} alt={file.caption ?? 'Evidence photo'} loading="lazy" />
								</a>
							{/if}
							<p>
								<strong>{file.caption ?? (file.kind === 'photo' ? 'Photo' : 'Document')}</strong>
								· <a href={file.url} download>download the {file.kind}</a>
							</p>
						{:else}
							<p><strong>{file.caption ?? 'Attached file'}</strong></p>
							<p class="left-out">{LEFT_OUT[file.why]}</p>
						{/if}
						<p class="hash">
							<span class="muted">{file.shown ? 'SHA-256' : 'SHA-256 as filed'}</span>
							<code>{file.sha256}</code>
						</p>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</div>

<p class="muted back">
	<a class="tap" href="/campaigns/{data.campaign.id}">Back to the timeline</a>
</p>

<style>
	.muted {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.sections {
		display: grid;
		gap: 0.75rem;
		max-width: 46rem;
	}
	.card,
	.verdict {
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.9rem 1rem;
	}
	.card h2 {
		margin-top: 0;
	}
	.card p,
	.verdict p {
		margin: 0.4rem 0;
	}
	.verdict {
		max-width: 46rem;
		box-sizing: border-box;
		margin: 1rem 0 0.75rem;
		border-left-width: 5px;
		border-left-color: var(--muted);
	}
	.verdict.status-verified {
		border-left-color: var(--a);
	}
	.verdict.status-incomplete {
		border-left-color: var(--c);
	}
	.verdict.status-flagged {
		border: 2px solid var(--warn);
		border-left-width: 8px;
	}
	.verdict-title {
		font-size: 1.1rem;
	}
	.pill {
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
	.pill svg {
		flex: none;
	}
	.pill.status-verified {
		border: 1.5px solid var(--a);
		background: var(--a);
		color: #fff;
	}
	.pill.status-incomplete {
		color: var(--c);
	}
	.pill.status-flagged {
		border: 1.5px solid var(--warn);
		background: var(--warn);
		color: #fff;
	}
	.reason {
		color: var(--warn);
	}
	.left-out {
		color: var(--c);
	}
	.status-incomplete .reason {
		color: var(--c);
	}
	.yes {
		color: var(--a);
	}
	.no {
		color: var(--warn);
	}
	dl {
		display: grid;
		grid-template-columns: minmax(8rem, 13rem) 1fr;
		gap: 0.45rem 1rem;
		margin: 0.5rem 0;
	}
	dt {
		color: var(--muted);
		font-size: 0.9rem;
	}
	dd {
		margin: 0;
		min-width: 0;
		overflow-wrap: anywhere;
	}
	.summary {
		white-space: pre-line;
	}
	.evidence {
		list-style: none;
		padding: 0;
		margin: 0.75rem 0 0;
		display: grid;
		gap: 0.75rem;
	}
	.evidence li {
		border-top: 1px solid var(--line);
		padding-top: 0.75rem;
	}
	.evidence img {
		display: block;
		max-width: 100%;
		max-height: 22rem;
		border-radius: 6px;
		border: 1px solid var(--line);
	}
	.hash code {
		display: block;
		margin-top: 0.2rem;
		padding: 0.35rem 0.5rem;
	}
	.back {
		margin-top: 1rem;
	}
	@media (max-width: 34rem) {
		dl {
			grid-template-columns: 1fr;
			gap: 0.1rem;
		}
		dd {
			margin-bottom: 0.5rem;
		}
	}
</style>
