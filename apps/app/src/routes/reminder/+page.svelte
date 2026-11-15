<!--
	The reminder page (B4): where the link in a reminder lands. Track B owns this file.

	One thing is due, and one button opens the chat for exactly that. Signed out, the page names
	no project, person or milestone: it only offers sign-in, which comes back here.
-->
<script lang="ts">
	import { Banner, Button, Icon, StatusBadge } from '@tejido/ui';
	import { shortDay } from '#lib/dates.ts';
	import FieldPage from '#lib/FieldPage.svelte';
	import { CADENCE, roleName } from '#lib/roles.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const days = (count: number) => (count === 1 ? '1 day' : `${count} days`);
</script>

<svelte:head><title>Reminder · Tejido</title></svelte:head>

{#snippet row(milestone: {
	position: number;
	title: string;
	dueDate: string;
	step: string;
	overdueDays: number;
})}
	<div class="tj-mscard__row" class:tj-tone--critical={milestone.overdueDays > 0}>
		<Icon name={milestone.overdueDays > 0 ? 'ms-overdue' : 'calendar'} size={18} />
		<div>
			<strong>Milestone {milestone.position}: {milestone.title}</strong>
			<span>
				{#if milestone.step === 'confirm'}
					Reported as done. It is waiting for you to confirm it.
				{:else if milestone.overdueDays > 0}
					Was due {shortDay(milestone.dueDate)}. Report on it now.
				{:else}
					Due {shortDay(milestone.dueDate)}. Report it when it is done.
				{/if}
			</span>
			{#if milestone.overdueDays > 0}
				<div class="tj-badges app-rowbadges">
					<StatusBadge state="overdue" label="Overdue · {days(milestone.overdueDays)}" />
				</div>
			{/if}
		</div>
	</div>
{/snippet}

{#if data.viewer === 'signed_out'}
	<FieldPage title="Tejido" subtitle="Field app">
		<p class="text-eyebrow">Reminder</p>
		<h1>A report is due on a project</h1>
		<p class="tj-fieldpage__lede">
			Sign in to see which report is due from you, and by when. You come straight back to this page.
		</p>
		<p class="tj-plain">
			<Icon name="wallet" />
			<span>No money moves when you sign in.</span>
		</p>

		{#snippet actions()}
			<Button variant="primary" size="field" block href={data.signInHref}>
				Sign in with Qatom
			</Button>
		{/snippet}
	</FieldPage>
{:else if data.viewer === 'no_party'}
	<FieldPage title="Tejido" subtitle={data.email}>
		<p class="text-eyebrow">Reminder</p>
		<h1>You’re not on a project yet</h1>
		<p class="tj-fieldpage__lede app-wrap">
			You are signed in as {data.email}, but this sign-in is not connected to a project, so we
			cannot show what is due from you.
		</p>
		{#if data.signInHref}
			<Banner tone="neutral" icon="info" title="What to do">
				Sign in once more from here. That connects you to your project and brings you back to this
				page. No money moves when you sign in.
			</Banner>
		{:else}
			<Banner tone="neutral" icon="info" title="What to do">
				Open the link in the invitation you were sent and sign in from that page. That connects you
				to your project. Then open the link in your reminder again.
			</Banner>
		{/if}

		{#snippet actions()}
			{#if data.signInHref}
				<Button variant="primary" size="field" block href={data.signInHref}>
					Sign in with Qatom
				</Button>
			{:else}
				<Button size="field" block href="/">Go to the home page</Button>
			{/if}
		{/snippet}
	</FieldPage>
{:else}
	{@const { party, campaign, due } = data}
	<FieldPage title={campaign.title} subtitle="{party.name} · {roleName(party)}" back="/">
		<p class="text-eyebrow">Reminder</p>

		{#if due.kind === 'milestone'}
			{@const milestone = due.milestone}
			<h1>
				{#if milestone.step === 'confirm'}
					Milestone {milestone.position} is waiting for you to confirm
				{:else if milestone.overdueDays > 0}
					Milestone {milestone.position} was due {shortDay(milestone.dueDate)}
				{:else}
					Milestone {milestone.position} is due {shortDay(milestone.dueDate)}
				{/if}
			</h1>
			<p class="tj-fieldpage__lede">
				{#if milestone.step === 'confirm'}
					It has been reported as done. You see what was reported, then confirm it once you have
					seen it yourself.
				{:else if milestone.overdueDays > 0}
					It is {days(milestone.overdueDays)} overdue. Report on it now: say it is done, or log where
					the work stands.
				{:else}
					Report it when it is done. Until then you can log where the work stands.
				{/if}
			</p>
			<div class="tj-card">{@render row(milestone)}</div>
			<p class="tj-plain">
				<Icon name="message" />
				<span
					>A short conversation collects what is needed. Nothing is filed until you say yes.</span
				>
			</p>
		{:else if due.kind === 'work_log'}
			<h1>Your work log is due</h1>
			<p class="tj-fieldpage__lede">
				You log your work {CADENCE[campaign.cadence]}. It is a short note on what was done, with
				photos if you have them.
			</p>
			<div class="tj-card">
				<div class="tj-mscard__row">
					<Icon name="clock" size={18} />
					<div>
						<strong>Work log, {CADENCE[campaign.cadence]}</strong>
						<span>Due now.</span>
					</div>
				</div>
			</div>
			<p class="tj-plain">
				<Icon name="message" />
				<span
					>A short conversation collects what is needed. Nothing is filed until you say yes.</span
				>
			</p>
			{#if due.alsoDue && data.alsoDueHref}
				<section class="tj-section" aria-labelledby="also">
					<h2 class="tj-section__title" id="also">Also due from you</h2>
					<div class="tj-card">{@render row(due.alsoDue)}</div>
					<Button size="field" block href={data.alsoDueHref}>
						Open milestone {due.alsoDue.position}
					</Button>
				</section>
			{/if}
		{:else if due.why === 'not_yours'}
			<h1>This reminder is not for you</h1>
			<p class="tj-fieldpage__lede">
				The link names a milestone that is not one of yours on this project, or part of the link is
				missing. Nothing is due from you because of it.
			</p>
			<p class="tj-help">The home page shows what is due from you.</p>
		{:else if due.why === 'confirmed'}
			<h1>Milestone {due.milestone.position} is already confirmed</h1>
			<p class="tj-fieldpage__lede">
				{due.milestone.title} has been confirmed. There is nothing more to report on it.
			</p>
			<p class="tj-help">The home page shows what is due from you.</p>
		{:else if due.why === 'waiting'}
			<h1>Nothing is due from you on milestone {due.milestone.position}</h1>
			<p class="tj-fieldpage__lede">
				{#if due.milestone.part === 'owes'}
					You reported {due.milestone.title} as done. It is waiting for its confirmer.
				{:else}
					{due.milestone.title} has not been reported as done yet. You confirm it after that.
				{/if}
			</p>
			<p class="tj-help">The home page shows what is due from you.</p>
		{:else}
			<h1>Nothing is due from you right now</h1>
			<p class="tj-fieldpage__lede">
				{#if party.role === 'confirmer'}
					You will have something to confirm once work is reported as done.
				{:else}
					Every milestone you report on is confirmed, so there is no work to log.
				{/if}
			</p>
		{/if}

		{#snippet actions()}
			{#if due.kind === 'milestone' && data.chatHref}
				<Button variant="primary" size="field" block icon="message" href={data.chatHref}>
					{due.milestone.step === 'confirm' ? 'Review and confirm it' : 'Report on this milestone'}
				</Button>
			{:else if due.kind === 'work_log' && data.chatHref}
				<Button variant="primary" size="field" block icon="message" href={data.chatHref}>
					Log your work
				</Button>
			{:else}
				<Button variant="primary" size="field" block href="/">Go to the home page</Button>
			{/if}
		{/snippet}
	</FieldPage>
{/if}

<style>
	.app-wrap {
		overflow-wrap: anywhere;
	}
	.app-rowbadges {
		margin-top: var(--space-2);
	}
</style>
