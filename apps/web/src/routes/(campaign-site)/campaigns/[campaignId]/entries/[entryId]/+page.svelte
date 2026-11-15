<script lang="ts">
	import { formatAmount } from '@tejido/contracts';
	import { Banner, EvidenceTile, Icon, STATES, StatusBadge } from '@tejido/ui';
	import Assurance from '#lib/campaign-site/Assurance.svelte';
	import Crumbs from '#lib/campaign-site/Crumbs.svelte';
	import DepositRow from '#lib/campaign-site/DepositRow.svelte';
	import PartyIdentity from '#lib/campaign-site/PartyIdentity.svelte';
	import ProofReceipt from '#lib/campaign-site/ProofReceipt.svelte';
	import {
		CLAIM_REPORTED,
		WORK_STATUS_REPORTED,
		confirmationAnswer,
		count,
		countWord,
		day,
		entryKind,
		evidenceCount,
		filingKey,
		fullDay,
		headline,
		lowerFirst,
		milestoneStatus,
		overdueLabel,
		stamp,
		time,
		type Answer,
		type DepositStateKey
	} from '#lib/campaign-site/display.ts';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const entry = $derived(data.entry);
	const filed = $derived(data.filed);
	const receipt = $derived(data.receipt);
	const filer = $derived(data.filer);
	const milestone = $derived(data.milestone);
	const today = $derived(data.today);

	const base = $derived(`/campaigns/${data.campaign.id}`);
	const milestoneHref = $derived(`${base}/milestones/${milestone.id}`);

	const kind = $derived(entryKind(filed.item, filed.item === 'milestone_hit' ? filed.claim : null));
	const filing = $derived(filingKey(entry.status));
	// This entry is filed on the milestone, so the milestone is never "not started" here.
	const status = $derived(milestoneStatus(milestone.state, true));
	const filerRole = $derived(lowerFirst(filer.title));

	// ---- Evidence -------------------------------------------------------------------------

	const LEFT_OUT = {
		not_in_our_store:
			'It isn’t a file held by Tejido, so we couldn’t verify that it belongs to this project.',
		hash_mismatch:
			'Its fingerprint doesn’t match the file we hold, so we couldn’t verify that it is the file that was filed.',
		picture_on_documents_only: 'It’s a picture, and this milestone takes documents only.'
	} as const;

	const files = $derived({
		photos: data.evidence.filter((file) => file.state === 'shown' && file.kind === 'photo').length,
		documents: data.evidence.filter((file) => file.state === 'shown' && file.kind === 'document')
			.length,
		leftOut: data.evidence.filter((file) => file.state === 'left_out').length
	});
	/** Files the party who filed them marked not public. Donors are told what and why. */
	const notPublic = $derived(data.evidence.filter((file) => file.state === 'not_public').length);
	const shownCount = $derived(files.photos + files.documents);
	/** Whether every left-out file was left out because it could not be verified. */
	const unverifiedOnly = $derived(
		data.evidence.every(
			(file) => file.state !== 'left_out' || file.reason !== 'picture_on_documents_only'
		)
	);
	const firstCaption = $derived(
		data.evidence.flatMap((file) =>
			file.state === 'shown' && file.caption ? [file.caption] : []
		)[0] ?? null
	);

	// ---- The deposit ----------------------------------------------------------------------

	const deposit = $derived(data.deposit);
	// The state comes from the server, which reads it from what is recorded. It is never worked
	// out again here.
	const DEPOSIT_KEY = {
		held: 'dep-held',
		refunded: 'dep-refunded',
		refund_outstanding: 'dep-outstanding'
	} as const;
	const depositState = $derived<DepositStateKey | null>(
		deposit === null ? null : DEPOSIT_KEY[deposit.state]
	);

	// ---- The three questions --------------------------------------------------------------

	const QUESTION_1 = 'Was the filing recorded correctly?';
	const recorded = $derived<Answer>(
		entry.status === 'verified'
			? {
					tone: 'record',
					icon: 'receipt-check',
					question: QUESTION_1,
					answer: 'Yes · receipt verified',
					detail:
						'Recorded, and Qatom confirms its deposit was paid. This shows the filing happened. It doesn’t prove the work.'
				}
			: entry.status === 'flagged'
				? {
						tone: 'critical',
						icon: 'receipt-flag',
						question: QUESTION_1,
						answer: 'Recorded, but flagged',
						detail: receipt.payingWallet
							? `The receipt exists. The wallet that paid doesn’t match the ${filerRole}’s.`
							: `The receipt doesn’t match this filing. ${entry.statusReason ?? ''}`.trim()
					}
				: entry.status === 'incomplete'
					? {
							tone: 'attention',
							icon: 'receipt-missing',
							question: QUESTION_1,
							answer: 'Saved, but incomplete',
							detail:
								receipt.twistId === null
									? 'Something this milestone needs is missing, and it hasn’t been matched to its public receipt yet.'
									: 'Its receipt exists, but something this milestone needs is missing.'
						}
					: {
							tone: 'neutral',
							icon: 'receipt-clock',
							question: QUESTION_1,
							answer: 'Receipt pending',
							detail: 'Filed with Tejido. We haven’t matched it to its public receipt yet.'
						}
	);
	const evidenced = $derived<Answer>({
		tone: 'neutral',
		icon: shownCount > 0 ? (files.photos > 0 ? 'image' : 'file-text') : 'excluded',
		question: 'Is there evidence of the work?',
		answer:
			evidenceCount(files, notPublic > 0 ? '' : 'No files attached') +
			(notPublic > 0
				? `${shownCount + files.leftOut > 0 ? ', ' : ''}${count(notPublic, 'file')} not public`
				: ''),
		detail:
			data.evidence.length === 0
				? 'Nothing was attached to this entry. It is the filer’s account only.'
				: firstCaption
					? `The filer describes ${shownCount === 1 ? 'it' : 'the first'} as “${firstCaption}”.`
					: shownCount > 0
						? 'Each file is shown below with its fingerprint.'
						: 'No attached file could be shown. Each is listed below with the reason.'
	});
	const confirmedBy = $derived(
		milestone.state === 'confirmed_creator'
			? `the organizer, ${data.campaign.creatorName}`
			: data.confirmer
				? `${data.confirmer.name}, ${lowerFirst(data.confirmer.title)}`
				: null
	);
	const confirmation = $derived(
		confirmationAnswer(
			'Has someone confirmed the milestone?',
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

	// ---- What happened --------------------------------------------------------------------

	interface Happened {
		at: string;
		title: string;
		text: string;
		open?: boolean;
	}
	const events = $derived.by(() => {
		const happened: Happened[] = [
			{
				at: entry.filedAt,
				title: 'Filed with Tejido',
				text:
					data.evidence.length === 0
						? `${kind} with no files`
						: `${kind} with ${count(data.evidence.length, 'file')}${
								files.leftOut > 0 ? `, ${files.leftOut} left out` : ''
							}`
			}
		];
		if (receipt.stampedAt) {
			happened.push({
				at: receipt.stampedAt,
				// With no paying wallet on record, Qatom's purchase record is what shows the payment.
				// It names no payer, so nothing is said here about who paid.
				title: receipt.payingWallet
					? 'Deposit paid and recorded on the public ledger'
					: 'Deposit paid, confirmed by Qatom',
				text:
					(deposit ? `${formatAmount(deposit.amount)} USD-TDN` : 'Paid') +
					(receipt.walletsMatch === false
						? ` from a wallet not registered to the ${filerRole}`
						: receipt.walletsMatch
							? ' from the registered wallet'
							: '')
			});
		}
		if (entry.updatedAt !== entry.filedAt) {
			happened.push({
				at: entry.updatedAt,
				title: 'Record last updated',
				text: `Its filing status is now “${STATES[filing].label}”`,
				open: entry.status === 'flagged' || entry.status === 'incomplete'
			});
		}
		if (milestone.confirmedAt) {
			happened.push({
				at: milestone.confirmedAt,
				title: `Milestone ${milestone.position} confirmed`,
				text: milestone.strength ? STATES[milestone.strength].label : 'Confirmed'
			});
		}
		if (deposit?.refundedAt) {
			happened.push({
				at: deposit.refundedAt,
				title: 'Deposit refunded',
				text: `${formatAmount(deposit.amount)} USD-TDN returned to the filer`
			});
		}
		return happened.sort((a, b) => a.at.localeCompare(b.at));
	});

	const milestoneWhen = $derived(
		milestone.confirmed && milestone.confirmedAt
			? `Confirmed ${day(milestone.confirmedAt, today)}`
			: `Due ${day(milestone.dueDate, today)}${
					milestone.percentReported === null
						? ''
						: ` · ${milestone.percentReported}% complete, as reported`
				}`
	);
</script>

<svelte:head>
	<title>{kind}, {fullDay(entry.filedAt)} · {data.campaign.title} · Tejido</title>
</svelte:head>

<div class="tj-page">
	<div class="tj-section" style:gap="var(--space-5)">
		<Crumbs
			items={[
				{ label: data.campaign.title, href: base },
				// "Updates" is the campaign's timeline, where this entry is listed.
				{ label: 'Updates', href: base },
				{ label: `${kind}, ${day(entry.filedAt, today)}` }
			]}
		/>

		<div class="tj-pagehead">
			<p class="text-eyebrow">{kind} · Milestone {milestone.position} · {milestone.title}</p>
			<h1>{headline(filed.summary)}</h1>
			<p class="tj-pagehead__meta">
				Filed by {filer.name}, {filerRole}, on
				<time datetime={entry.filedAt}>{fullDay(entry.filedAt)} at {time(entry.filedAt)}</time>
			</p>
			<div class="tj-badges">
				<StatusBadge state={filing} />
				<StatusBadge state={status} label="Milestone {STATES[status].label.toLowerCase()}" />
				{#if milestone.daysLate > 0}
					<StatusBadge state="overdue" label={overdueLabel(milestone.daysLate)} />
				{/if}
				{#if depositState}<StatusBadge state={depositState} />{/if}
			</div>
		</div>

		{#if entry.status === 'flagged' && !receipt.payingWallet}
			<Banner
				tone="critical"
				icon="receipt-flag"
				role="note"
				title="This filing was recorded, but its receipt doesn’t match it."
			>
				{entry.statusReason ?? 'The receipt on record doesn’t fit this filing.'} The report itself may
				still be accurate.
			</Banner>
		{:else if entry.status === 'flagged'}
			<Banner
				tone="critical"
				icon="receipt-flag"
				role="note"
				title="This filing was recorded, but the payment came from a different wallet."
			>
				The deposit came from a wallet that isn’t the one registered for {filer.name}. There can be
				ordinary reasons, like paying from a new phone, but we can’t link this filing to the
				{filerRole} with certainty. The report itself may still be accurate.
			</Banner>
		{:else if entry.status === 'incomplete'}
			<Banner
				tone="attention"
				icon="receipt-missing"
				role="note"
				title={entry.statusReason ?? 'Something this milestone needs is missing.'}
			>
				This entry is saved, and what it says is shown below. {filer.name} can add what is missing without
				paying again.
			</Banner>
		{/if}

		<Assurance
			label="What is known about this entry"
			answers={[recorded, evidenced, confirmation]}
		/>
	</div>

	<div class="tj-split">
		<div class="tj-section" style:gap="var(--space-8)">
			<section class="tj-section" aria-labelledby="reported">
				<h2 class="tj-section__title" id="reported">What was reported</h2>
				<div class="tj-quote">
					<blockquote class="summary">{filed.summary}</blockquote>
					<div class="tj-entry__facts">
						{#if filed.item === 'log_work'}
							{#if filed.period}<span><Icon name="calendar" size={16} />{filed.period}</span>{/if}
							{#if filed.status}
								<span>
									<Icon name={filed.status === 'on_track' ? 'check' : 'alert-circle'} size={16} />
									{WORK_STATUS_REPORTED[filed.status]}
								</span>
							{/if}
							<!-- The reporter's own figure. Tejido never computes a delivery percentage. -->
							{#if filed.percentComplete !== null}
								<span>{filed.percentComplete}% complete, as reported</span>
							{/if}
						{:else}
							<span>
								<Icon name={filed.claim === 'confirm' ? 'users' : 'flag'} size={16} />
								{filed.claim === 'confirm'
									? `Confirms milestone ${milestone.position}`
									: CLAIM_REPORTED[filed.claim]}
							</span>
							{#if filed.quantity !== null}
								<span>
									<Icon name="package" size={16} />{filed.quantity}{filed.unit
										? ` ${filed.unit}`
										: ''}, as reported
								</span>
							{/if}
							{#if filed.amountSpent !== null}
								<span>Amount spent, as reported: {filed.amountSpent}</span>
							{/if}
						{/if}
						{#if filed.location}<span><Icon name="map-pin" size={16} />{filed.location}</span>{/if}
					</div>
					<PartyIdentity
						name={filer.name}
						role={filer.title}
						relationship={filer.relationship}
						reason={filer.relationshipReason}
					/>
				</div>
			</section>

			<section class="tj-section" aria-labelledby="evidence">
				<div class="tj-section__head">
					<h2 class="tj-section__title" id="evidence">Evidence</h2>
					<p class="tj-section__sub">
						{data.evidence.length === 0
							? 'No files were submitted'
							: `${countWord(data.evidence.length, 'file')} ${
									data.evidence.length === 1 ? 'was' : 'were'
								} submitted`}
					</p>
				</div>
				{#if data.evidence.length === 0}
					<p class="tj-help">
						No photos or documents were attached to this entry. What was reported above is the
						filer’s own account.
					</p>
				{:else}
					<div class="tj-evidence">
						{#each data.evidence as file, index (index)}
							{#if file.state === 'left_out'}
								<EvidenceTile
									kind="excluded"
									caption="Attached file · not counted"
									reason={LEFT_OUT[file.reason]}
									fingerprint={file.sha256}
								/>
							{:else if file.state === 'not_public'}
								<EvidenceTile
									kind="private"
									caption={file.kind}
									reason="{file.reason} Only the party who filed it and this campaign’s confirmers can open it."
									fingerprint={file.sha256}
								/>
							{:else if file.kind === 'photo'}
								<EvidenceTile
									kind="photo"
									src={file.url}
									href={file.url}
									caption={file.caption ?? 'Photo, no caption given'}
									fingerprint={file.sha256}
								/>
							{:else}
								<EvidenceTile
									kind="document"
									href={file.url}
									caption={file.caption ?? 'Document, no caption given'}
									fingerprint={file.sha256}
								/>
							{/if}
						{/each}
					</div>
					<p class="tj-help">
						{countWord(shownCount, 'file')}
						{shownCount === 1 ? 'was' : 'were'} included.
						{#if notPublic > 0}
							{countWord(notPublic, 'file')}
							{notPublic === 1 ? 'is' : 'are'} kept off this page by the party who filed
							{notPublic === 1 ? 'it' : 'them'}.
						{/if}
						{#if files.leftOut > 0}
							{countWord(files.leftOut, 'file')}
							{files.leftOut === 1 ? 'was' : 'were'} left out{unverifiedOnly
								? ` because we couldn’t verify that ${
										files.leftOut === 1 ? 'it' : 'they'
									} belonged to this project.`
								: '. The reason is given with each.'}
						{/if}
						{#if data.documentsOnly}
							This milestone takes documents only, so no pictures are shown on it.
						{/if}
					</p>
					<details class="tj-disclosure check">
						<summary>How to check a file yourself <Icon name="chevron-down" size={18} /></summary>
						<div class="tj-disclosure__body">
							<p class="tj-help">
								Download the file and work out its fingerprint: <code class="tj-id"
									>shasum -a 256 file</code
								>
								on a Mac or Linux,
								<code class="tj-id">certutil -hashfile file SHA256</code> on Windows. Compare it with
								the full fingerprint under Technical details in the receipt. If every character matches,
								it is exactly the file that was filed.
							</p>
						</div>
					</details>
				{/if}
			</section>

			<section class="tj-section" aria-labelledby="happened">
				<div class="tj-section__head">
					<h2 class="tj-section__title" id="happened">What happened</h2>
					<p class="tj-section__sub">Times are UTC</p>
				</div>
				<ol class="tj-events">
					{#each events as event, index (index)}
						<li class={{ 'is-open': event.open }}>
							<time datetime={event.at}>{stamp(event.at, today)}</time>
							<p><strong>{event.title}</strong><span>{event.text}</span></p>
						</li>
					{/each}
				</ol>
			</section>
		</div>

		<div class="tj-split__side">
			<ProofReceipt
				status={entry.status}
				entryId={entry.id}
				item={filed.item}
				filedAt={entry.filedAt}
				{receipt}
				filer={filer.name}
				milestone={{ position: milestone.position, title: milestone.title }}
				files={data.evidence.map((file) => ({
					label:
						file.state === 'left_out'
							? 'left out'
							: file.state === 'not_public'
								? 'not public'
								: (file.caption ?? file.kind),
					sha256: file.sha256
				}))}
			/>

			{#if deposit && depositState}
				<DepositRow what="Filing deposit" amount={deposit.amount} states={[depositState]}>
					Paid by the filer to record this entry.
					{#if depositState === 'dep-refunded'}
						Returned to the filer{deposit.refundedAt
							? ` on ${day(deposit.refundedAt, today)}`
							: ''}, after milestone {milestone.position} was confirmed.
					{:else if depositState === 'dep-held'}
						Returned when milestone {milestone.position} is confirmed.
						{#if entry.status === 'flagged'}
							A deposit on a flagged filing isn’t sent back until a person has looked at it.
						{/if}
					{:else}
						{deposit.outstandingMeaning ??
							`Milestone ${milestone.position} is confirmed and this refund hasn’t arrived yet.`}
						Donations are not affected.
					{/if}
					It isn’t a donation or a payment for the work.
				</DepositRow>
			{/if}

			<div class="tj-card">
				<p class="text-eyebrow">Milestone {milestone.position}</p>
				<p class="tj-msrow__title">{milestone.title}</p>
				<div class="tj-msstatus">
					<StatusBadge state={status} />
					{#if milestone.daysLate > 0}
						<StatusBadge state="overdue" label={overdueLabel(milestone.daysLate)} />
					{/if}
					<span class="tj-msstatus__when">{milestoneWhen}</span>
				</div>
				{#if data.confirmer}
					<p class="tj-help">
						{milestone.state === 'confirmed_creator'
							? 'Named to confirm it. The organizer signed it off instead.'
							: milestone.confirmed
								? 'Confirmed by'
								: 'Confirms this milestone'}
					</p>
					<PartyIdentity
						name={data.confirmer.name}
						role={data.confirmer.title}
						relationship={data.confirmer.relationship}
						reason={data.confirmer.relationshipReason}
					/>
				{/if}
				<a class="tj-link--standalone" href={milestoneHref}>
					View milestone {milestone.position}
					<Icon name="arrow-right" size={18} />
				</a>
			</div>
		</div>
	</div>
</div>

<style>
	/* In the sidebar the receipt is narrow, so its rows stack as they do on a phone: an
	   identifier keeps its own line instead of wrapping beside its label. */
	@container (min-width: 900px) {
		.tj-split__side :global(.tj-kv__row) {
			grid-template-columns: minmax(0, 1fr);
			gap: 2px;
		}
	}
	/* The filer's words keep their own line breaks. */
	.summary {
		white-space: pre-line;
		overflow-wrap: anywhere;
	}
	/* A disclosure standing on its own, outside the receipt. */
	.check {
		border: var(--border-hair) solid var(--border);
		border-radius: var(--radius-lg);
		background: var(--surface);
	}
</style>
