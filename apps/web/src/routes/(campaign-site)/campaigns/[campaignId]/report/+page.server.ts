import { error } from '@sveltejs/kit';
import {
	confirmationStrength,
	isConfirmed,
	isRefunded,
	shownRelationship,
	type Campaign,
	type Entry,
	type Milestone,
	type Party
} from '@tejido/contracts';
import {
	getCampaign,
	listDeposits,
	listEntries,
	listMilestones,
	listParties,
	listRefunds
} from '@tejido/db';
import { sortEvidence } from '#lib/campaign-site/server/evidence.ts';
import type { PageServerLoad } from './$types';

// The final report (A4): the closing page of a campaign. Every milestone, who confirmed it,
// when and how strongly, the evidence behind it, and what became of the deposits.
//
// Donors are the readers, so nothing leaves this file as it is stored. A stored entry carries
// the filer's reporter code, a party carries an email address, and a campaign carries its
// creator's email address. Everything below is rebuilt from the fields a donor may see. Wallet
// hostnames and transaction ids are public receipts and are shown.

type Config = Parameters<typeof sortEvidence>[2];

/** Donors see who a party is, never how to reach them. */
function publicParty(party: Party | undefined) {
	return party
		? {
				name: party.name,
				title: party.title,
				role: party.role,
				// Never `independent` unless recorded: unrecorded is shown as `stakeholder`.
				relationship: shownRelationship(party),
				relationshipReason: party.relationshipReason
			}
		: null;
}

type Claim = Extract<Entry, { item: 'milestone_hit' }>;

/**
 * Who confirmed a milestone, taken from its state and nothing else.
 *
 * `confirmed_independent` means the confirmer named on the milestone signed it off, and
 * `confirmed_creator` means the campaign's creator did. A creator is not a party, so only
 * the name the campaign gives is known.
 */
function confirmedBy(milestone: Milestone, campaign: Campaign, confirmer: Party | undefined) {
	if (milestone.state === 'confirmed_independent') {
		return confirmer
			? {
					who: 'confirmer' as const,
					name: confirmer.name,
					title: confirmer.title,
					relationship: shownRelationship(confirmer),
					relationshipReason: confirmer.relationshipReason
				}
			: null;
	}
	if (milestone.state === 'confirmed_creator') {
		// The creator runs the project: always a participant.
		return {
			who: 'creator' as const,
			name: campaign.creatorName,
			title: null,
			relationship: 'participant' as const,
			relationshipReason: null
		};
	}
	return null;
}

export const load = (async ({ params, locals }) => {
	const { db, config } = locals.ctx;

	const campaign = await getCampaign(db, params.campaignId);
	if (!campaign) error(404, 'There is no campaign at this address.');

	const [parties, milestones, entries, deposits] = await Promise.all([
		listParties(db, campaign.id),
		listMilestones(db, campaign.id),
		// Newest first.
		listEntries(db, campaign.id),
		listDeposits(db, campaign.id)
	]);
	// Refund transfers are recorded per milestone.
	const refundsByMilestone = await Promise.all(
		milestones.map((milestone) => listRefunds(db, campaign.id, milestone.id))
	);

	const partyById = new Map(parties.map((party) => [party.id, party]));
	const depositByEntry = new Map(deposits.map((deposit) => [deposit.entryId, deposit]));

	const rows = milestones.map((milestone, index) =>
		milestoneView(
			milestone,
			campaign,
			entries.filter((entry) => entry.milestoneId === milestone.id),
			refundsByMilestone[index] ?? [],
			partyById,
			depositByEntry,
			config
		)
	);

	// Delivered means every milestone is confirmed. It is worked out from the milestones, not
	// read from the campaign's status, so the page can never call unfinished work finished.
	const delivered = rows.length > 0 && rows.every((row) => row.confirmed);
	const confirmedTimes = rows.flatMap((row) => (row.confirmedAt ? [row.confirmedAt] : []));

	const totals = { workLogs: 0, entries: 0, flagged: 0, paid: 0, returned: 0 };
	for (const row of rows) {
		totals.workLogs += row.workLogs;
		totals.entries += row.entryCount;
		totals.flagged += row.flaggedCount;
		totals.paid += row.deposits.paid;
		totals.returned += row.deposits.returned;
	}

	const positionOf = new Map(milestones.map((milestone) => [milestone.id, milestone.position]));

	return {
		/** The server's date, so the page writes dates the same on the server and in the browser. */
		today: new Date().toISOString().slice(0, 10),
		/**
		 * Every filing that is not simply verified: flagged, incomplete, or not yet matched to its
		 * receipt. Oldest first. A flagged filing stays here for good: the flag is never removed.
		 */
		attention: entries
			.filter((entry) => entry.status !== 'verified')
			.toReversed()
			.map((entry) => ({
				entryId: entry.id,
				status: entry.status,
				statusReason: entry.statusReason,
				item: entry.item,
				claim: entry.item === 'milestone_hit' ? entry.inputs.claim : null,
				filedAt: entry.filedAt,
				filedBy: partyById.get(entry.partyId)?.name ?? null,
				milestonePosition: positionOf.get(entry.milestoneId) ?? null,
				proofPath: proofPath(campaign.id, entry.id)
			})),
		campaign: {
			id: campaign.id,
			title: campaign.title,
			summary: campaign.summary,
			beneficiary: campaign.beneficiary,
			creatorName: campaign.creatorName,
			status: campaign.status
		},
		delivered,
		/** When the last milestone was confirmed. Null unless delivered and every time is on record. */
		deliveredAt:
			delivered && confirmedTimes.length === rows.length
				? confirmedTimes.reduce((latest, time) => (time > latest ? time : latest))
				: null,
		milestones: rows,
		/** What still stands between this campaign and delivered: every unconfirmed milestone. */
		outstanding: rows
			.filter((row) => !row.confirmed)
			.map(({ id, title, state, dueDate, owner, namedConfirmer }) => ({
				id,
				title,
				state,
				dueDate,
				owner,
				namedConfirmer
			})),
		totals: {
			milestones: rows.length,
			confirmed: rows.filter((row) => row.confirmed).length,
			/** Confirmed milestones by the strength shown for each. */
			byStrength: {
				participant: rows.filter((row) => row.strength === 'participant').length,
				stakeholder: rows.filter((row) => row.strength === 'stakeholder').length,
				independent: rows.filter((row) => row.strength === 'independent').length
			},
			byCreator: rows.filter((row) => row.state === 'confirmed_creator').length,
			...totals
		}
	};
}) satisfies PageServerLoad;

