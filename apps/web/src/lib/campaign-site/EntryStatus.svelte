<script lang="ts">
	import type { EntryStatus } from '@tejido/contracts';
	import { ENTRY_STATUS } from './labels.ts';

	// The badge that says how far an entry can be trusted. The four statuses differ in shape
	// as well as colour: only `verified` and `flagged` are filled, and each has its own mark.
	let { status }: { status: EntryStatus } = $props();
</script>

<span class="badge {status}">
	<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
		{#if status === 'verified'}
			<path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.2" />
		{:else if status === 'flagged'}
			<path d="M8 1.5l7 12.5H1z" fill="none" stroke="currentColor" stroke-width="1.6" />
			<path d="M8 6v4M8 11.4v1.4" stroke="currentColor" stroke-width="1.8" />
		{:else if status === 'incomplete'}
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
	{ENTRY_STATUS[status].label}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 0.3rem;
		font-size: 0.8rem;
		font-weight: 650;
		line-height: 1.3;
		border-radius: 999px;
		padding: 2px 10px 2px 7px;
		border: 1.5px solid currentColor;
		white-space: nowrap;
	}
	svg {
		flex: none;
	}
	.verified {
		background: var(--a);
		border-color: var(--a);
		color: #fff;
	}
	.flagged {
		background: var(--warn);
		border-color: var(--warn);
		color: #fff;
	}
	.incomplete {
		color: var(--c);
		border-style: dashed;
	}
	.filed {
		color: var(--muted);
		border-style: dashed;
	}
</style>
