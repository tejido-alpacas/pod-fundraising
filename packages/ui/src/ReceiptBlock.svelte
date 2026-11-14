<!--
  ReceiptBlock: the public receipt behind an entry. Human rows first; full identifiers and file
  fingerprints under "Technical details". States plainly what a receipt does and doesn't prove.

  <ReceiptBlock {entry} registeredWallet={party.agentWalletHostname} {milestone} example />
-->
<script lang="ts">
	import type { Entry, Milestone } from '@tejido/contracts';
	import Icon from './Icon.svelte';
	import StatusBadge from './StatusBadge.svelte';
	import { filingState, shortId } from './states.ts';

	let {
		entry,
		registeredWallet,
		milestone,
		example = false
	}: {
		entry: Entry;
		registeredWallet: string | null;
		milestone: Pick<Milestone, 'position' | 'title'>;
		/** Label illustrative data as such. */
		example?: boolean;
	} = $props();

	const filing = $derived(filingState(entry));
	const mismatch = $derived(entry.payingWallet !== null && entry.payingWallet !== registeredWallet);
	const utc = (t: string) =>
		new Date(t).toLocaleString('en-GB', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			second: '2-digit',
			timeZone: 'UTC'
		}) + ' UTC';
	/** Lets a hostname break after dots and hyphens instead of anywhere. */
	const breakable = (host: string) => host.split(/(?<=[.-])/);

	let copied = $state<string | null>(null);
	async function copy(what: string, value: string) {
		try {
			await navigator.clipboard.writeText(value);
			copied = what;
		} catch {
			copied = 'failed';
		}
	}
</script>

{#snippet copyButton(what: string, value: string)}
	<button
		type="button"
		class="tj-copy"
		aria-label="Copy {what.toLowerCase()}"
		title="Copy"
		onclick={() => copy(what, value)}
	>
		<Icon name={copied === what ? 'check' : 'copy'} size={18} />
	</button>
{/snippet}

{#snippet host(value: string)}
	{#each breakable(value) as part, i (i)}{part}<wbr />{/each}
{/snippet}

<section class="tj-receipt" id="receipt" aria-labelledby="receipt-title">
	<header class="tj-receipt__head">
		<h2 class="tj-receipt__title" id="receipt-title">
			<Icon name="receipt-check" />Public receipt
		</h2>
		<span class="tj-badges">
			{#if example}<span class="tj-sample">Example data</span>{/if}
			<StatusBadge state={filing} />
		</span>
	</header>
	<p class="tj-receipt__note">
		A receipt shows that this report was filed, by which wallet, and when. It doesn’t show that the
		work happened.
	</p>

	{#if entry.twistId === null}
		<p class="tj-receipt__note">
			Filed with Tejido on {utc(entry.filedAt)}. We haven’t matched it to its public receipt yet.
		</p>
	{:else}
		<dl class="tj-kv">
			<div class="tj-kv__row">
				<dt>Transaction ID</dt>
				<dd>
					<span class="tj-id">{shortId(entry.twistId)}</span>{@render copyButton(
						'Transaction ID',
						entry.twistId
					)}
				</dd>
			</div>
			{#if entry.stampedAt}
				<div class="tj-kv__row">
					<dt>Recorded at</dt>
					<dd>
						<span
							>{utc(entry.stampedAt)}<span class="tj-kv__sub">Time on the public ledger</span></span
						>
					</dd>
				</div>
			{/if}
			<div class="tj-kv__row">
				<dt>Wallet that paid</dt>
				<dd>
					<span>
						<span class={['tj-id', 'tj-id--host', mismatch && 'tj-kv__mismatch']}
							>{@render host(entry.payingWallet ?? '')}</span
						>
						<span class="tj-kv__sub"
							>{mismatch
								? 'Doesn’t match the registered wallet'
								: 'Matches the registered wallet'}</span
						>
					</span>
				</dd>
			</div>
			{#if mismatch && registeredWallet}
				<div class="tj-kv__row">
					<dt>Registered wallet</dt>
					<dd><span class="tj-id tj-id--host">{@render host(registeredWallet)}</span></dd>
				</div>
			{/if}
			<div class="tj-kv__row">
				<dt>Milestone</dt>
				<dd>{milestone.position} · {milestone.title}</dd>
			</div>
		</dl>
	{/if}

	<details class="tj-disclosure">
		<summary>Technical details <Icon name="chevron-down" size={18} /></summary>
		<div class="tj-disclosure__body">
			<dl class="tj-kv" style="padding:0">
				{#if entry.twistId}
					<div class="tj-kv__row">
						<dt>Full transaction ID</dt>
						<dd>
							<span class="tj-id">{entry.twistId}</span>{@render copyButton(
								'Full transaction ID',
								entry.twistId
							)}
						</dd>
					</div>
				{/if}
				{#each entry.inputs.photos ?? [] as photo (photo.sha256)}
					<div class="tj-kv__row">
						<dt>File fingerprint · {photo.caption ?? 'file'}</dt>
						<dd>
							<span class="tj-id">{photo.sha256}</span>{@render copyButton(
								`Fingerprint ${photo.sha256.slice(0, 6)}`,
								photo.sha256
							)}
						</dd>
					</div>
				{/each}
				<div class="tj-kv__row">
					<dt>Entry</dt>
					<dd><span class="tj-id">{entry.id} · {entry.item}</span></dd>
				</div>
				<div class="tj-kv__row">
					<dt>Filed with Tejido</dt>
					<dd>{utc(entry.filedAt)}</dd>
				</div>
			</dl>
			<p class="tj-help">
				Fingerprints are SHA-256 hashes of each file. If a file changed, its fingerprint would too.
			</p>
		</div>
	</details>
	<p class="tj-vh" aria-live="polite">
		{copied && copied !== 'failed'
			? `${copied} copied`
			: copied === 'failed'
				? 'Copying didn’t work. Select the text instead.'
				: ''}
	</p>
</section>
