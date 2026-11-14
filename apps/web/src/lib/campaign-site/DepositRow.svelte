<!--
  Filing deposits: the filer's own money, paid to record an entry and returned when the milestone
  is confirmed. Never a donation and never a payment for the work, and the row always says so.

  <DepositRow what="Filing deposit" amount={100} states={['dep-held']}>
    Paid by the filer to record this entry. Returned when milestone 2 is confirmed. It isn’t a donation or a payment for the work.
  </DepositRow>
-->
<script lang="ts">
	import { formatAmount } from '@tejido/contracts';
	import { Icon, StatusBadge } from '@tejido/ui';
	import type { Snippet } from 'svelte';
	import type { DepositStateKey } from './display.ts';

	let {
		what,
		amount,
		states,
		children
	}: {
		what: string;
		/** In the unit of every amount in our records. */
		amount: number;
		/** One badge for each state that applies. */
		states: DepositStateKey[];
		/** Why it was paid and what becomes of it. */
		children: Snippet;
	} = $props();
</script>

<div class="tj-deposit">
	<Icon name="deposit" />
	<p class="tj-deposit__what">{what}</p>
	<p class="tj-deposit__amt">{formatAmount(amount)}<small>USD-TDN</small></p>
	{#if states.length > 0}
		<div class="tj-badges">
			{#each states as state (state)}<StatusBadge {state} />{/each}
		</div>
	{/if}
	<p class="tj-deposit__why">{@render children()}</p>
</div>
