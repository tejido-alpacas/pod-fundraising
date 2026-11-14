<script lang="ts">
	import { SURFACES } from '#lib/surfaces.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head><title>Tejido App</title></svelte:head>

<p class="eyebrow">Track B · App</p>
<h1>The App</h1>
<p class="lede">
	Where third parties and confirmers onboard, upload evidence and file through their agent. It is
	its own deployment, at app.tejido.net, and all of <code>apps/app</code> belongs to Track B.
</p>
<p class="lede">
	{#if data.signedInAs}
		Signed in as <strong>{data.signedInAs}</strong>.
	{:else}
		Not signed in. <a href="/auth/sign-in">Sign in with Qatom</a>
	{/if}
</p>

<ul>
	{#each SURFACES as surface (surface.id)}
		<li>
			<span class="id">{surface.id}</span>
			<a href={surface.path}>{surface.name}</a>
			{#if surface.working}<span class="working">working</span>{/if}
			<p>{surface.what}</p>
		</li>
	{/each}
</ul>

<h2>Server routes that already run</h2>
<ul>
	<li>
		<code>GET /auth/sign-in</code> and <code>GET /auth/callback</code>
		<p>Sign a person in with Qatom and store both wallet hostnames on their party.</p>
	</li>
	<li>
		<code>POST /api/evidence</code> and <code>GET /evidence/&#123;file&#125;</code>
		<p>Store a file and return its URL and SHA-256, then serve it back.</p>
	</li>
</ul>

<style>
	.lede {
		max-width: 44rem;
		color: var(--muted);
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 1.25rem 0 0;
		display: grid;
		gap: 0.9rem;
		max-width: 44rem;
	}
	li p {
		margin: 0.15rem 0 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.id {
		font-family: ui-monospace, monospace;
		font-size: 0.8rem;
		color: var(--muted);
		margin-right: 0.35rem;
	}
	.working {
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--surface);
		background: var(--b);
		border-radius: 999px;
		padding: 1px 8px;
		margin-left: 0.35rem;
	}
</style>
