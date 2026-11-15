<script lang="ts">
	import { formatAmount } from '@tejido/contracts';
	import { Banner, EmptyState, Icon, StatusBadge } from '@tejido/ui';
	import CampaignNav from '#lib/campaign-site/CampaignNav.svelte';
	import DepositRow from '#lib/campaign-site/DepositRow.svelte';
	import {
		CLAIM_REPORTED,
		STRENGTH_SHORT,
		count,
		day,
		daysBetween,
		entryKind,
		fullDay,
		list,
		lowerFirst,
		milestoneStatus,
		overdueLabel,
		type DepositStateKey
	} from '#lib/campaign-site/display.ts';
	import { strengthSummary } from '#lib/campaign-site/labels.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const today = $derived(data.today);
	const totals = $derived(data.totals);
	const base = $derived(`/campaigns/${data.campaign.id}`);
	const milestonePath = (id: string) => `${base}/milestones/${id}`;

	// ---- Each milestone, in the design system's vocabulary --------------------------------

	const rows = $derived(
		data.milestones.map((milestone) => {
			const status = milestoneStatus(milestone.state, milestone.entryCount > 0);
			return {
				milestone,
				status,
				// Overdue: the due date has passed and nobody has confirmed it. Nothing else is assumed.
				daysLate:
					!milestone.confirmed && milestone.dueDate < today
						? daysBetween(milestone.dueDate, today)
						: 0,
				/** How many days after its due date it was confirmed. Zero when on time. */
				confirmedLate: milestone.confirmedAt
					? Math.max(0, daysBetween(milestone.dueDate, milestone.confirmedAt))
					: 0,
				/** Deposits whose refund is outstanding, each with the reason. Read from the server. */
				outstanding: milestone.depositStates.filter(
					(deposit) => deposit.state === 'refund_outstanding'
				)
			};
		})
	);

	// ---- Deposits: held, refunded, refund outstanding -------------------------------------

	// The three states come from the server, which reads them from what is recorded.
	const held = $derived(totals.held);
	const outstanding = $derived(totals.outstanding);
	const depositStates = $derived<DepositStateKey[]>([
		...(totals.refunded > 0 ? (['dep-refunded'] as const) : []),
		...(outstanding > 0 ? (['dep-outstanding'] as const) : []),
		...(held > 0 ? (['dep-held'] as const) : [])
	]);
	const refundsSent = $derived(
		rows.flatMap((row) =>
			row.milestone.refunds
				.filter((refund) => refund.outcome === 'sent')
				.map((refund) => ({ ...refund, position: row.milestone.position }))
		)
	);

	// ---- Open items, and issues and corrections -------------------------------------------

	const filingOf = (
		item: 'log_work' | 'milestone_hit',
		claim: (typeof data.attention)[0]['claim']
	) => entryKind(item, claim).toLowerCase();
	const onMilestone = (position: number | null) =>
		position === null ? '' : ` on milestone ${position}`;

	/** What is still waiting on someone. A flagged filing is not one of these: it never clears. */
	const openItems = $derived([
		...data.attention
			.filter((entry) => entry.status === 'incomplete')
			.map((entry) => `an incomplete filing${onMilestone(entry.milestonePosition)}`),
		...data.attention
			.filter((entry) => entry.status === 'filed')
			.map(
				(entry) =>
					`a filing${onMilestone(entry.milestonePosition)} not yet matched to its public receipt`
			),
		...rows.flatMap((row) =>
			row.outstanding.map(
				(deposit) =>
					`a filing deposit refund of ${formatAmount(deposit.amount)} USD-TDN on milestone ${row.milestone.position}`
			)
		)
	]);

	interface Issue {
		/** Null for something with no single moment: it is listed last, as open. */
		at: string | null;
		title: string;
		text: string;
		href?: string;
		open?: boolean;
	}
	const issues = $derived.by(() => {
		const found: Issue[] = [];
		for (const entry of data.attention) {
			const what = `${entry.filedBy ?? 'A filer not on record'}’s ${filingOf(entry.item, entry.claim)}${onMilestone(entry.milestonePosition)}.`;
			if (entry.status === 'flagged') {
				found.push({
					at: entry.filedAt,
					title: 'A filing’s receipt doesn’t match it',
					text: `${what} The report itself may still be accurate. The filing stays flagged on the record.`,
					href: entry.proofPath
				});
			} else if (entry.status === 'incomplete') {
				found.push({
					at: entry.filedAt,
					title: 'A filing is incomplete',
					text: `${what} ${entry.statusReason ?? 'Something its milestone needs is missing.'} The filer can add it without paying again.`,
					href: entry.proofPath,
					open: true
				});
			} else {
				found.push({
					at: entry.filedAt,
					title: 'A filing hasn’t been matched to its public receipt yet',
					text: what,
					href: entry.proofPath,
					open: true
				});
			}
		}
		for (const { milestone, daysLate, confirmedLate, outstanding: refundsOwed } of rows) {
			const name = `Milestone ${milestone.position}, ${milestone.title},`;
			if (milestone.confirmedAt && confirmedLate > 0) {
				found.push({
					at: milestone.confirmedAt,
					title: `${name} was confirmed ${count(confirmedLate, 'day')} after its due date`,
					text: `Due ${day(milestone.dueDate, today)}, confirmed ${day(milestone.confirmedAt, today)}.`,
					href: milestonePath(milestone.id)
				});
			}
			if (milestone.state === 'confirmed_creator') {
				found.push({
					at: milestone.confirmedAt,
					title: `${name} was signed off by the organizer`,
					text: 'No confirmer answered in the waiting period, so the organizer confirmed it. That is a participant confirmation.',
					href: milestonePath(milestone.id),
					open: milestone.confirmedAt === null ? false : undefined
				});
			}
			if (daysLate > 0) {
				found.push({
					at: null,
					title: `${name} is overdue by ${count(daysLate, 'day')}`,
					text: `Due ${day(milestone.dueDate, today)}. Not confirmed.`,
					href: milestonePath(milestone.id),
					open: true
				});
			}
			for (const deposit of refundsOwed) {
				found.push({
					at: null,
					title: `Refund outstanding on milestone ${milestone.position}`,
					text: `A filing deposit of ${formatAmount(deposit.amount)} USD-TDN. ${deposit.outstandingMeaning ?? 'It hasn’t been returned to its filer yet.'} Donations are not affected.`,
					href: `${base}/entries/${deposit.entryId}`,
					open: true
				});
			}
		}
		const dated = found
			.filter((issue): issue is Issue & { at: string } => issue.at !== null)
			.sort((a, b) => a.at.localeCompare(b.at));
		return [...dated, ...found.filter((issue) => issue.at === null)];
	});

	const overdue = $derived(rows.filter((row) => row.daysLate > 0).length);
