<!--
  HomeCampaignCard: one campaign on the home page, as a single link to its page.

  Funding is drawn only when it is known ("not known" is not zero), as a line and an ink bar.
  Delivery is one segment per milestone and a count, never a percentage.

  <HomeCampaignCard {campaign} />
-->
<script lang="ts">
	import { formatAmount, fundingPercent, type FundingSummary } from '@tejido/contracts';
	import { Icon, STATES, StatusBadge } from '@tejido/ui';
	import { days } from '#lib/campaign-site/dates.ts';

	interface Segment {
		id: string;
		position: number;
		title: string;
		status: 'not-started' | 'in-progress' | 'claimed' | 'confirmed';
		overdueDays: number;
	}

	let {
		campaign
	}: {
		campaign: {
			title: string;
			summary: string;
			beneficiary: string;
			creatorName: string;
			/** The status in words: "Work under way". */
			statusLabel: string;
			milestones: { total: number; confirmed: number };
			delivery: Segment[];
			funding: FundingSummary;
			path: string;
		};
	} = $props();

	const UNIT = 'USD-TDN';

	/** "12,000.00": the amount as `formatAmount` writes it, with the thousands grouped. */
	function amount(value: number): string {
		const [whole = '', fraction] = formatAmount(value).split('.');
		const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
		return fraction === undefined ? grouped : `${grouped}.${fraction}`;
	}

	const funding = $derived(campaign.funding.state === 'known' ? campaign.funding : null);
	const raised = $derived(funding ? amount(funding.raised) : '');
	const goal = $derived(funding && funding.goal !== null ? amount(funding.goal) : null);
	const percent = $derived(
		funding && funding.goal !== null ? fundingPercent(funding.goal, funding.raised) : null
	);
	const contributions = $derived(
		funding
			? `${funding.donations.toLocaleString('en-GB')} ${funding.donations === 1 ? 'contribution' : 'contributions'}`
			: ''
	);

	const SEGMENT = {
		confirmed: 'confirmed',
		claimed: 'claimed',
		'in-progress': 'progress',
		'not-started': 'not-started'
	} as const;
	const segmentClass = (segment: Segment) =>
		segment.status !== 'confirmed' && segment.overdueDays > 0 ? 'overdue' : SEGMENT[segment.status];

	/** What a screen reader hears for one segment. */
	function spoken(segment: Segment): string {
		const status = STATES[segment.status].label.toLowerCase();
		const late = segment.overdueDays > 0 ? `, ${days(segment.overdueDays)} overdue` : '';
		return `Milestone ${segment.position}, ${segment.title}: ${status}${late}`;
	}

	const overdue = $derived(campaign.delivery.filter((segment) => segment.overdueDays > 0).length);
</script>

<a class="tj-card campaign" href={campaign.path}>
	<p class="tj-entry__kicker">{campaign.statusLabel}</p>
	<div class="tj-pagehead">
		<h3>{campaign.title}</h3>
		<p class="tj-pagehead__meta">
			{#if campaign.beneficiary}Who it is for: {campaign.beneficiary}.{/if}
			Organised by {campaign.creatorName}.
		</p>
	</div>
	{#if campaign.summary}<p class="summary">{campaign.summary}</p>{/if}

	<div class="standing">
		{#if funding}
			<div class="tj-funding">
				<p class="tj-funding__amount">
					<span class="figure">{raised}</span>
					<span>{UNIT} raised{goal === null ? '' : ` of ${goal} goal`}</span>
				</p>
				{#if funding.goal !== null && percent !== null}
					<div
						class="tj-bar"
						role="progressbar"
						aria-label="Funding"
						aria-valuenow={Math.min(funding.raised, funding.goal)}
						aria-valuemin={0}
						aria-valuemax={funding.goal}
						aria-valuetext="{raised} {UNIT} raised of a {goal} {UNIT} goal, {percent} percent"
					>
						<span style:--value="{Math.min(percent, 100)}%"></span>
					</div>
					<p class="tj-funding__meta">{percent}% funded · {contributions}</p>
				{:else}
					<p class="tj-funding__meta">{contributions} · no goal has been set</p>
				{/if}
			</div>
		{/if}

		<div class="tj-delivery">
			{#if campaign.milestones.total === 0}
				<p class="tj-delivery__headline"><span>No milestones have been set yet</span></p>
			{:else}
				<p class="tj-delivery__headline">
					<span class="text-figure">
						{campaign.milestones.confirmed} of {campaign.milestones.total}
					</span>
					<span>{campaign.milestones.total === 1 ? 'milestone' : 'milestones'} confirmed</span>
				</p>
				<ol class="tj-track" aria-label="Milestones">
					{#each campaign.delivery as segment (segment.id)}
						<li class="tj-track__seg tj-track__seg--{segmentClass(segment)}">
							<span class="tj-vh">{spoken(segment)}</span>
						</li>
					{/each}
				</ol>
			{/if}
		</div>

		{#if overdue > 0}
			<div class="tj-badges">
				<StatusBadge
					state="overdue"
					label={overdue === 1 ? '1 milestone overdue' : `${overdue} milestones overdue`}
				/>
			</div>
		{/if}
	</div>

	<span class="tj-link--standalone go">
		Follow this campaign <Icon name="arrow-right" size={18} />
	</span>
</a>

<style>
	.campaign {
		align-content: start;
		gap: var(--space-4);
		padding: var(--space-5);
		color: inherit;
		text-decoration: none;
		overflow-wrap: anywhere;
	}
	.campaign:hover {
		border-color: var(--border-strong);
	}
	.campaign h3 {
		font: 500 24px/30px var(--font-serif);
		text-wrap: balance;
	}
	.summary {
		display: -webkit-box;
		-webkit-box-orient: vertical;
		-webkit-line-clamp: 3;
		line-clamp: 3;
		overflow: hidden;
		color: var(--text-secondary);
	}
	.standing {
		display: grid;
		gap: var(--space-3);
		padding-top: var(--space-4);
		border-top: var(--border-hair) solid var(--border);
	}
	.tj-funding__amount {
		overflow-wrap: anywhere;
	}
	.figure {
		font-weight: 600;
		color: var(--text-primary);
		font-variant-numeric: tabular-nums;
	}
	.go {
		color: var(--link);
		margin-block: calc(-1 * var(--space-2));
	}
	.campaign:hover .go {
		text-decoration: underline;
	}
</style>
