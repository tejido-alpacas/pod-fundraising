<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>{data.title} · Tejido</title></svelte:head>

<article>
	<p class="eyebrow">Sign-in</p>
	<h1>{data.title}</h1>
	<p>{data.message}</p>

	{#if data.retry && data.partyId}
		<p><a class="button" href="/invite/{data.partyId}">Back to your invite</a></p>
	{:else if data.retry}
		<p><a class="button" href="/auth/sign-in">Try again</a></p>
	{/if}
	<p><a class="plain" href="/">Go to the home page</a></p>
</article>

<style>
	article {
		max-width: 40rem;
	}
	.plain {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
	}
	.button {
		display: inline-block;
		background: var(--a);
		color: var(--surface);
		font-weight: 600;
		text-decoration: none;
		padding: 0.6rem 1.1rem;
		border-radius: 6px;
	}
</style>