/** What the report shows of one milestone. Built field by field: nothing private is copied. */
function milestoneView(
	milestone: Milestone,
	campaign: Campaign,
	/** The entries filed on this milestone, newest first. */
	filed: Entry[],
	refunds: Awaited<ReturnType<typeof listRefunds>>,
	partyById: Map<string, Party>,
	depositByEntry: Map<string, { amount: number; refundedAt: string | null }>,
	config: Config
) {
	const confirmed = isConfirmed(milestone);
	const confirmer = partyById.get(milestone.confirmerPartyId);

	// The evidence behind a milestone is what was filed to claim it and to confirm it. Work logs
	// are counted, and can be read on the timeline.
	const claims = filed.filter((entry): entry is Claim => entry.item === 'milestone_hit');
	// The sign-off itself: the newest confirmation filed on this milestone, if it is confirmed.
	const signOff = confirmed ? claims.find((entry) => entry.inputs.claim === 'confirm') : undefined;

	let paid = 0;
	let returned = 0;
	let lastRefundedAt: string | null = null;
	for (const entry of filed) {
		const deposit = depositByEntry.get(entry.id);
		if (!deposit) continue;
		paid += deposit.amount;
		if (isRefunded(deposit)) {
			returned += deposit.amount;
			if (deposit.refundedAt && (lastRefundedAt === null || deposit.refundedAt > lastRefundedAt)) {
				lastRefundedAt = deposit.refundedAt;
			}
		}
	}

	// The latest claim that the work is done, in the filer's own figures.
	const latestClaim = claims.find((entry) => entry.inputs.claim !== 'confirm');

	return {
		id: milestone.id,
		position: milestone.position,
		/** What the party doing the work last reported as done. Null when nothing was claimed. */
		reported: latestClaim
			? {
					claim: latestClaim.inputs.claim,
					quantity: latestClaim.inputs.quantity ?? null,
					unit: latestClaim.inputs.unit ?? null,
					filedAt: latestClaim.filedAt
				}
			: null,
		title: milestone.title,
		description: milestone.description,
		kind: milestone.kind,
		dueDate: milestone.dueDate,
		state: milestone.state,
		/** The confirmation strength to show. Null until the milestone is confirmed. */
		strength: confirmationStrength(milestone, confirmer),
		confirmed,
		confirmedAt: milestone.confirmedAt,
		owner: publicParty(partyById.get(milestone.ownerPartyId)),
		/** The confirmer the creator named. Who actually confirmed is `confirmedBy`. */
		namedConfirmer: publicParty(confirmer),
		confirmedBy: confirmedBy(milestone, campaign, confirmer),
		/** The receipt of the sign-off. Null when the milestone is unconfirmed or none is on record. */
		signOff: signOff
			? {
					entryId: signOff.id,
					filedBy: partyById.get(signOff.partyId)?.name ?? null,
					filedAt: signOff.filedAt,
					status: signOff.status,
					twistId: signOff.twistId,
					payingWallet: signOff.payingWallet,
					proofPath: proofPath(campaign.id, signOff.id)
				}
			: null,
		evidence: claims.map((entry) => ({
			entryId: entry.id,
			kind: entry.inputs.claim === 'confirm' ? ('confirmation' as const) : ('claim' as const),
			claim: entry.inputs.claim,
			filedBy: publicParty(partyById.get(entry.partyId)),
			filedAt: entry.filedAt,
			status: entry.status,
			summary: entry.inputs.summary,
			// Checked on the server: only files in our own store, with a matching hash, and no
			// picture on a milestone that takes documents only.
			files: sortEvidence(entry.inputs.photos, milestone.kind, config),
			proofPath: proofPath(campaign.id, entry.id)
		})),
		workLogs: filed.filter((entry) => entry.item === 'log_work').length,
		entryCount: filed.length,
		flaggedCount: filed.filter((entry) => entry.status === 'flagged').length,
		deposits: { paid, returned, lastRefundedAt },
		// The transfers that sent deposits back. A refused transfer moved nothing and is left out.
		refunds: refunds
			.filter((refund) => refund.status !== 'failed')
			.map((refund) => ({
				to: partyById.get(refund.partyId)?.name ?? null,
				/** Always a primary wallet: refunds are never sent to an agent wallet. */
				wallet: refund.primaryWalletHostname,
				amount: refund.amount,
				// `started` means the server stopped part-way: its outcome is as unknown as `unknown`.
				outcome: refund.status === 'sent' ? ('sent' as const) : ('unknown' as const),
				at: refund.status === 'sent' ? refund.settledAt : null
			}))
	};
}

function proofPath(campaignId: string, entryId: string): string {
	return `/campaigns/${campaignId}/entries/${entryId}`;
}

export type ReportMilestone = ReturnType<typeof milestoneView>;
