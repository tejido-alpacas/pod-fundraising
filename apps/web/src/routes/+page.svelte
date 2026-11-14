<script lang="ts">
	import { SURFACES, TRACKS } from '#lib/surfaces.ts';
</script>

<svelte:head><title>Tejido · build index</title></svelte:head>

<p class="eyebrow">Build index</p>
<h1>Where each surface lives</h1>
<p class="lede">
	One list per track. Each link opens the surface with the fixture campaign loaded. A surface marked <strong
		>working</strong
	> runs today; the rest are placeholders that name the files to build in.
</p>

<div class="tracks">
	{#each TRACKS as track (track.id)}
		<section class="track track-{track.id}">
			<h2>Track {track.id} · {track.name}</h2>
			<p class="faces">{track.faces}</p>
			<p class="homes">
				{#each track.homes as home (home)}<code>{home}</code>
				{/each}
			</p>
			<ul>
				{#each SURFACES.filter((surface) => surface.track === track.id) as surface (surface.id)}
					<li>
						<span class="id">{surface.id}</span>
						<a href={surface.path}>{surface.name}</a>
						{#if surface.working}<span class="working">working</span>{/if}
						<p>{surface.what}</p>
					</li>
				{/each}
			</ul>
		</section>
	{/each}
</div>

<h2>Server routes that already run</h2>
<ul class="routes">
	<li><code>POST /api/checkins</code> Qatom calls this when an item is bought. Track C.</li>
	<li><code>POST /api/evidence</code> stores a file and returns its URL and SHA-256. Track B.</li>
	<li>
		<code>GET /auth/sign-in</code> and <code>GET /auth/callback</code> sign a person in with Qatom and
		store both wallet hostnames on their party. Track B.
	</li>
</ul>

<style>
	.lede {
		max-width: 44rem;
		color: var(--muted);
	}
	.tracks {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(17rem, 1fr));
		gap: 1rem;
		margin-top: 1.5rem;
	}
	.track {
		background: var(--surface);
		border: 1px solid var(--line);
		border-top: 4px solid var(--t);
		border-radius: 8px;
		padding: 1rem;
		min-width: 0;
	}
	.track-A {
		--t: var(--a);
	}
	.track-B {
		--t: var(--b);
	}
	.track-C {
		--t: var(--c);
	}
	.track h2 {
		margin: 0;
		font-size: 1.1rem;
		color: var(--t);
	}
	.faces {
		margin: 0.25rem 0;
		color: var(--muted);
	}
	.homes {
		font-size: 0.85rem;
		line-height: 2;
		margin: 0.5rem 0;
	}
	ul {
		list-style: none;
		padding: 0;
		margin: 0.75rem 0 0;
		display: grid;
		gap: 0.9rem;
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
		background: var(--a);
		border-radius: 999px;
		padding: 1px 8px;
		margin-left: 0.35rem;
	}
	.routes {
		max-width: 44rem;
		gap: 0.5rem;
	}
</style>