</script>

<svelte:head><title>Delivery report · {data.campaign.title} · Tejido</title></svelte:head>

<div class="tj-page" style:gap="var(--space-6)">
	<CampaignNav campaignId={data.campaign.id} title={data.campaign.title} current="report" />

	<div class="tj-pagehead">
		<p class="text-eyebrow">
			Delivery report ·
			{data.delivered && data.deliveredAt ? fullDay(data.deliveredAt) : `as of ${fullDay(today)}`}
		</p>
		<h1>{data.campaign.title}</h1>
		<p class="tj-pagehead__meta">
			{data.delivered
				? 'The final account of what was delivered and what is still open.'
				: 'Not the final report yet. This is what has been delivered so far and what is still outstanding.'}
		</p>
	</div>

	{#if totals.milestones === 0}
		<EmptyState icon="list" title="Nothing to report yet">
			No milestones have been set for this campaign. Once they are, this page shows each one, who
			confirmed it and what is still open.
		</EmptyState>
	{:else}
		{#if data.delivered}
			<Banner
				tone={openItems.length > 0 ? 'attention' : 'confirmed'}
				icon={openItems.length > 0 ? 'flag' : 'ms-confirmed'}
				role="note"
				title={openItems.length > 0
					? `Delivered, with ${count(openItems.length, 'open item')}`
					: 'Delivered'}
			>
				All {count(totals.milestones, 'milestone')}
				{totals.milestones === 1 ? 'is' : 'are'} confirmed{data.deliveredAt
					? `, the last on ${day(data.deliveredAt, today)}`
					: ''}: {strengthSummary(totals.byStrength)}.
				{#if openItems.length > 0}Still open: {list(openItems)}.{/if}
			</Banner>
		{:else}
			<Banner
				tone={overdue > 0 ? 'critical' : 'progress'}
				icon={overdue > 0 ? 'ms-overdue' : 'ms-in-progress'}
				role="note"
				title="Not delivered yet"
			>
				{totals.confirmed} of {count(totals.milestones, 'milestone')}
				{totals.confirmed === 1 ? 'is' : 'are'} confirmed.
				{count(data.outstanding.length, 'milestone')}
				{data.outstanding.length === 1 ? 'is' : 'are'} still outstanding{overdue > 0
					? `, ${overdue} of them overdue`
					: ''}.
				{#if openItems.length > 0}Also open: {list(openItems)}.{/if}
			</Banner>
		{/if}

		<div class="tj-figs">
			<div class="tj-fig">
				<p class="tj-fig__k">Milestones</p>
				<p class="tj-fig__v">{totals.confirmed} of {totals.milestones}</p>
				<p class="tj-fig__s">Confirmed</p>
			</div>
			<div class="tj-fig">
				<p class="tj-fig__k">Open items</p>
				<p class="tj-fig__v">{openItems.length}</p>
				<p class="tj-fig__s">
					{openItems.length === 0
						? 'Nothing is waiting on anyone'
						: 'Listed under Issues and corrections'}
				</p>
			</div>
			<div class="tj-fig">
				<p class="tj-fig__k">Deposits refunded</p>
				<p class="tj-fig__v">{formatAmount(totals.refunded)}</p>
				<p class="tj-fig__s">USD-TDN of {formatAmount(totals.paid)} paid by filers</p>
			</div>
			<div class="tj-fig">
				<p class="tj-fig__k">Deposits not returned</p>
				<p class="tj-fig__v">{formatAmount(held + outstanding)}</p>
				<p class="tj-fig__s">
					{formatAmount(held)} held · {formatAmount(outstanding)} refund outstanding
				</p>
			</div>
		</div>
	{/if}

	<section class="tj-section" aria-labelledby="goal">
		<h2 class="tj-section__title" id="goal">The original goal</h2>
		<div class="tj-quote">
			{#if data.campaign.summary}
				<blockquote class="summary">{data.campaign.summary}</blockquote>
			{/if}
			<div class="tj-entry__facts">
				{#if data.campaign.beneficiary}
					<span><Icon name="users" size={16} />For {lowerFirst(data.campaign.beneficiary)}</span>
				{/if}
				<span><Icon name="user" size={16} />Organized by {data.campaign.creatorName}</span>
			</div>
		</div>
	</section>

	{#if !data.delivered && data.outstanding.length > 0}
		<section class="tj-section" aria-labelledby="outstanding">
			<h2 class="tj-section__title" id="outstanding">Still outstanding</h2>
			<ul class="tj-checklist">
				{#each rows.filter((row) => !row.milestone.confirmed) as { milestone, status, daysLate } (milestone.id)}
					<li class={{ 'is-missing': daysLate > 0 }}>
						<Icon name={daysLate > 0 ? 'alert-circle' : 'clock'} />
						<span>
							Milestone {milestone.position}, {milestone.title}:
							{#if status === 'claimed'}
								reported as done{milestone.owner ? ` by ${milestone.owner.name}` : ''}, waiting for
								{milestone.namedConfirmer?.name ?? 'its confirmer'} to confirm it.
							{:else}
								not reported as done yet{milestone.owner
									? `. ${milestone.owner.name} does the work`
									: ''}.
							{/if}
							{daysLate > 0
								? `Overdue by ${count(daysLate, 'day')}.`
								: `Due ${day(milestone.dueDate, today)}.`}
						</span>
					</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if rows.length > 0}
		<section class="tj-section" aria-labelledby="delivered">
			<h2 class="tj-section__title" id="delivered">Planned and delivered</h2>
			<div class="tj-outcome">
				{#each rows as { milestone, status, daysLate, confirmedLate } (milestone.id)}
					<div class="tj-outcome__row" id={milestone.id}>
						<p class="tj-outcome__title">
							<span class="tj-muted">{milestone.position} ·</span>
							<a class="tj-link tj-link--quiet" href={milestonePath(milestone.id)}
								>{milestone.title}</a
							>
						</p>
						<dl class="tj-outcome__cmp">
							<div>
								<dt>Planned</dt>
								<dd>
									{milestone.description ? `${milestone.description} ` : ''}By {day(
										milestone.dueDate,
										today
									)}.
								</dd>
							</div>
							<div>
								{#if milestone.confirmed}
									<dt>Delivered</dt>
									<dd>
										{#if milestone.reported && milestone.reported.quantity !== null}
											{milestone.reported.quantity}{milestone.reported.unit
												? ` ${milestone.reported.unit}`
												: ''}, as reported.
										{/if}
										Confirmed{milestone.confirmedAt
											? ` ${day(milestone.confirmedAt, today)}`
											: ''}{confirmedLate > 0 ? `, ${count(confirmedLate, 'day')} late` : ''}.
									</dd>
								{:else}
									<dt>Reported</dt>
									<dd>
										{#if milestone.reported && milestone.reported.claim !== 'confirm'}
											{CLAIM_REPORTED[milestone.reported.claim]}{milestone.reported.quantity ===
											null
												? ''
												: `: ${milestone.reported.quantity}${milestone.reported.unit ? ` ${milestone.reported.unit}` : ''}`},
											{day(milestone.reported.filedAt, today)}. Not confirmed.
										{:else}
											Not reported as done.
										{/if}
									</dd>
								{/if}
							</div>
						</dl>
						<div class="tj-badges">
							<StatusBadge state={status} />
							{#if daysLate > 0}<StatusBadge state="overdue" label={overdueLabel(daysLate)} />{/if}
							{#if milestone.strength}
								<StatusBadge
									state={milestone.strength}
									label={STRENGTH_SHORT[milestone.strength]}
									plain
								/>
							{/if}
						</div>
						<p class="tj-help">
							{#if milestone.confirmedBy}
								Confirmed by {milestone.confirmedBy.who === 'creator'
									? 'the organizer, '
									: ''}{milestone.confirmedBy.name}{milestone.confirmedBy.title
									? `, ${lowerFirst(milestone.confirmedBy.title)}`
									: ''}.
								{milestone.confirmedBy.relationshipReason ?? ''}
								{#if milestone.signOff}
									<a class="tj-link" href={milestone.signOff.proofPath}>View the confirmation</a>
								{/if}
							{:else if milestone.confirmed}
								Who confirmed it is not on record.
							{:else if milestone.namedConfirmer}
								To be confirmed by {milestone.namedConfirmer.name}, {lowerFirst(
									milestone.namedConfirmer.title
								)}.
							{/if}
						</p>
					</div>
				{/each}
			</div>
			<p class="tj-help">
				Open a milestone for its evidence, its history and the receipt of every filing. Tejido
				records what was reported and who confirmed it. It doesn’t inspect the work itself.
			</p>
		</section>
	{/if}

	<section class="tj-section" aria-labelledby="issues">
		<div class="tj-section__head">
			<h2 class="tj-section__title" id="issues">Issues and corrections</h2>
			{#if issues.length > 0}<p class="tj-section__sub">Dates are UTC</p>{/if}
		</div>
		{#if issues.length === 0}
			<p class="tj-help">
				No issues or corrections are on record: no flagged or incomplete filing, no late milestone
				and no refund outstanding.
			</p>
		{:else}
			<ol class="tj-events">
				{#each issues as issue, index (index)}
					<li class={{ 'is-open': issue.open }}>
						{#if issue.at}
							<time datetime={issue.at}>{day(issue.at, today)}</time>
						{:else}
							<time>Open</time>
						{/if}
						<div>
							<p>
								<strong>{issue.title}</strong>
								<span>{issue.text}</span>
							</p>
							{#if issue.href}
								<a class="tj-link--standalone" href={issue.href}>
									{issue.href.includes('/entries/') ? 'View proof' : 'View milestone'}<span
										class="tj-vh"
									>
										for “{issue.title}”</span
									>
									<Icon name="arrow-right" size={18} />
								</a>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<section class="tj-section" aria-label="Filing deposits">
		<DepositRow what="Filing deposits" amount={totals.paid} states={depositStates}>
			{#if totals.paid === 0}
				No filing deposits have been paid on this campaign.
			{:else if totals.refunded === totals.paid}
				All filing deposits are refunded.
			{:else}
				{formatAmount(totals.refunded)} of {formatAmount(totals.paid)} USD-TDN is refunded.
				{#if held > 0}
					{formatAmount(held)} is held until its milestone is confirmed.
				{/if}
				{#if outstanding > 0}
					{formatAmount(outstanding)} hasn’t been returned yet. Each is listed above with the reason.
				{/if}
			{/if}
			Filing deposits are paid by the people who file and refunded to them, never from donations. Donations
			are not affected.
		</DepositRow>
		{#if refundsSent.length > 0}
			<ol class="tj-events">
				{#each refundsSent as refund, index (index)}
					<li>
						{#if refund.at}
							<time datetime={refund.at}>{day(refund.at, today)}</time>
						{:else}
							<time>Sent</time>
						{/if}
						<p>
							<strong>Deposit refund sent</strong>
							<span>
								{formatAmount(refund.amount)} USD-TDN to {refund.to ?? 'a filer not on record'}, for
								milestone {refund.position}
							</span>
						</p>
					</li>
				{/each}
			</ol>
		{/if}
	</section>
</div>

<style>
	/* The organizer's words keep their own line breaks. */
	.summary {
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
</style>
