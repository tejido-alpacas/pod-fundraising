<!--
  FundingProgress: money given, against the goal. A continuous ink bar with a percentage, drawn
  nothing like delivery (segments, no percentage) and never in a status colour.

  Give it funding only when it is known. "Not known" is not zero: the page shows nothing then.

  <FundingProgress funding={data.funding} />
  <FundingProgress funding={campaign.funding} compact />
-->
<script lang="ts">
	import { formatAmount, fundingPercent, type FundingSummary } from '@tejido/contracts';

	let {
		funding,
		compact = false
	}: {
		funding: Extract<FundingSummary, { state: 'known' }>;
		/** One line and the bar, for a campaign card. */
		compact?: boolean;
	} = $props();

	/** "12,000.00": the amount as `formatAmount` writes it, with the thousands grouped. */
	function amount(value: number): string {
		const [whole = '', fraction] = formatAmount(value).split('.');
		const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return fraction === undefined ? grouped : `${grouped}.${fraction}`;
	}

	const UNIT = 'USD-TDN';
	const raised = $derived(amount(funding.raised));
	const goal = $derived(funding.goal === null ? null : amount(funding.goal));
	const percent = $derived(
		funding.goal === null ? null : fundingPercent(funding.goal, funding.raised)
	);
	const contributions = $derived(
		`${funding.donations.toLocaleString('en-GB')} ${funding.donations === 1 ? 'contribution' : 'contributions'}`
	);
	const spoken = $derived(
		goal === null
			? `${raised} ${UNIT} raised`
			: `${raised} ${UNIT} raised of a ${goal} ${UNIT} goal, ${percent} percent`
	);
</script>

<div class="tj-funding">
	{#if !compact}<p class="text-eyebrow">Funding</p>{/if}
	<p class="tj-funding__amount">
		<span class={compact ? 'figure' : 'text-figure'}>{raised}</span>
		<span>{UNIT} raised{goal === null ? '' : ` of ${goal} goal`}</span>
	</p>
	{#if funding.goal !== null && percent !== null}
		<div
			class="tj-bar"
			role="progressbar"
			aria-label="Funding"
			aria-valuenow={Math.min(funding.raised, funding.goal)}
			aria-valuemin={0}
			aria-valuemax={funding.goal}
			aria-valuetext={spoken}
		>
			<span style:--value="{Math.min(percent, 100)}%"></span>
		</div>
		<p class="tj-funding__meta">{percent}% funded · {contributions}</p>
	{:else}
		<p class="tj-funding__meta">{contributions} · no goal has been set</p>
	{/if}
</div>

<style>
	.tj-funding__amount {
		overflow-wrap: anywhere;
	}
	.figure {
		font-weight: 600;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
</style>
