<!--
  StepReview: everything the organiser entered, in plain words, as a summary to check at a
  glance. Each section is a card: its Edit button sits beside its heading, and its facts are
  label and value pairs laid out across the card's width. On a phone it is one column.
  Nothing is editable here.

  <StepReview {draft} {notices} />
-->
<script lang="ts">
	import { cadenceLabel, formatAmount } from '@tejido/contracts';
	import { Banner } from '@tejido/ui';
	import { readCadence, readGoal } from './check.ts';
	import type { BuilderDraft, Notice, Step } from './draft.ts';
	import {
		cadenceHelp,
		KIND_LABEL,
		RELATIONSHIP_LABEL,
		STEP_NAME,
		UNIT,
		formatDue
	} from './words.ts';

	let { draft, notices }: { draft: BuilderDraft; notices: Notice[] } = $props();

	const MISSING = 'Not given yet';
	/** The cadence once it is one. Chosen days with no day picked yet are still missing. */
	const cadence = $derived.by(() => {
		const read = readCadence(draft.schedule.cadence);
		return read.ok ? read.value : null;
	});
	const shown = (value: string) => value.trim() || MISSING;

	/** "12,000.00 USD-TDN", or what is wrong with what was typed. */
	const goal = $derived.by(() => {
		const read = readGoal(draft.funding.goal);
		if (!read.ok) return shown(draft.funding.goal);
		if (read.value === null) return 'No goal set';
		const [whole = '', fraction = ''] = formatAmount(read.value).split('.');
		return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction} ${UNIT}`;
	});

	const person = (key: string) => draft.people.find((candidate) => candidate.key === key);
	const nameOf = (key: string) => person(key)?.name.trim() || 'Nobody chosen yet';
	const workers = $derived(draft.people.filter((candidate) => candidate.role === 'third_party'));
	const confirmers = $derived(draft.people.filter((candidate) => candidate.role === 'confirmer'));
</script>

{#snippet head(step: Step, id: string)}
	<!-- The first site's button (`btn`, from the root stylesheet), right beside the heading. -->
	<div class="head">
		<h2 class="tj-section__title" {id}>{STEP_NAME[step]}</h2>
		<a class="btn btn-ghost btn-sm edit" href="?step={step}">
			Edit<span class="tj-vh"> {STEP_NAME[step].toLowerCase()}</span>
		</a>
	</div>
{/snippet}

<section class="tj-card" aria-labelledby="review-project">
	{@render head('project', 'review-project')}
	<dl class="tj-dl facts">
		<div>
			<dt>Project name</dt>
			<dd>{shown(draft.project.title)}</dd>
		</div>
		<div>
			<dt>What it is</dt>
			<dd class="long">{draft.project.summary.trim() || 'No description'}</dd>
		</div>
		<div>
			<dt>Who it is for</dt>
			<dd>{draft.project.beneficiary.trim() || 'Not said'}</dd>
		</div>
		<div>
			<dt>Organised by</dt>
			<dd>{shown(draft.project.creatorName)}</dd>
		</div>
		<div>
			<dt>Organiser’s email, kept private</dt>
			<dd>{shown(draft.project.creatorEmail)}</dd>
		</div>
	</dl>
</section>

<section class="tj-card" aria-labelledby="review-funding">
	{@render head('funding', 'review-funding')}
	<dl class="tj-dl facts">
		<div>
			<dt>Goal</dt>
			<dd>{goal}</dd>
		</div>
	</dl>
</section>

<section class="tj-card" aria-labelledby="review-milestones">
	{@render head('milestones', 'review-milestones')}
	{#if draft.milestones.length === 0}
		<p>No milestones yet.</p>
	{:else}
		<ol class="items">
			{#each draft.milestones as milestone, index (milestone.key)}
				<li>
					<p class="item-title">{index + 1}. {shown(milestone.title)}</p>
					{#if milestone.description.trim()}<p class="long">{milestone.description.trim()}</p>{/if}
					<dl class="tj-dl pairs">
						<div>
							<dt>Kind</dt>
							<dd>{milestone.kind === '' ? 'Kind not chosen' : KIND_LABEL[milestone.kind]}</dd>
						</div>
						<div>
							<dt>Due</dt>
							<dd>{milestone.dueDate === '' ? 'No due date yet' : formatDue(milestone.dueDate)}</dd>
						</div>
						<div>
							<dt>Work by</dt>
							<dd>{nameOf(milestone.ownerKey)}</dd>
						</div>
						<div>
							<dt>Confirmed by</dt>
							<dd>{nameOf(milestone.confirmerKey)}</dd>
						</div>
					</dl>
				</li>
			{/each}
		</ol>
	{/if}
</section>

<section class="tj-card" aria-labelledby="review-people">
	{@render head('people', 'review-people')}
	{#if draft.people.length === 0}
		<p>Nobody has been added yet.</p>
	{:else}
		<dl class="tj-dl columns">
			<div>
				<dt>Who does the work</dt>
				{#each workers as worker (worker.key)}
					<dd>{shown(worker.name)}{worker.title.trim() ? `, ${worker.title.trim()}` : ''}</dd>
				{:else}
					<dd>Nobody yet</dd>
				{/each}
			</div>
			<div>
				<dt>Who confirms</dt>
				{#each confirmers as confirmer (confirmer.key)}
					<dd>
						{shown(confirmer.name)}{confirmer.title.trim() ? `, ${confirmer.title.trim()}` : ''}
						<span class="item-meta">
							{confirmer.relationship === ''
								? 'Relationship not chosen'
								: `Shown to donors as: ${RELATIONSHIP_LABEL[confirmer.relationship].toLowerCase()}`}{confirmer.relationshipReason.trim()
								? `. “${confirmer.relationshipReason.trim()}”`
								: ''}
						</span>
					</dd>
				{:else}
					<dd>Nobody yet</dd>
				{/each}
			</div>
		</dl>
		<p class="tj-help">
			Each person’s invitation goes to the email address you entered for them. Those addresses are
			not shown to donors.
		</p>
	{/if}
</section>

<section class="tj-card" aria-labelledby="review-schedule">
	{@render head('schedule', 'review-schedule')}
	<dl class="tj-dl facts">
		<div>
			<dt>Work is reported</dt>
			<dd>
				{#if cadence}
					{cadenceLabel(cadence)}
					<span class="item-meta">{cadenceHelp(cadence)}</span>
				{:else}
					{MISSING}
				{/if}
			</dd>
		</div>
	</dl>
</section>

{#each notices as notice (notice.kind + notice.key)}
	<Banner
		tone={notice.kind === 'independent_may_benefit' ? 'attention' : 'neutral'}
		icon={notice.kind === 'independent_may_benefit' ? 'alert-triangle' : 'info'}
		title={notice.title}
		role="note"
	>
		{notice.body}
	</Banner>
{/each}

<Banner title="What “Create campaign” does" role="note">
	It saves the campaign as a draft. A draft is on no public list: only someone with its link can
	open it. No money moves, nothing is sent to Qatom and no email is sent. You get an invitation link
	for each person, to send yourself.
</Banner>

<style>
	section {
		overflow-wrap: anywhere;
	}
	/* The heading with its Edit button right beside it, not across the card from it. */
	.head {
		display: flex;
		flex-wrap: wrap;
		align-items: baseline;
		gap: var(--space-2) var(--space-3);
	}
	/* Big enough to press on a phone: the design system's 44px touch size. */
	.edit {
		min-height: var(--size-touch);
	}
	.tj-dl dd + dd {
		margin-top: var(--space-2);
	}
	/* One fact a row, each row ruled off from the next. On a phone the value sits under its label. */
	.facts {
		gap: 0;
	}
	.facts > div {
		display: grid;
		gap: var(--space-1) var(--space-4);
		padding-block: var(--space-3);
		border-top: var(--border-hair) solid var(--border);
	}
	.facts > div:last-child {
		padding-bottom: 0;
	}
	.items {
		display: grid;
	}
	.items li {
		display: grid;
		gap: var(--space-2);
		padding-block: var(--space-3);
		border-top: var(--border-hair) solid var(--border);
	}
	.items li:last-child {
		padding-bottom: 0;
	}
	/* A milestone's four facts, side by side where there is room: two across on a phone. */
	.pairs {
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: var(--space-3) var(--space-4);
	}
	.columns {
		gap: var(--space-4);
		padding-top: var(--space-3);
		border-top: var(--border-hair) solid var(--border);
	}
	.item-title {
		font: 600 16px/24px var(--font-sans);
	}
	.item-meta {
		display: block;
		font-size: 14px;
		line-height: 20px;
		color: var(--text-secondary);
	}
	.long {
		white-space: pre-line;
	}
	/*
		With room (the campaign pages are a size container), the card's width is used: label
		and value side by side, a milestone's four facts in one row, and the two groups of
		people in two columns.
	*/
	@container (min-width: 600px) {
		.facts > div {
			grid-template-columns: minmax(0, 13rem) minmax(0, 1fr);
			align-items: baseline;
		}
		.pairs {
			grid-template-columns: repeat(4, minmax(0, 1fr));
		}
		.columns {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
</style>
