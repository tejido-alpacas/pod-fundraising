<script lang="ts">
	import { page } from '$app/state';
	import { Button, ErrorPage } from '@tejido/ui';

	const notFound = $derived(page.status === 404);
	/** SvelteKit's own words for an address with no page. Ours are written for the person. */
	const ours = $derived(
		page.error?.message && page.error.message !== 'Not Found' ? page.error.message : null
	);
</script>

<svelte:head>
	<title>{notFound ? 'Not found' : 'Something went wrong'} · Tejido</title>
</svelte:head>

<div class="tj-fieldpage app-problem">
	<ErrorPage
		code={notFound ? 'Not found · 404' : 'Something went wrong'}
		title={notFound ? 'We can’t find that' : 'This page didn’t load'}
	>
		{#if ours}
			{ours}
		{:else if notFound}
			There is no page at this address. If you followed a link, it may have been cut short. Open it
			again from the message it came in. Nothing you filed has changed.
		{:else}
			It’s a problem on our side. Nothing you filed has changed. Try again in a minute.
		{/if}
		{#snippet actions()}
			<Button variant="primary" size="field" href="/">Go to the home page</Button>
			{#if !notFound}
				<Button variant="quiet" size="field" icon="retry" href={page.url.pathname}>Try again</Button
				>
			{/if}
		{/snippet}
	</ErrorPage>
</div>

<style>
	.app-problem {
		width: 100%;
		max-width: var(--layout-chat);
		margin-inline: auto;
		padding: 0;
	}
</style>
