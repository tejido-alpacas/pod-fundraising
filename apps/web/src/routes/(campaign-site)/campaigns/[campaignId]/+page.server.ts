import { error, fail } from '@sveltejs/kit';
import {
	confirmationStrength,
	formatAmount,
	isConfirmed,
	shownRelationship,
	type DepositStatus,
	type Entry,
	type EvidenceNotPublic,
	type Milestone,
	type Party
} from '@tejido/contracts';
import {
	getCampaign,
	listDepositStatuses,
	getFundingSummary,
	listEntries,
	listMilestones,
	listParties
} from '@tejido/db';
import {
	confirmedCount,
	milestoneStandings,
	todayUtc
} from '#lib/campaign-site/server/delivery.ts';
import { depositView } from '#lib/campaign-site/server/deposits.ts';
import { notPublicAmong, sortEvidence } from '#lib/campaign-site/server/evidence.ts';
import {
	publishCampaign,
	publishViewer,
	type PublishRefusal
} from '#lib/campaign-site/server/publish-campaign.ts';
import type { Actions, PageServerLoad } from './$types';

/**
 * How many entries the timeline shows at first, and how many more each "Show older entries"
 * adds. A campaign files a work log per party per week, so twenty is about a month of work.
 */
const PAGE_SIZE = 20;

/** At most this many flagged entries are named in the notice above the feed. */
const FLAGGED_NAMED = 3;

