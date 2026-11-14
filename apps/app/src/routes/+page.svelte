<script lang="ts">
	import { Banner, Button, Icon, StatusBadge, type IconName } from '@tejido/ui';
	import { shortDay } from '#lib/dates.ts';
	import FieldPage from '#lib/FieldPage.svelte';
	import { CADENCE, ROLES, roleName } from '#lib/roles.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const milestones = $derived(data.viewer === 'party' ? data.milestones : []);
	/** What this person has to do themselves, soonest first. */
	const toDo = $derived(
		milestones.filter((milestone) => milestone.step === 'claim' || milestone.step === 'confirm')
	);
	const incomplete = $derived(data.viewer === 'party' ? data.incompleteReports : 0);
	const confirmer = $derived(data.viewer === 'party' && data.party.role === 'confirmer');

	/** The tasks, as large actions. Fixing appears only when there is something to fix. */
	const tasks = $derived.by(() => {
		const list: { href: string; icon: IconName; title: string; line: string; tone?: string }[] = [
			confirmer
				? {
						href: '/chat',
						icon: 'message',
						title: 'Confirm a milestone',
						line: 'A short conversation. You see what was reported, and nothing is filed until you say yes.'
					}
				: {
						href: '/chat',
						icon: 'message',
						title: 'File a report',
						line: 'A short conversation. You say what was done, and nothing is filed until you say yes.'
					},
			{
				href: '/upload',
				icon: 'camera',
				title: 'Add evidence',
				line: 'Take a photo or choose files to go with a report.'
			}
		];
		if (incomplete > 0) {
			list.push({
				href: '/fix',
				icon: 'receipt-missing',
				title:
					incomplete === 1 ? 'Fix 1 incomplete report' : `Fix ${incomplete} incomplete reports`,
				line: 'Something was missing when it arrived. Add it without paying again.',
				tone: 'attention'
			});
		}
		return list;
	});
</script>

<svelte:head><title>Tejido</title></svelte:head>

