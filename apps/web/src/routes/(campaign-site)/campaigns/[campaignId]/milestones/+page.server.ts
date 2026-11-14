import { error } from '@sveltejs/kit';
import {
	confirmationStrength,
	isConfirmed,
	shownRelationship,
	totalDeposits,
	type Entry,
	type Party
} from '@tejido/contracts';
import {
	getCampaign,
	listDepositStatuses,
	listEntries,
	listMilestones,
	listParties
} from '@tejido/db';
import { depositTotalsView, depositView } from '#lib/campaign-site/server/deposits.ts';
import type { PageServerLoad } from './$types';

// Milestones (A3, the index): where every milestone of a campaign stands. Each one has its own
// page under `[milestoneId]/`. Everything returned here
// is shown to the public, so it is built field by field: no reporter code, no email address
// and no wallet leaves this file.

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

/** Whole days from one calendar date to a later one. Both are `YYYY-MM-DD`. */
function daysBetween(from: string, to: string): number {
	return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { db } = locals.ctx;

	const campaign = await getCampaign(db, params.campaignId);
	if (!campaign) error(404, 'No such campaign');

	const [parties, milestones, entries, deposits] = await Promise.all([
		listParties(db, campaign.id),
		listMilestones(db, campaign.id),
		// Newest first.
		listEntries(db, campaign.id),
		// Every deposit with its state: held, refunded or refund outstanding.
		listDepositStatuses(db, campaign.id)
	]);

	const partyById = new Map(parties.map((party) => [party.id, party]));
	const depositByEntry = new Map(
		deposits.deposits.map((status) => [status.deposit.entryId, status])
	);
	// Due dates are calendar dates with no time zone. A milestone is late from the day after.
	const today = new Date().toISOString().slice(0, 10);

	const rows = milestones.map((milestone) => {
		const filed = entries.filter((entry) => entry.milestoneId === milestone.id);
		const confirmed = isConfirmed(milestone);

		// The latest reported progress: the most recent work log, whatever it says.
		const latest = filed.find(
			(entry): entry is Extract<Entry, { item: 'log_work' }> => entry.item === 'log_work'
		);

		const paid = filed.flatMap((entry) => depositByEntry.get(entry.id) ?? []);

		return {
			id: milestone.id,
			position: milestone.position,
			title: milestone.title,
			description: milestone.description,
			kind: milestone.kind,
			dueDate: milestone.dueDate,
			state: milestone.state,
			/** The confirmation strength to show. Null until the milestone is confirmed. */
			strength: confirmationStrength(milestone, partyById.get(milestone.confirmerPartyId)),
			confirmedAt: milestone.confirmedAt,
			// Late: the due date has passed and nobody has confirmed it. Nothing else is assumed.
			daysLate: !confirmed && milestone.dueDate < today ? daysBetween(milestone.dueDate, today) : 0,
			owner: publicParty(partyById.get(milestone.ownerPartyId)),
			confirmer: publicParty(partyById.get(milestone.confirmerPartyId)),
			progress: latest
				? {
						entryId: latest.id,
						filedAt: latest.filedAt,
						percentComplete: latest.inputs.percent_complete ?? null,
						status: latest.inputs.status ?? null,
						period: latest.inputs.period ?? null
					}
				: null,
			entries: filed.map((entry) => ({
				id: entry.id,
				item: entry.item,
				claim: entry.item === 'milestone_hit' ? entry.inputs.claim : null,
				status: entry.status,
				filedAt: entry.filedAt,
				filedBy: partyById.get(entry.partyId)?.name ?? null,
				/** The deposit paid with this entry and its state. Null if none is on record. */
				deposit:
					paid.filter(({ deposit }) => deposit.entryId === entry.id).map(depositView)[0] ?? null
			})),
			// `held`, `refunded` and `outstanding` add up to `paid`. Once a milestone is confirmed
			// nothing on it is `held`: what has not gone back is `outstanding`.
			deposits: depositTotalsView(totalDeposits(paid))
		};
	});

	return {
		/** The server's date, so the page writes dates the same on the server and in the browser. */
		today,
		campaign: { id: campaign.id, title: campaign.title, status: campaign.status },
		milestones: rows
	};
};
