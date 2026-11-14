<script lang="ts">
	import { surface } from './surfaces.ts';

	let { id }: { id: string } = $props();

	const here = $derived(surface(id));
</script>

<svelte:head><title>{here.name} · Tejido App</title></svelte:head>

<article class="placeholder">
	<p class="eyebrow">Track B · App · {here.id}</p>
	<h1>{here.name}</h1>
	<p>{here.what}</p>

	<p class="status">Placeholder. Nothing is built here yet.</p>

	<h2>Where the work goes</h2>
	<ul>
		{#each here.files as file (file)}
			<li><code>{file}</code></li>
		{/each}
	</ul>
</article>

<style>
	.placeholder {
		max-width: 44rem;
	}
	.status {
		border-left: 3px solid var(--line);
		padding-left: 0.75rem;
		color: var(--muted);
	}
</style>
