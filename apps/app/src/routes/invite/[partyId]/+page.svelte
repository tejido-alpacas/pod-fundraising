<script lang="ts">
	import { Banner, Button, Icon } from '@tejido/ui';
	import { shortDay } from '#lib/dates.ts';
	import FieldPage from '#lib/FieldPage.svelte';
	import { CADENCE, ROLES, roleName } from '#lib/roles.ts';
	import Strength from '#lib/Strength.svelte';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const role = $derived(ROLES[data.party.role]);
	const confirmer = $derived(data.party.role === 'confirmer');
	const signIn = $derived(`/auth/sign-in?party=${data.party.id}`);
</script>

<svelte:head><title>Your invitation to {data.campaign.title} · Tejido</title></svelte:head>

<FieldPage>
	<p class="text-eyebrow">You’re invited</p>
	<h1>
		{data.party.name}, you’re invited to
		{confirmer ? 'confirm milestones' : 'report your work'} on “{data.campaign.title}”
	</h1>
	<p class="tj-fieldpage__lede">
		{data.campaign.creatorName} named you on this project. Donors follow the work through what is filed
		here, and they will see your name and your role.
	</p>

	{#if data.signedInAsThisParty}
		<Banner tone="neutral" icon="check" title="You are signed in on this invitation" role="status">
			Your wallets are linked. There is nothing more to do on this page.
		</Banner>
	{:else if data.party.walletsLinked}
		<Banner tone="neutral" icon="wallet" title="Wallets are already linked for this invitation">
			Signing in again signs you in on this phone and keeps them up to date. Nothing else changes.
		</Banner>
	{/if}

	<div class="tj-card">
		<dl class="tj-dl">
			<div>
				<dt>Project</dt>
				<dd>
					{data.campaign.title}
					{#if data.campaign.summary}<p class="tj-help">{data.campaign.summary}</p>{/if}
				</dd>
			</div>
			{#if data.campaign.beneficiary}
				<div>
					<dt>Who it is for</dt>
					<dd>{data.campaign.beneficiary}</dd>
				</div>
			{/if}
			<div>
				<dt>Your role</dt>
				<dd>
					<strong>{roleName(data.party)}.</strong>
					{role.does}
					{#if !confirmer}Your work log is due {CADENCE[data.campaign.cadence]}.{/if}
				</dd>
			</div>
			<div>
				<dt>{confirmer ? 'The milestones you confirm' : 'The milestones you report on'}</dt>
				<dd>
					{#if data.milestones.length === 0}
						None has been given to you yet. {data.campaign.creatorName} can add them.
					{:else}
						<ul class="app-milestones">
							{#each data.milestones as milestone (milestone.id)}
								<li>
									<span class="app-milestones__n" aria-hidden="true">{milestone.position}</span>
									<span>
										<span class="tj-vh">Milestone {milestone.position}: </span>{milestone.title}
										<small>Due {shortDay(milestone.dueDate)}</small>
									</span>
								</li>
							{/each}
						</ul>
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
				<dt>Invitation sent to</dt>
				<dd class="app-wrap">{data.party.emailHint}</dd>
			</div>
		</dl>
	</div>

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
	.app-milestones {
		display: grid;
		gap: var(--space-2);
		margin-top: var(--space-1);
	}
	.app-milestones li {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr);
		gap: var(--space-3);
		align-items: start;
	}
	.app-milestones__n {
		width: 24px;
		height: 24px;
		display: grid;
		place-items: center;
		border: var(--border-thread) solid var(--border-strong);
		border-radius: var(--radius-full);
		font: 600 13px/1 var(--font-sans);
		color: var(--text-secondary);
	}
	.app-milestones small {
		display: block;
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
	}
</style>
