<!--
  ItemActions: move one item of a list up or down, or remove it. Every button names the item
  it acts on, for someone who cannot see which row it sits under.

  <ItemActions what="milestone 2" first={false} last onup={…} ondown={…} onremove={…} />
-->
<script lang="ts">
	import { Button } from '@tejido/ui';

	let {
		what,
		first = true,
		last = true,
		onup = undefined,
		ondown = undefined,
		onremove
	}: {
		what: string;
		first?: boolean;
		last?: boolean;
		onup?: (() => void) | undefined;
		ondown?: (() => void) | undefined;
		onremove: () => void;
	} = $props();
</script>

<div class="actions">
	{#if onup && ondown}
		<Button size="sm" variant="quiet" icon="arrow-up" disabled={first} onclick={onup}>
			Move up<span class="tj-vh"> {what}</span>
		</Button>
		<Button size="sm" variant="quiet" disabled={last} onclick={ondown}>
			Move down<span class="tj-vh"> {what}</span>
		</Button>
	{/if}
	<Button size="sm" variant="quiet" icon="x" onclick={onremove}>
		Remove<span class="tj-vh"> {what}</span>
	</Button>
</div>

<style>
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: var(--space-3);
	}
</style>
