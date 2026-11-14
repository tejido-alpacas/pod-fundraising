<!--
	The first site's line icons, drawn the same way: 24 by 24, stroked in the text colour.
	Decorative only, so screen readers skip them; the text next to each says what it means.
-->
<script lang="ts" module>
	export type IconName =
		| 'home'
		| 'search'
		| 'heart'
		| 'bolt'
		| 'proof'
		| 'check'
		| 'people'
		| 'pin'
		| 'globe'
		| 'arrow'
		| 'info'
		| 'funds';
</script>

<script lang="ts">
	let { name, size = 20 }: { name: IconName; size?: number } = $props();
</script>

<svg
	class="i"
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	{#if name === 'home'}
		<path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" />
	{:else if name === 'search'}
		<circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" />
	{:else if name === 'heart'}
		<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
	{:else if name === 'bolt'}
		<path d="M13 2L4 14h7l-1 8 9-12h-7z" />
	{:else if name === 'proof'}
		<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" />
	{:else if name === 'check'}
		<path d="M5 12.5l4.5 4.5L19 7" />
	{:else if name === 'people'}
		<circle cx="9" cy="8" r="3.5" /><path d="M2.5 20c.8-3.5 3.3-5.5 6.5-5.5s5.7 2 6.5 5.5" /><circle
			cx="17"
			cy="9"
			r="2.5"
		/><path d="M17 14c2.5 0 4 1.6 4.5 4.5" />
	{:else if name === 'pin'}
		<path d="M12 21s-7-6.1-7-11.5a7 7 0 0 1 14 0C19 14.9 12 21 12 21z" /><circle
			cx="12"
			cy="9.5"
			r="2.5"
		/>
	{:else if name === 'globe'}
		<circle cx="12" cy="12" r="9" /><path
			d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"
		/>
	{:else if name === 'arrow'}
		<path d="M5 12h14M13 6l6 6-6 6" />
	{:else if name === 'info'}
		<circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5v.5" />
	{:else}
		<circle cx="12" cy="12" r="9" /><path
			d="M15 9.5c-.5-1-1.6-1.5-3-1.5-1.7 0-3 .8-3 2s1.3 1.7 3 2 3 .8 3 2-1.3 2-3 2c-1.4 0-2.5-.5-3-1.5M12 6v2M12 16v2"
		/>
	{/if}
</svg>