// The campaign overview and donor timeline (screen A1): seeded database -> @tejido/db -> this load -> the page.
//
// Donors are the readers, so nothing leaves this function as it is stored. A stored entry
// carries the filer's reporter code in `inputs`, a party carries an email and wallets, and a
// campaign carries its creator's email. Each is rebuilt below from the fields a donor may see.
export const load = (async ({ params, locals, url }) => {
	const { db, config } = locals.ctx;

	const campaign = await getCampaign(db, params.campaignId);
	if (!campaign) error(404, 'There is no campaign at this address.');

	const [parties, milestones, entries, deposits, funding] = await Promise.all([
		listParties(db, campaign.id),
		listMilestones(db, campaign.id),
		listEntries(db, campaign.id),
		// Every deposit with its state: held, refunded or refund outstanding.
		listDepositStatuses(db, campaign.id),
		getFundingSummary(db, campaign)
	]);
	const today = todayUtc();

	// Which attached files their uploaders marked not public. Their addresses stay here.
	const notPublic = await notPublicAmong(db, entries);

	const partyById = new Map(parties.map((party) => [party.id, party]));
	const milestoneById = new Map(milestones.map((milestone) => [milestone.id, milestone]));
	const depositByEntry = new Map(
		deposits.deposits.map((status) => [status.deposit.entryId, status])
	);
	const toView = (entry: Entry) =>
		entryView(
			entry,
			partyById.get(entry.partyId),
			milestoneById.get(entry.milestoneId),
			depositByEntry.get(entry.id),
			campaign.id,
			config,
			notPublic
		);
	const standings = milestoneStandings(milestones, entries, today);

	// `listEntries` answers newest first. It has no limit of its own yet, so the cut is made
	// here: every entry is read, but only the ones shown are sent to the browser.
	const shown = Math.min(entries.length, shownCount(url.searchParams.get('show')));
	const flagged = entries.filter((entry) => entry.status === 'flagged');

	return {
		campaign: {
			id: campaign.id,
			title: campaign.title,
			summary: campaign.summary,
			beneficiary: campaign.beneficiary,
			creatorName: campaign.creatorName,
			status: campaign.status,
			/** When the campaign was set up on Tejido. Not when the work started. */
			createdAt: campaign.createdAt
		},
		/**
		 * For a draft only: whether the visitor is its creator, signed in, who may publish it.
		 * One word, never the creator's email. Null once the campaign is not a draft.
		 */
		publishing:
			campaign.status === 'draft' ? { viewer: publishViewer(locals.session, campaign) } : null,
		/**
		 * Money given, against the goal: totals from our own database, as last read from Qatom's
		 * ledger. `state: 'not_known'` is not zero. No donor is identified. A different fact from
		 * delivery (`milestones` below), and never drawn in a status colour.
		 */
		funding,
		/** The calendar date the page was built on, in UTC. "Overdue" is counted from it. */
		today,
		/** Delivery is counted in milestones. Tejido never works out a percentage. */
		delivery: { confirmed: confirmedCount(milestones), total: milestones.length },
		milestones: milestones.map((milestone, index) => ({
			id: milestone.id,
			position: milestone.position,
			title: milestone.title,
			state: milestone.state,
			/** Not started, in progress, claimed or confirmed. Overdue is separate: `overdueDays`. */
			status: standings[index]!.status,
			overdueDays: standings[index]!.overdueDays,
			/** The confirmation strength to show. Null until the milestone is confirmed. */
			strength: confirmationStrength(milestone, partyById.get(milestone.confirmerPartyId)),
			dueDate: milestone.dueDate,
			confirmedAt: milestone.confirmedAt,
			ownerName: partyById.get(milestone.ownerPartyId)?.name ?? null,
			confirmerName: partyById.get(milestone.confirmerPartyId)?.name ?? null,
			/** The newest "percent complete" a work log reported. The reporter's own figure. */
			reportedPercent: latestReportedPercent(entries, milestone.id)
		})),
		/** Who is involved, besides the organiser. Built field by field: no email, code or wallet. */
		parties: parties.map((party) => ({
			id: party.id,
			name: party.name,
			title: party.title,
			role: party.role,
			// Never `independent` unless recorded: unrecorded is shown as `stakeholder`.
			relationship: shownRelationship(party),
			relationshipRecorded: party.relationship !== null,
			relationshipReason: party.relationshipReason
		})),
		entries: entries.slice(0, shown).map(toView),
		total: entries.length,
		/** The `show` value that reveals the next page, or null when everything is shown. */
		nextShow: shown < entries.length ? Math.min(entries.length, shown + PAGE_SIZE) : null,
		/**
		 * Flagged entries are counted over the whole campaign, not just the entries shown, so a
		 * donor is told about one even when it is further down than the first page.
		 */
		flagged: {
			count: flagged.length,
			named: flagged.slice(0, FLAGGED_NAMED).map((entry) => {
				const { id, heading, milestoneTitle, filedAt, proofPath } = toView(entry);
				return { id, heading, milestoneTitle, filedAt, proofPath };
			})
		}
	};
}) satisfies PageServerLoad;

const REFUSED_STATUS: Record<PublishRefusal, number> = {
	no_campaign: 404,
	signed_out: 401,
	someone_else: 403,
	not_draft: 409
};

export const actions = {
	/**
	 * Publishes this campaign: draft to funding, and nothing else. Only its creator, signed in
	 * with Qatom, may. The check is made here whatever the page showed.
	 */
	publish: async ({ params, locals }) => {
		const outcome = await publishCampaign(locals.ctx.db, locals.session, params.campaignId);
		if (!outcome.published) {
			return fail(REFUSED_STATUS[outcome.reason], { published: false, reason: outcome.reason });
		}
		return { published: true };
	}
} satisfies Actions;

/** Reads `?show=`. Anything that is not a whole number of at least one page means one page. */
function shownCount(value: string | null): number {
	if (value === null || !/^\d{1,6}$/.test(value)) return PAGE_SIZE;
	return Math.max(PAGE_SIZE, Number(value));
}

