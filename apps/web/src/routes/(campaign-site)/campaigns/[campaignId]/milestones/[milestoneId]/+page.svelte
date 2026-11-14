<script lang="ts">
	import { formatAmount } from '@tejido/contracts';
	import { Banner, EvidenceTile, Icon, STATES, StatusBadge } from '@tejido/ui';
	import Assurance from '#lib/campaign-site/Assurance.svelte';
	import Crumbs from '#lib/campaign-site/Crumbs.svelte';
	import DepositRow from '#lib/campaign-site/DepositRow.svelte';
	import PartyIdentity from '#lib/campaign-site/PartyIdentity.svelte';
	import Strength from '#lib/campaign-site/Strength.svelte';
	import {
		CLAIM_REPORTED,
		MILESTONE_KIND_LABEL,
		WORK_STATUS_REPORTED,
		confirmationAnswer,
		count,
		countWord,
		day,
		daysBetween,
		evidenceCount,
		filingKey,
		fullDay,
		lowerFirst,
		milestoneStatus,
		overdueLabel,
		stamp,
		type Answer,
		type DepositStateKey
	} from '#lib/campaign-site/display.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const milestone = $derived(data.milestone);
	const filings = $derived(data.filings);
	const today = $derived(data.today);
	const base = $derived(`/campaigns/${data.campaign.id}`);
	const proof = (entryId: string) => `${base}/entries/${entryId}`;

	const status = $derived(milestoneStatus(milestone.state, filings.total > 0));
	const byCreator = $derived(milestone.state === 'confirmed_creator');

	// ---- The three questions --------------------------------------------------------------

	const recorded = $derived.by<Answer>(() => {
		const question = 'Were the filings recorded correctly?';
		if (filings.total === 0) {
			return {
				tone: 'neutral',
				icon: 'receipt-clock',
				question,
				answer: 'No filings yet',
				detail: 'Nothing has been filed on this milestone.'
			};
		}
		const details = [
			filings.flagged > 0
				? `${countWord(filings.flagged, 'filing')} ${filings.flagged === 1 ? 'was' : 'were'} paid from a wallet that isn’t the filer’s registered one.`
				: '',
			filings.incomplete > 0
				? `${countWord(filings.incomplete, 'filing')} ${filings.incomplete === 1 ? 'is' : 'are'} missing something this milestone needs.`
				: '',
			filings.pending > 0
				? `${countWord(filings.pending, 'filing')} ${filings.pending === 1 ? 'hasn’t' : 'haven’t'} been matched to ${filings.pending === 1 ? 'its' : 'their'} public receipt yet.`
				: ''
		].filter(Boolean);
		const allVerified = filings.verified === filings.total;
		return {
			tone:
				filings.flagged > 0
					? 'critical'
					: filings.incomplete > 0
						? 'attention'
						: allVerified
							? 'record'
							: 'neutral',
			icon:
				filings.flagged > 0
					? 'receipt-flag'
					: filings.incomplete > 0
						? 'receipt-missing'
						: allVerified
							? 'receipt-check'
							: 'receipt-clock',
			question,
			answer:
				`${filings.verified} of ${count(filings.total, 'receipt')} verified` +
				(filings.flagged > 0 ? `, ${filings.flagged} flagged` : ''),
			detail: allVerified
				? 'Each was paid from its filer’s registered wallet. This shows the filings happened. It doesn’t prove the work.'
				: details.join(' ')
		};
	});

	const files = $derived({
		photos: data.evidence.filter((file) => file.kind === 'photo').length,
		documents: data.evidence.filter((file) => file.kind === 'document').length,
		leftOut: data.leftOut
	});
	const evidenced = $derived<Answer>({
		tone: 'neutral',
		icon: files.photos > 0 ? 'image' : files.documents > 0 ? 'file-text' : 'excluded',
		question: 'Is there evidence?',
		answer: evidenceCount(files, 'No files yet'),
		detail:
			data.evidence.length > 0
				? `From ${count(new Set(data.evidence.map((file) => file.entryId)).size, 'filing')}. Each file is shown below with its fingerprint.`
				: files.leftOut > 0
					? 'No attached file could be shown. Each filing’s proof page says why.'
					: 'No photos or documents have been attached to a filing on this milestone.'
	});

	const confirmedBy = $derived(
		byCreator
			? `the organizer, ${data.campaign.creatorName}`
			: data.confirmer
				? `${data.confirmer.name}, ${lowerFirst(data.confirmer.title)}`
				: null
	);
	const confirmation = $derived(
		confirmationAnswer(
			'Has someone confirmed it?',
			{
				position: milestone.position,
				status,
				strength: milestone.strength,
				confirmedAt: milestone.confirmedAt,
				confirmedBy,
				confirmer: data.confirmer
			},
			today
		)
	);

	const WORK_STATUS_WORD = {
		on_track: 'on track',
		delayed: 'delayed',
		blocked: 'blocked'
	} as const;

	// ---- Planned and reported -------------------------------------------------------------

	const reported = $derived(
		data.claim
			? `${CLAIM_REPORTED[data.claim.claim === 'confirm' ? 'completed' : data.claim.claim]}${
					data.claim.quantity === null
						? ''
						: `: ${data.claim.quantity}${data.claim.unit ? ` ${data.claim.unit}` : ''}`
				}, ${day(data.claim.filedAt, today)}`
			: data.progress
				? [
						data.progress.percentComplete === null
							? 'Work log filed'
							: `${data.progress.percentComplete}% complete, as reported`,
						data.progress.status ? WORK_STATUS_WORD[data.progress.status] : '',
						day(data.progress.filedAt, today)
					]
						.filter(Boolean)
						.join(' · ')
				: 'Nothing reported yet'
	);
	/** How many days after its due date the milestone was confirmed. Zero when on time. */
	const confirmedLate = $derived(
		milestone.confirmedAt ? Math.max(0, daysBetween(milestone.dueDate, milestone.confirmedAt)) : 0
	);

	// ---- History --------------------------------------------------------------------------

	interface Happened {
		at: string;
		title: string;
		text: string;
		href?: string;
		open?: boolean;
	}
	const history = $derived.by(() => {
		const happened: Happened[] = data.entries.map((entry) => ({
			at: entry.filedAt,
			title:
				entry.item === 'log_work'
					? 'Work log filed'
					: entry.claim === 'confirm'
						? 'Confirmation filed'
						: entry.claim
							? `${CLAIM_REPORTED[entry.claim]}`
							: 'Milestone claim filed',
			text: `${entry.filedBy ?? 'Filer not on record'} · ${STATES[filingKey(entry.status)].label}`,
			href: proof(entry.id),
			open: entry.status === 'flagged' || entry.status === 'incomplete'
		}));
		if (milestone.daysLate > 0) {
			happened.push({
				// Late from the day after the due date.
				at: new Date(Date.parse(milestone.dueDate) + 86_400_000).toISOString(),
				title: 'Due date passed',
				text: `Due ${day(milestone.dueDate, today)} and not confirmed`,
				open: true
			});
		}
		if (milestone.confirmedAt) {
			happened.push({
				at: milestone.confirmedAt,
				title: 'Milestone confirmed',
				text:
					(milestone.strength ? STATES[milestone.strength].label : 'Confirmed') +
					(confirmedBy ? ` by ${confirmedBy}` : '')
			});
		}
		return happened.sort((a, b) => a.at.localeCompare(b.at));
	});

	// ---- Deposits -------------------------------------------------------------------------

	const deposits = $derived(data.deposits);
	const notReturned = $derived(deposits.paid - deposits.returned);
	const depositStates = $derived<DepositStateKey[]>([
		...(deposits.returned > 0 ? (['dep-refunded'] as const) : []),
		...(notReturned > 0 ? ([milestone.confirmed ? 'dep-outstanding' : 'dep-held'] as const) : [])
	]);
