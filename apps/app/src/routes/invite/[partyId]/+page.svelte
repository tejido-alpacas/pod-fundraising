<script lang="ts">
	import { ROLES } from '#lib/roles.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const role = $derived(ROLES[data.party.role]);
</script>

<svelte:head><title>Your invite to {data.campaign.title} · Tejido App</title></svelte:head>

<article>
	<p class="eyebrow">Invitation</p>
	<h1>{data.party.name}, you are invited to “{data.campaign.title}”</h1>
	<p class="lede">
		{data.campaign.creatorName} named you on this fundraising campaign. Donors will follow the work through
		the reports filed here.
	</p>

	<dl>
		<dt>Campaign</dt>
		<dd>
			<strong>{data.campaign.title}</strong>
			{#if data.campaign.summary}<p>{data.campaign.summary}</p>{/if}
		</dd>
		{#if data.campaign.beneficiary}
			<dt>Who it is for</dt>
			<dd>{data.campaign.beneficiary}</dd>
		{/if}
		<dt>Invited</dt>
		<dd>
			<strong>{data.party.name}</strong>{#if data.party.title}, {data.party.title}{/if}
		</dd>
		<dt>Your role</dt>
		<dd>
			<strong>{role.name}</strong>
			<p>{role.does}</p>
		</dd>
		<dt>Invite sent to</dt>
		<dd>{data.party.emailHint}</dd>
	</dl>

	{#if data.signedInAsThisParty}
		<p class="note">You are already signed in on this invite, and your wallets are linked.</p>
		<p><a class="button" href="/">Continue to the App</a></p>
	{:else}
		<h2>Accept by signing in with Qatom</h2>
		<p>
			Sign in with the email address this invite was sent to. Signing in links your two Qatom
			wallets to this campaign: the one your reports are paid from, and the one your deposits are
			returned to. No money moves when you sign in.
		</p>
		{#if data.party.walletsLinked}
			<p class="note">
				Wallets are already linked for this invite. Signing in again signs you in on this device and
				keeps them up to date.
			</p>
		{/if}
		<p><a class="button" href="/auth/sign-in?party={data.party.id}">Sign in with Qatom</a></p>
	{/if}
</article>

<style>
	article {
		max-width: 44rem;
	}
	.lede {
		color: var(--muted);
	}
	dl {
		display: grid;
		grid-template-columns: minmax(7rem, max-content) 1fr;
		gap: 0.75rem 1.25rem;
		background: var(--surface);
		border: 1px solid var(--line);
		border-radius: 8px;
		padding: 1rem 1.25rem;
		margin: 1.5rem 0;
	}
	dt {
		color: var(--muted);
		font-size: 0.9rem;
	}
	dd {
		margin: 0;
	}
	dd p {
		margin: 0.2rem 0 0;
		font-size: 0.9rem;
		color: var(--muted);
	}
	.note {
		border-left: 3px solid var(--line);
		padding-left: 0.75rem;
		color: var(--muted);
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
	@media (max-width: 32rem) {
		dl {
			grid-template-columns: 1fr;
			gap: 0.15rem;
		}
		dd {
			margin-bottom: 0.6rem;
		}
	}
</style>
