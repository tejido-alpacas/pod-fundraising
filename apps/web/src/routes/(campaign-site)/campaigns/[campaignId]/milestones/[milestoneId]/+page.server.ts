import { error } from '@sveltejs/kit';
import {
	confirmationStrength,
	isConfirmed,
	isRefunded,
	shownRelationship,
	type Entry,
	type Party
} from '@tejido/contracts';
import { getCampaign, listDeposits, listEntries, listMilestones, listParties } from '@tejido/db';
import { sortEvidence } from '#lib/campaign-site/server/evidence.ts';
import type { PageServerLoad } from './$types';

// Milestone detail (A3): one milestone, what was planned and what has been reported on it, who
// confirms it, its evidence, its history and its deposits. Everything returned here is shown to
// the public, so it is built field by field: no reporter code, no email address and no wallet
// leaves this file, and no file is sent that the evidence checks reject.

/** Donors see who a party is, never how to reach them. */
function publicParty(party: Party | undefined) {
	return party
		? {
				name: party.name,
				title: party.title,
				role: party.role,
				// Never `independent` unless recorded: unrecorded is shown as `stakeholder`.
				relationship: shownRelationship(party),
				/** False when nobody recorded a relationship, so the page can say so. */
				relationshipRecorded: party.relationship !== null,
				relationshipReason: party.relationshipReason
			}
		: null;
}

/** Whole days from one calendar date to a later one. Both are `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export const load: PageServerLoad = async ({ params, locals }) => {
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

	// A milestone id is unique within its campaign only, so it is looked up among this
	// campaign's own milestones.
	const milestone = milestones.find((candidate) => candidate.id === params.milestoneId);
	if (!milestone) error(404, 'This campaign has no milestone at this address.');

	const partyById = new Map(parties.map((party) => [party.id, party]));
	const depositByEntry = new Map(deposits.map((deposit) => [deposit.entryId, deposit]));
	const confirmer = partyById.get(milestone.confirmerPartyId);
	const filed = entries.filter((entry) => entry.milestoneId === milestone.id);
	const confirmed = isConfirmed(milestone);
	// Due dates are calendar dates with no time zone. A milestone is late from the day after.
	const today = new Date().toISOString().slice(0, 10);

	// The latest reported progress, and the latest claim that the milestone is done.
	const latestLog = filed.find(
		(entry): entry is Extract<Entry, { item: 'log_work' }> => entry.item === 'log_work'
	);
	const latestClaim = filed.find(
		(entry): entry is Extract<Entry, { item: 'milestone_hit' }> =>
			entry.item === 'milestone_hit' && entry.inputs.claim !== 'confirm'
	);

	// Evidence from every entry on the milestone, oldest first. Each file is checked on the
	// server: only files in our own store, with a matching hash, and no picture on a milestone
	// that takes documents only. A file that fails is counted, never sent.
	const evidence: {
		entryId: string;
		filedAt: string;
		kind: 'photo' | 'document';
		url: string;
		sha256: string;
		caption: string | null;
	}[] = [];
	let leftOut = 0;
	for (const entry of filed.toReversed()) {
		const sorted = sortEvidence(entry.inputs.photos, milestone.kind, config);
		const from = { entryId: entry.id, filedAt: entry.filedAt };
		for (const file of sorted.photos) evidence.push({ ...from, kind: 'photo', ...file });
		for (const file of sorted.documents) evidence.push({ ...from, kind: 'document', ...file });
		leftOut += sorted.leftOut;
	}

	let paid = 0;
	let returned = 0;
	let depositCount = 0;
	for (const entry of filed) {
		const deposit = depositByEntry.get(entry.id);
		if (!deposit) continue;
		depositCount += 1;
		paid += deposit.amount;
		if (isRefunded(deposit)) returned += deposit.amount;
	}

	const statusCount = (status: Entry['status']) =>
		filed.filter((entry) => entry.status === status).length;

	return {
		/** The server's date, so the page writes dates the same on the server and in the browser. */
		today,
		campaign: { id: campaign.id, title: campaign.title, creatorName: campaign.creatorName },
		/** How many milestones the campaign has, for "Milestone 2 of 3". */
		total: milestones.length,
		milestone: {
			id: milestone.id,
			position: milestone.position,
			title: milestone.title,
			description: milestone.description,
			kind: milestone.kind,
			dueDate: milestone.dueDate,
			state: milestone.state,
			confirmed,
			confirmedAt: milestone.confirmedAt,
			/** The confirmation strength to show. Null until the milestone is confirmed. */
			strength: confirmationStrength(milestone, confirmer),
			// Overdue: the due date has passed and nobody has confirmed it. Nothing else is assumed.
			daysLate: !confirmed && milestone.dueDate < today ? daysBetween(milestone.dueDate, today) : 0
		},
		owner: publicParty(partyById.get(milestone.ownerPartyId)),
		/** The person named to confirm it. A creator sign-off is told apart by the state. */
		confirmer: publicParty(confirmer),
		/** How the filings on this milestone stand, by filing status. */
		filings: {
			total: filed.length,
			verified: statusCount('verified'),
			pending: statusCount('filed'),
			flagged: statusCount('flagged'),
			incomplete: statusCount('incomplete')
		},
		/** The latest work log's own figures. Tejido never computes a percentage. */
		progress: latestLog
			? {
					entryId: latestLog.id,
					filedAt: latestLog.filedAt,
					percentComplete: latestLog.inputs.percent_complete ?? null,
					status: latestLog.inputs.status ?? null,
					period: latestLog.inputs.period ?? null
				}
			: null,
		/** The latest claim that the milestone is done, in the filer's own figures. */
		claim: latestClaim
			? {
					entryId: latestClaim.id,
					filedAt: latestClaim.filedAt,
					claim: latestClaim.inputs.claim,
					quantity: latestClaim.inputs.quantity ?? null,
					unit: latestClaim.inputs.unit ?? null
				}
			: null,
		/** What incomplete entries are still missing, in the words saved with each. */
		missing: filed
			.filter((entry) => entry.status === 'incomplete' && entry.statusReason !== null)
			.map((entry) => ({ entryId: entry.id, reason: entry.statusReason ?? '' })),
		evidence,
		/** How many attached files are not shown because a check failed. */
		leftOut,
		/** Every entry on the milestone, newest first, for the history and its proof links. */
		entries: filed.map((entry) => ({
			id: entry.id,
			item: entry.item,
			claim: entry.item === 'milestone_hit' ? entry.inputs.claim : null,
			status: entry.status,
			filedAt: entry.filedAt,
			filedBy: partyById.get(entry.partyId)?.name ?? null
		})),
		deposits: { count: depositCount, paid, returned }
	};
};