{#if data.viewer === 'signed_out'}
	<FieldPage title="Tejido" subtitle="Field app">
		<p class="text-eyebrow">Tejido field app</p>
		<h1>Report your work on a funded project</h1>
		<p class="tj-fieldpage__lede">
			Contractors, suppliers and confirmers use this app to report work, add photos and documents,
			and confirm milestones. Donors follow the project through what is filed here.
		</p>

		<div class="tj-card">
			<h2 class="app-cardtitle">Have an invitation?</h2>
			<p>
				Open the link in the invitation you were sent. It shows your project and your role, and
				signs you in to it. Use that link each time, so we know which project you are on.
			</p>
		</div>

		<p class="tj-plain">
			<Icon name="wallet" />
			<span>
				Signing in with Qatom from an invitation links two wallets to the project. No money moves
				when you sign in.
			</span>
		</p>

		{#snippet actions()}
			<Button variant="primary" size="field" block href="/auth/sign-in">Sign in with Qatom</Button>
			<p class="tj-help app-center">To file reports you also need an invitation to a project.</p>
		{/snippet}
	</FieldPage>
{:else if data.viewer === 'no_party'}
	<FieldPage title="Tejido" subtitle={data.email}>
		<p class="text-eyebrow">Signed in</p>
		<h1>You’re not on a project yet</h1>
		<p class="tj-fieldpage__lede app-wrap">
			You are signed in as {data.email}, but this sign-in is not connected to a project, so there is
			nothing for you to report on.
		</p>
		<Banner tone="neutral" icon="info" title="What to do">
			Open the link in the invitation you were sent and sign in from that page. That connects you to
			your project. If you have no invitation, ask the person running the project to send one to the
			email address you use with Qatom.
		</Banner>
	</FieldPage>
{:else}
	{@const { party, campaign } = data}
	<FieldPage
		title={campaign.title}
		subtitle="{party.name} · {roleName(party)}"
		tabs={{ current: '/', incompleteReports: incomplete }}
	>
		<p class="text-eyebrow">Your project</p>
		<h1>{campaign.title}</h1>
		<p class="tj-fieldpage__lede">
			{#if confirmer}
				{ROLES.confirmer.does}
			{:else}
				You log your work {CADENCE[campaign.cadence]} and report each milestone when it is done.
			{/if}
		</p>

		{#if !party.walletsLinked}
			<Banner
				tone="attention"
				icon="wallet"
				title="Finish linking your Qatom wallets"
				role="status"
			>
				Your wallets are not linked to this project yet, so you cannot file a report. Sign in once
				more to link them. No money moves when you sign in.
				{#snippet actions()}
					<Button size="field" href="/auth/sign-in?party={party.id}">Sign in with Qatom</Button>
				{/snippet}
			</Banner>
		{/if}

		<section class="tj-section" aria-labelledby="due">
			<h2 class="tj-section__title" id="due">Due next</h2>
			<div class="tj-card">
				{#each toDo as milestone (milestone.id)}
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
									<StatusBadge
										state="overdue"
										label={milestone.overdueDays === 1
											? 'Overdue · 1 day'
											: `Overdue · ${milestone.overdueDays} days`}
									/>
								</div>
							{/if}
						</div>
					</div>
				{:else}
					<div class="tj-mscard__row">
						<Icon name="check" size={18} />
						<div>
							<strong>No milestone is waiting on you</strong>
							<span>
								{#if confirmer}
									You will have something to confirm once work is reported as done.
								{:else}
									Nothing of yours is ready to report as done right now.
								{/if}
							</span>
						</div>
					</div>
				{/each}
				{#if !confirmer}
					<div class="tj-mscard__row">
						<Icon name="clock" size={18} />
						<div>
							<strong>Work log, {CADENCE[campaign.cadence]}</strong>
							<span>A short note on what was done, with photos if you have them.</span>
						</div>
					</div>
				{/if}
			</div>
		</section>

		<section class="tj-section" aria-labelledby="tasks">
			<h2 class="tj-section__title" id="tasks">What you can do</h2>
			<ul class="app-tasks">
				{#each tasks as task, index (task.href)}
					<li>
						<a
							class={[
								'app-task',
								index === 0 && 'app-task--primary',
								task.tone && `is-${task.tone}`
							]}
							href={task.href}
						>
							<Icon name={task.icon} size={24} />
							<span class="app-task__text">
								<strong>{task.title}</strong>
								<span>{task.line}</span>
							</span>
							<Icon name="chevron-right" />
						</a>
					</li>
				{/each}
			</ul>
		</section>

		{#if milestones.length > 0}
			<section class="tj-section" aria-labelledby="milestones">
				<div class="tj-section__head">
					<h2 class="tj-section__title" id="milestones">Your milestones</h2>
					<p class="tj-section__sub">
						{confirmer ? 'The ones you confirm' : 'The ones you report on'}
					</p>
				</div>
				<div class="tj-msrows">
					{#each milestones as milestone (milestone.id)}
						<div
							class={[
								'tj-msrow',
								`tj-tone--${milestone.overdueDays > 0 ? 'critical' : milestone.status === 'in-progress' ? 'progress' : milestone.status === 'confirmed' ? 'confirmed' : 'neutral'}`,
								milestone.status === 'confirmed' && 'tj-msrow--confirmed',
								milestone.status === 'claimed' && 'tj-msrow--claimed'
							]}
						>
							<span class="tj-msrow__n" aria-hidden="true">{milestone.position}</span>
							<div class="tj-msrow__main">
								<p class="tj-msrow__title">
									<span class="tj-vh">{`Milestone ${milestone.position}: `}</span>{milestone.title}
								</p>
								<p class="tj-msrow__meta">
									{#if milestone.step === 'done'}
										Confirmed. Nothing more to do.
									{:else if milestone.step === 'confirm'}
										Reported as done. Waiting for you to confirm.
									{:else if milestone.step === 'claim'}
										Due {shortDay(milestone.dueDate)}. Yours to report.
									{:else if milestone.part === 'owes'}
										You reported this as done. Confirmation is still pending.
									{:else}
										Due {shortDay(milestone.dueDate)}. You confirm it after it is reported.
									{/if}
								</p>
							</div>
							<div class="tj-msrow__status">
								<StatusBadge state={milestone.status} />
								{#if milestone.overdueDays > 0}
									<StatusBadge state="overdue" label="Overdue · {milestone.overdueDays}d" />
								{/if}
							</div>
						</div>
					{/each}
				</div>
			</section>
		{/if}

		<p class="tj-help app-wrap">Signed in with the Qatom account {data.email}.</p>
	</FieldPage>
{/if}

<style>
	.app-cardtitle {
		font: 600 17px/24px var(--font-sans);
	}
	.app-center {
		text-align: center;
	}
	.app-wrap {
		overflow-wrap: anywhere;
	}
	.app-rowbadges {
		margin-top: var(--space-2);
	}
	.app-tasks {
		display: grid;
		gap: var(--space-3);
	}
	/* One task: a whole row to press, at least 72px tall. Square corners like every button. */
	.app-task {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		gap: var(--space-3);
		align-items: center;
		min-height: 72px;
		padding: var(--space-3) var(--space-4);
		background: var(--surface);
		color: var(--text-primary);
		border: var(--border-control) solid var(--border-strong);
		border-radius: var(--radius-lg);
		text-decoration: none;
	}
	.app-task:hover {
		background-image: linear-gradient(var(--state-hover), var(--state-hover));
	}
	.app-task > :global(.tj-icon:first-child) {
		color: var(--accent);
	}
	.app-task > :global(.tj-icon:last-child) {
		color: var(--text-muted);
	}
	.app-task__text {
		display: grid;
		gap: 2px;
	}
	.app-task__text strong {
		font: 600 17px/24px var(--font-sans);
	}
	.app-task__text span {
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
	}
	.app-task--primary {
		background: var(--accent);
		border-color: var(--accent);
		color: var(--text-on-accent);
	}
	.app-task--primary:hover {
		background: var(--accent-hover);
		background-image: none;
	}
	.app-task--primary > :global(.tj-icon),
	.app-task--primary .app-task__text span {
		color: var(--text-on-accent) !important;
	}
	.app-task.is-attention {
		background: var(--status-attention-bg);
		border-color: var(--status-attention-border);
	}
	.app-task.is-attention > :global(.tj-icon:first-child) {
		color: var(--status-attention-icon);
	}
	.app-task.is-attention .app-task__text strong {
		color: var(--status-attention-text);
	}
</style>
