<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head
	><title>{page.status === 404 ? 'Not found' : 'Something went wrong'} · Tejido</title></svelte:head
>

<article>
	<h1>{page.status === 404 ? 'We could not find that' : 'Something went wrong'}</h1>
	{#if page.status === 404 && page.error?.message === 'Not Found'}
		<p>
			There is no page at this address. If you followed a link, it may have been cut short; open it
			again from the message it came in.
		</p>
	{:else}
		<p>{page.error?.message}</p>
	{/if}
	<p><a class="button" href="/">Go to the home page</a></p>
</article>

<style>
	article {
		max-width: 40rem;
	}
	.button {
		display: inline-flex;
		align-items: center;
		background: var(--a);
		color: var(--surface);
		font-weight: 600;
		text-decoration: none;
		padding: 0 1.1rem;
		border-radius: 6px;
	}
</style>