</script>

<svelte:head>
	<title>Milestone {milestone.position}: {milestone.title} · {data.campaign.title} · Tejido</title>
</svelte:head>

<div class="tj-page" style:gap="var(--space-6)">
	<Crumbs
		items={[
			{ label: data.campaign.title, href: base },
			{ label: 'Milestones', href: `${base}/milestones` },
			{ label: `Milestone ${milestone.position}` }
		]}
	/>

	<div class="tj-pagehead">
		<p class="text-eyebrow">
			Milestone {milestone.position} of {data.total} · {MILESTONE_KIND_LABEL[milestone.kind]}
		</p>
		<h1>{milestone.title}</h1>
		<p class="tj-pagehead__meta">
			{data.owner?.name ?? 'No one named'} · due {fullDay(milestone.dueDate)}
		</p>
		<div class="tj-msstatus">
			<StatusBadge state={status} />
			{#if milestone.daysLate > 0}
				<StatusBadge state="overdue" label={overdueLabel(milestone.daysLate)} />
			{/if}
		</div>
	</div>

	{#if milestone.daysLate > 0}
		<Banner
			tone="critical"
			icon="ms-overdue"
			role="note"
			title="Overdue by {count(milestone.daysLate, 'day')}"
		>
			It was due on {day(milestone.dueDate, today)} and isn’t confirmed.
			{#if status === 'claimed'}
				Work has been reported. Confirmation is still pending.
			{:else if data.progress}
				The latest work log, filed {day(data.progress.filedAt, today)}{data.progress.status
					? `, is ${WORK_STATUS_REPORTED[data.progress.status].toLowerCase()}`
					: ''}{data.progress.percentComplete === null
					? ''
					: ` at ${data.progress.percentComplete}% complete`}.
			{:else}
				No work has been reported on it yet.
			{/if}
			Being overdue doesn’t make the reports on it wrong.
		</Banner>
	{/if}

	<Assurance
		label="What is known about this milestone"
		answers={[recorded, evidenced, confirmation]}
	/>

	<section class="tj-section" aria-labelledby="planned">
		<h2 class="tj-section__title" id="planned">Planned and reported</h2>
		<div class="tj-outcome">
			<div class="tj-outcome__row">
				<p class="tj-outcome__title">What will be delivered</p>
				<dl class="tj-outcome__cmp">
					<div>
						<dt>Planned</dt>
						<dd>{milestone.description || 'No description was given.'}</dd>
					</div>
					<div>
						<dt>Reported</dt>
						<dd>{reported}</dd>
					</div>
				</dl>
			</div>
			<div class="tj-outcome__row">
				<p class="tj-outcome__title">Date</p>
				<dl class="tj-outcome__cmp">
					<div>
						<dt>Planned</dt>
						<dd>{day(milestone.dueDate, today)}</dd>
					</div>
					<div>
						{#if milestone.confirmedAt}
							<dt>Confirmed</dt>
							<dd>
								{day(milestone.confirmedAt, today)}{confirmedLate > 0
									? `, ${count(confirmedLate, 'day')} after the due date`
									: ''}
							</dd>
						{:else if data.claim}
							<dt>Reported complete</dt>
							<dd>{day(data.claim.filedAt, today)}. Not confirmed yet.</dd>
						{:else}
							<dt>Reported complete</dt>
							<dd>Not yet</dd>
						{/if}
					</div>
				</dl>
			</div>
		</div>
		<p class="tj-help">
			“Reported” is the filer’s own account. Tejido never works out a percentage of delivery.
		</p>
	</section>

	<section class="tj-section" aria-labelledby="needed">
		<h2 class="tj-section__title" id="needed">Still needed</h2>
		<ul class="tj-checklist">
			{#if milestone.confirmed}
				<li class="is-done">
					<Icon name="check" />Nothing more. This milestone is confirmed.
				</li>
			{:else}
				{#each data.missing as item (item.entryId)}
					<li class="is-missing">
						<Icon name="alert-circle" />
						<span>
							{item.reason}
							<a class="tj-link" href={proof(item.entryId)}>View the filing</a>
						</span>
					</li>
				{/each}
				{#if status !== 'claimed'}
					<li>
						<Icon name="clock" />A claim of completion from {data.owner?.name ??
							'whoever does the work'}
					</li>
				{/if}
				<li>
					<Icon name="clock" />Confirmation by {data.confirmer?.name ?? 'the named confirmer'}
				</li>
			{/if}
		</ul>
	</section>

	<section class="tj-section" aria-labelledby="confirmer">
		<h2 class="tj-section__title" id="confirmer">
			{milestone.confirmed ? 'Who confirmed this milestone' : 'Who confirms this milestone'}
		</h2>
		<div class="tj-card">
			{#if byCreator}
				<PartyIdentity name={data.campaign.creatorName} role="Campaign organizer" />
				<Strength
					strength="participant"
					who="The organizer runs the project. No confirmer answered in the waiting period, so the organizer signed this milestone off."
				/>
				{#if data.confirmer}
					<p class="tj-help">
						{data.confirmer.name}, {lowerFirst(data.confirmer.title)}, was named to confirm it.
					</p>
				{/if}
			{:else if data.confirmer}
				<PartyIdentity name={data.confirmer.name} role={data.confirmer.title} />
				<Strength
					strength={data.confirmer.relationship}
					who={data.confirmer.relationshipReason ??
						(data.confirmer.relationshipRecorded
							? STATES[data.confirmer.relationship].text
							: 'How this person relates to the project isn’t on record, so their confirmation is shown as a stakeholder’s. It is never assumed to be independent.')}
				/>
				{#if !milestone.confirmed}
					<p class="tj-help">
						This is how the confirmation will be described once {data.confirmer.name} signs the milestone
						off. It says how they relate to the project. It isn’t a score.
					</p>
				{/if}
			{:else}
				<p class="tj-help">No confirmer is on record for this milestone.</p>
			{/if}
		</div>
	</section>

	<section class="tj-section" aria-labelledby="evidence">
		<div class="tj-section__head">
			<h2 class="tj-section__title" id="evidence">Evidence</h2>
			{#if data.evidence.length + data.leftOut > 0}
				<p class="tj-section__sub">
					{countWord(data.evidence.length + data.leftOut, 'file')}
					{data.evidence.length + data.leftOut === 1 ? 'was' : 'were'} submitted
				</p>
			{/if}
		</div>
		{#if data.evidence.length > 0}
			<div class="tj-evidence">
				{#each data.evidence as file (file.entryId + file.sha256)}
					{#if file.kind === 'photo'}
						<EvidenceTile
							kind="photo"
							src={file.url}
							href={file.url}
							caption="{file.caption ?? 'Photo, no caption given'}, {day(file.filedAt, today)}"
							fingerprint={file.sha256}
						/>
					{:else}
						<EvidenceTile
							kind="document"
							href={file.url}
							caption="{file.caption ?? 'Document, no caption given'}, {day(file.filedAt, today)}"
							fingerprint={file.sha256}
						/>
					{/if}
				{/each}
			</div>
		{/if}
		<p class="tj-help">
			{#if data.evidence.length + data.leftOut === 0}
				No photos or documents have been attached to a filing on this milestone yet.
			{:else}
				{countWord(data.evidence.length, 'file')}
				{data.evidence.length === 1 ? 'was' : 'were'} included.
				{#if data.leftOut > 0}
					{countWord(data.leftOut, 'file')}
					{data.leftOut === 1 ? 'was' : 'were'} left out because {data.leftOut === 1
						? 'it'
						: 'they'} didn’t pass our checks. The proof page of each filing, under History, says why.
				{/if}
			{/if}
		</p>
	</section>

	<section class="tj-section" aria-labelledby="history">
		<div class="tj-section__head">
			<h2 class="tj-section__title" id="history">History</h2>
			{#if history.length > 0}<p class="tj-section__sub">Times are UTC</p>{/if}
		</div>
		{#if history.length === 0}
			<p class="tj-help">Nothing has been filed on this milestone yet.</p>
		{:else}
			<ol class="tj-events">
				{#each history as event, index (index)}
					<li class={{ 'is-open': event.open }}>
						<time datetime={event.at}>{stamp(event.at, today)}</time>
						<div>
							<p>
								<strong>{event.title}</strong>
								<span>{event.text}</span>
							</p>
							{#if event.href}
								<a class="tj-link--standalone" href={event.href}>
									View proof<span class="tj-vh"> of the filing made {stamp(event.at, today)}</span>
									<Icon name="arrow-right" size={18} />
								</a>
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</section>

	<DepositRow what="Deposits on this milestone" amount={deposits.paid} states={depositStates}>
		{#if deposits.count === 0}
			No filing deposits yet. Each filing carries a small deposit paid by its filer, returned when
			the milestone is confirmed.
		{:else if !milestone.confirmed}
			{count(deposits.count, 'filing deposit')} paid by the people who filed.
			{deposits.returned > 0
				? `${formatAmount(deposits.returned)} USD-TDN has been returned. The rest is`
				: deposits.count === 1
					? 'It is'
					: 'All are'}
			returned to {deposits.count === 1 ? 'its filer' : 'their filers'} when the milestone is confirmed.
		{:else if notReturned === 0}
			{deposits.count === 1
				? 'The one filing deposit was'
				: `All ${deposits.count} filing deposits were`}
			returned to {deposits.count === 1 ? 'its filer' : 'their filers'} after the milestone was confirmed.
		{:else}
			{formatAmount(deposits.returned)} of {formatAmount(deposits.paid)} USD-TDN has been returned to
			the filers. {formatAmount(notReturned)} hasn’t arrived yet. The proof page of each filing says where
			its deposit stands. Donations are not affected.
		{/if}
		Deposits aren’t donations or payments for the work.
	</DepositRow>
</div>
