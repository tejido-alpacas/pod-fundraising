<script lang="ts">
	import { page } from '$app/state';

	const notFound = $derived(page.status === 404);
	// Our own pages say what was not found ("There is no campaign at this address."). A path
	// that matches no page at all carries only the bare "Not Found", which adds nothing.
	const detail = $derived(
		notFound && page.error && page.error.message !== 'Not Found' ? page.error.message : null
	);
</script>

<svelte:head>
	<title>{notFound ? 'Page not found' : 'Something went wrong'} · Tejido</title>
</svelte:head>

<section class="error">
	{#if notFound}
		<h1>We could not find that page</h1>
		<p>
			{detail ?? 'There is nothing at this address.'} The link may be out of date, or the address may
			have been mistyped.
		</p>
	{:else}
		<h1>Something went wrong</h1>
		<p>This page could not be shown just now. Please try again in a moment.</p>
	{/if}
	<p><a class="home" href="/">See all campaigns</a></p>
</section>

<style>
	.error {
		max-width: 40rem;
	}
	.home {
		display: inline-flex;
		align-items: center;
		min-height: 2.75rem;
		padding: 0 1rem;
		border: 1.5px solid var(--a);
		border-radius: 8px;
		background: var(--surface);
		font-weight: 600;
		text-decoration: none;
	}
</style>
