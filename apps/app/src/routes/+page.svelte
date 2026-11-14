<script lang="ts">
	import { ROLES } from '#lib/roles.ts';
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
{#if data.signedIn}
	{@const { email, party, campaign } = data.signedIn}
	<section class="who">
		{#if party}
			<h2>Signed in as {party.name}</h2>
			<dl>
				{#if campaign}
					<dt>Campaign</dt>
					<dd>{campaign.title}</dd>
				{/if}
				<dt>Your role</dt>
				<dd>
					{ROLES[party.role].name}{#if party.title}&nbsp;· {party.title}{/if}
				</dd>
				<dt>Qatom account</dt>
				<dd>{email}</dd>
				<dt>Wallets</dt>
				<dd>
					{#if party.walletsLinked}
						Linked to this campaign
					{:else}
						Not linked yet. <a href="/invite/{party.id}">Open your invite</a> and sign in again.
					{/if}
				</dd>
			</dl>
		{:else}
			<h2>Signed in as {email}</h2>
			<p>
				You are signed in, but not on a campaign. To take part, open the invite link you were sent
				and sign in from there.
			</p>
		{/if}
		<form method="POST" action="/auth/sign-out">
			<button type="submit">Sign out</button>
		</form>
	</section>
{:else}
	<p class="lede">
		Not signed in. If you were invited to a campaign, open the invite link you were sent. Or
		<a href="/auth/sign-in">sign in with Qatom</a>.
	</p>
{/if}

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
		<code>GET /auth/sign-in</code>, <code>GET /auth/callback</code> and
		<code>POST /auth/sign-out</code>
		<p>Sign a person in with Qatom and store both wallet hostnames on their party.</p>
	</li>
	<li>
		<code>POST /api/evidence</code> and <code>GET /evidence/&#123;file&#125;</code>
		<p>
			Store a file and return its URL and SHA-256, then serve it back. Uploading needs a signed-in
			party.
		</p>
	</li>
</ul>

<style>
	.who {
		max-width: 44rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 0.25rem 1.25rem 1.1rem;
		margin: 1.25rem 0;
	}
	.who h2 {
		margin-top: 1rem;
	}
	.who dl {
		display: grid;
		grid-template-columns: max-content 1fr;
		gap: 0.4rem 1.25rem;
		margin: 0.75rem 0 1rem;
	}
	.who dt {
		color: var(--muted);
		font-size: 0.9rem;
	}
	.who dd {
		margin: 0;
	}
	button {
		font: inherit;
		font-weight: 600;
		color: var(--ink);
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 6px;
		padding: 0.45rem 0.9rem;
		cursor: pointer;
	}
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