/** What the timeline shows of one entry. Built field by field: nothing private is copied. */
function entryView(
	entry: Entry,
	party: Party | undefined,
	milestone: Milestone | undefined,
	deposit: DepositStatus | undefined,
	campaignId: string,
	config: Parameters<typeof sortEvidence>[2],
	notPublic: ReadonlyMap<string, EvidenceNotPublic>
) {
	const { inputs } = entry;
	const isClaim = entry.item === 'milestone_hit';
	const isConfirmation = isClaim && entry.inputs.claim === 'confirm';
	const milestoneConfirmed = milestone !== undefined && isConfirmed(milestone);

	return {
		id: entry.id,
		/** What the entry is: a routine work log, a claim that a milestone is done, or its sign-off. */
		kind:
			entry.item === 'log_work'
				? ('work_log' as const)
				: entry.inputs.claim === 'confirm'
					? ('confirmation' as const)
					: ('claim' as const),
		heading: headingOf(entry),
		/** For a claim: what the party says happened. Null for a work log or a confirmation. */
		claim: isClaim && entry.inputs.claim !== 'confirm' ? entry.inputs.claim : null,
		milestoneId: entry.milestoneId,
		milestoneTitle: milestone?.title ?? null,
		milestonePosition: milestone?.position ?? null,
		/**
		 * What this entry did to its milestone, shown as a second badge: a claim on a milestone
		 * that is claimed (or since confirmed), or a confirmation of one that is confirmed. Null
		 * for a work log, and for a claim or confirmation that did not move the milestone.
		 */
		milestoneBadge: !isClaim
			? null
			: isConfirmation
				? milestoneConfirmed
					? ('confirmed' as const)
					: null
				: milestone !== undefined && milestone.state !== 'open'
					? ('claimed' as const)
					: null,
		/**
		 * For a confirmation: how the person who filed it relates to the project. Never
		 * `independent` unless recorded: an unrecorded relationship shows as stakeholder.
		 */
		strength: isConfirmation ? shownRelationship(party) : null,
		/**
		 * The filing deposit paid with this entry and which of its three states it is in, or null
		 * if none is on record. The state is worked out once, in @tejido/db.
		 */
		deposit: deposit ? depositOf(deposit) : null,
		filer: party
			? {
					name: party.name,
					title: party.title,
					role: party.role,
					// Never `independent` unless recorded: unrecorded is shown as `stakeholder`.
					relationship: shownRelationship(party),
					relationshipReason: party.relationshipReason
				}
			: null,
		filedAt: entry.filedAt,
		status: entry.status,
		statusReason: entry.statusReason,
		summary: inputs.summary,
		workStatus: entry.item === 'log_work' ? (entry.inputs.status ?? null) : null,
		percentComplete: entry.item === 'log_work' ? (entry.inputs.percent_complete ?? null) : null,
		period: entry.item === 'log_work' ? entry.inputs.period || null : null,
		quantity: isClaim ? (entry.inputs.quantity ?? null) : null,
		unit: isClaim ? entry.inputs.unit || null : null,
		amountSpent: isClaim ? (entry.inputs.amount_spent ?? null) : null,
		location: inputs.location || null,
		evidence: sortEvidence(inputs.photos, milestone?.kind, config, notPublic),
		proofPath: `/campaigns/${campaignId}/entries/${entry.id}`
	};
}

/** What the timeline shows of a deposit: the amount as written, its state, and why. */
function depositOf(status: DepositStatus) {
	const { amount, state, label, outstandingMeaning } = depositView(status);
	return { amount: formatAmount(amount), state, label, outstandingMeaning };
}

/** The newest percent complete reported on a milestone. `entries` is newest first. */
function latestReportedPercent(entries: readonly Entry[], milestoneId: string): number | null {
	for (const entry of entries) {
		if (entry.milestoneId !== milestoneId || entry.item !== 'log_work') continue;
		if (entry.inputs.percent_complete !== undefined) return entry.inputs.percent_complete;
	}
	return null;
}

function headingOf(entry: Entry): string {
	if (entry.item === 'log_work') return 'Work log';
	if (entry.inputs.claim === 'confirm') return 'Confirmation';
	return 'Milestone claim';
}

export type TimelineEntry = ReturnType<typeof entryView>;
