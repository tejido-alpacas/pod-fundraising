<!--
  The public receipt behind one entry. Human rows first; full identifiers and file fingerprints
  under "Technical details". It always says what a receipt does and doesn't show.

  This is the Campaign Site's own receipt, not `ReceiptBlock` from @tejido/ui: that one takes a
  whole stored entry, and a stored entry carries its filer's private reporter code. This one
  takes only the fields a donor may see.

  <ProofReceipt status="flagged" entryId="ent-1" item="log_work" filedAt="…" {receipt}
                filer="Coral Ridge Builders" milestone={{ position: 2, title: 'Walls' }} {files} />
-->
<script lang="ts">
	import type { EntryStatus } from '@tejido/contracts';
	import { Icon, StatusBadge, shortId } from '@tejido/ui';
	import CopyButton from './CopyButton.svelte';
	import { filingKey } from './display.ts';

	let {
		status,
		entryId,
		item,
		filedAt,
		receipt,
		filer,
		milestone,
		files
	}: {
		status: EntryStatus;
		entryId: string;
		item: 'log_work' | 'milestone_hit';
		filedAt: string;
		receipt: {
			twistId: string | null;
			stampedAt: string | null;
			payingWallet: string | null;
			registeredWallet: string | null;
			/** Compared on the server. Null when one of the two is not on record. */
			walletsMatch: boolean | null;
		};
		/** The filer's name, for the registered wallet's line. */
		filer: string;
		milestone: { position: number; title: string };
		/** Every attached file's fingerprint, with a word for what it is. */
		files: { label: string; sha256: string }[];
	} = $props();

	/** A receipt time is shown to the second: it is what a donor compares. */
	const utc = (timestamp: string) =>
		new Date(timestamp).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZone: 'UTC'
		}) + ' UTC';
	/** Lets a hostname break after dots and hyphens instead of anywhere. */
	const breakable = (hostname: string) => hostname.split(/(?<=[.-])/);

	const mismatch = $derived(receipt.walletsMatch === false);
</script>

{#snippet host(value: string)}
	{#each breakable(value) as piece, index (index)}{piece}<wbr />{/each}
{/snippet}

<section class="tj-receipt" id="receipt" aria-labelledby="receipt-title">
	<header class="tj-receipt__head">
		<h2 class="tj-receipt__title" id="receipt-title">
			<Icon name="receipt-check" />Public receipt
		</h2>
		<span class="tj-badges"><StatusBadge state={filingKey(status)} /></span>
	</header>
	<p class="tj-receipt__note">
		A receipt shows that this report was filed, by which wallet, and when. It doesn’t show that the
		work happened.
	</p>
	{#if receipt.twistId === null}
		<p class="tj-receipt__note">
			Filed with Tejido on {utc(filedAt)}. We haven’t matched it to its public receipt yet, so there
			is no transaction ID or paying wallet to show.
		</p>
	{/if}

	<dl class="tj-kv">
		{#if receipt.twistId !== null}
			<div class="tj-kv__row">
				<dt>Transaction ID</dt>
				<dd>
					<span class="tj-id">{shortId(receipt.twistId)}</span>
					<CopyButton what="Transaction ID" value={receipt.twistId} />
				</dd>
			</div>
			<div class="tj-kv__row">
				<dt>Recorded at</dt>
				<dd>
					{#if receipt.stampedAt}
						<span
							><time datetime={receipt.stampedAt}>{utc(receipt.stampedAt)}</time><span
								class="tj-kv__sub">Time on the public ledger</span
							></span
						>
					{:else}
						<span>Not on record</span>
					{/if}
				</dd>
			</div>
			<div class="tj-kv__row">
				<dt>Wallet that paid</dt>
				<dd>
					<span>
						{#if receipt.payingWallet}
							<span class={['tj-id', 'tj-id--host', mismatch && 'tj-kv__mismatch']}
								>{@render host(receipt.payingWallet)}</span
							>
							<span class="tj-kv__sub">
								{#if mismatch}
									Doesn’t match the registered wallet
								{:else if receipt.walletsMatch}
									Matches the registered wallet{status === 'flagged'
										? ' now. It didn’t when this filing was matched, so the flag stays.'
										: ''}
								{:else}
									There is no registered wallet to compare it with
								{/if}
							</span>
						{:else}
							Not on record
						{/if}
					</span>
				</dd>
			</div>
		{/if}
		{#if receipt.twistId === null || receipt.walletsMatch !== true}
			<div class="tj-kv__row">
				<dt>Registered wallet</dt>
				<dd>
					<span>
						{#if receipt.registeredWallet}
							<span class="tj-id tj-id--host">{@render host(receipt.registeredWallet)}</span>
							<span class="tj-kv__sub">{filer}, linked at sign-in</span>
						{:else}
							None yet
							<span class="tj-kv__sub">{filer} hasn’t linked a wallet by signing in</span>
						{/if}
					</span>
				</dd>
			</div>
		{/if}
		<div class="tj-kv__row">
			<dt>Milestone</dt>
			<dd><span>{milestone.position} · {milestone.title}</span></dd>
		</div>
	</dl>

	<details class="tj-disclosure">
		<summary>Technical details <Icon name="chevron-down" size={18} /></summary>
		<div class="tj-disclosure__body">
			<dl class="tj-kv" style:padding="0">
				{#if receipt.twistId !== null}
					<div class="tj-kv__row">
						<dt>Full transaction ID</dt>
						<dd>
							<span class="tj-id">{receipt.twistId}</span>
							<CopyButton what="Full transaction ID" value={receipt.twistId} />
						</dd>
					</div>
				{/if}
				{#if receipt.payingWallet}
					<div class="tj-kv__row">
						<dt>Wallet that paid</dt>
						<dd>
							<span class="tj-id tj-id--host">{@render host(receipt.payingWallet)}</span>
							<CopyButton what="Wallet that paid" value={receipt.payingWallet} />
						</dd>
					</div>
				{/if}
				{#each files as file, index (index)}
					<div class="tj-kv__row">
						<dt>File fingerprint · {file.label}</dt>
						<dd>
							<span class="tj-id">{file.sha256}</span>
							<CopyButton what="File fingerprint {index + 1}" value={file.sha256} />
						</dd>
					</div>
				{/each}
				<div class="tj-kv__row">
					<dt>Entry</dt>
					<dd><span class="tj-id">{entryId} · {item}</span></dd>
				</div>
				<div class="tj-kv__row">
					<dt>Filed with Tejido</dt>
					<dd><time datetime={filedAt}>{utc(filedAt)}</time></dd>
				</div>
			</dl>
			<p class="tj-help">
				Fingerprints are SHA-256 hashes of each file. If a file changed, its fingerprint would too.
				The transaction ID and the time come from the public ledger, not from the filer.
			</p>
		</div>
	</details>
</section>
