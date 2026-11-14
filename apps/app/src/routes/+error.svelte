<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head
	><title>{page.status === 404 ? 'Not found' : 'Something went wrong'} · Tejido App</title
	></svelte:head
>

<article>
	<p class="eyebrow">{page.status}</p>
	<h1>{page.status === 404 ? 'We could not find that' : 'Something went wrong'}</h1>
	<p>{page.error?.message}</p>
	<p><a href="/">Go to the App's home page</a></p>
</article>

<style>
	article {
		max-width: 40rem;
	}
</style>
