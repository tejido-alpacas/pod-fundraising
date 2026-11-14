<script lang="ts">
	import { Banner, Button, Icon } from '@tejido/ui';
	import FieldPage from '#lib/FieldPage.svelte';
	import { CADENCE, ROLES, roleName } from '#lib/roles.ts';
	import Strength from '#lib/Strength.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const role = $derived(ROLES[data.party.role]);
	const confirmer = $derived(data.party.role === 'confirmer');
	/** Between milestones on one line. Its spaces must survive. */
	const SEPARATOR = ' · ';
	const signIn = $derived(`/auth/sign-in?party=${data.party.id}`);
</script>

<svelte:head><title>Your invitation to {data.campaign.title} · Tejido</title></svelte:head>

<FieldPage title="Invitation" subtitle="Tejido field app">
	<p class="text-eyebrow">You’re invited</p>
	<h1>
		{data.party.name}, you’re invited to
		{confirmer ? 'confirm milestones' : 'report your work'} on “{data.campaign.title}”
	</h1>
	<p class="tj-fieldpage__lede">
		{data.campaign.creatorName} named you on this project. Donors follow the work through what is filed
		here, and they will see your name and your role.
	</p>

	<div class="tj-card">
		<dl class="tj-dl">
			<div>
				<dt>Project</dt>
				<dd>
					{data.campaign.title}{#if data.campaign.beneficiary}, for {data.campaign.beneficiary.replace(
							/^The /,
							'the '
						)}{/if}
				</dd>
			</div>
			<div>
				<dt>Your role</dt>
				<dd>
					<strong>{roleName(data.party)}.</strong>
					{role.does}
					{#if !confirmer}Your work log is due {CADENCE[data.campaign.cadence]}.{/if}
				</dd>
			</div>
			<div>
				<dt>{confirmer ? 'Your milestones to confirm' : 'Your milestones to report on'}</dt>
				<dd>
					{#if data.milestones.length === 0}
						None has been given to you yet. {data.campaign.creatorName} can add them.
					{:else}
						{#each data.milestones as milestone, index (milestone.id)}{#if index > 0}{SEPARATOR}{/if}<span
								class="app-nowrap"><span class="tj-vh">Milestone </span>{milestone.position}</span
							>
							{milestone.title}{/each}
					{/if}
				</dd>
			</div>
			{#if data.party.shownAs}
				<div>
					<dt>Shown to donors as</dt>
					<dd>
						<Strength
							relationship={data.party.shownAs.relationship}
							who={data.party.shownAs.reason}
						/>
						<p class="tj-help app-strengthnote">
							This describes how you relate to the project. It is not a score.
						</p>
					</dd>
				</div>
			{:else}
				<div>
					<dt>Shown to donors as</dt>
					<dd>
						{data.party.name}, {roleName(data.party).toLowerCase()}, on every report you file.
					</dd>
				</div>
			{/if}
			<div>
				<dt>Invite sent to</dt>
				<dd class="app-wrap">{data.party.emailHint}</dd>
			</div>
		</dl>
	</div>

	{#if data.signedInAsThisParty}
		<Banner tone="neutral" icon="check" title="You are signed in on this invitation" role="status">
			Your wallets are linked. There is nothing more to do on this page.
		</Banner>
	{:else if data.party.walletsLinked}
		<Banner tone="neutral" icon="wallet" title="Wallets are already linked for this invitation">
			Signing in again signs you in on this phone and keeps them up to date. Nothing else changes.
		</Banner>
	{/if}

	<p class="tj-plain">
		<Icon name="wallet" />
		<span>
			Signing in links two Qatom wallets to this project: {role.deposit}. No money moves when you
			sign in. Use the email address this invitation was sent to.
		</span>
	</p>

	{#snippet actions()}
		{#if data.signedInAsThisParty}
			<Button variant="primary" size="field" block href="/">Go to your project</Button>
			<Button variant="quiet" size="field" block href={signIn}>
				Asked to sign in again? Sign in with Qatom
			</Button>
		{:else}
			<Button variant="primary" size="field" block href={signIn}>Sign in with Qatom</Button>
		{/if}
	{/snippet}
</FieldPage>

<style>
	.app-wrap {
		overflow-wrap: anywhere;
	}
	.app-strengthnote {
		margin-top: var(--space-2);
	}
	.app-nowrap {
		white-space: nowrap;
		font-weight: 600;
	}
</style>
