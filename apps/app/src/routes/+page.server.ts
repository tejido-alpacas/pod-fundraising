/**
 * The home page: who you are here, what is due next, and where to go. Track B owns this file.
 */
import { isConfirmed, type Milestone } from '@tejido/contracts';
import {
	getCampaign,
	getParty,
	listEntries,
	listIncompleteEntries,
	listMilestones
} from '@tejido/db';
import { daysOverdue, milestoneState } from '@tejido/ui';
import type { PageServerLoad } from './$types';

/**
 * What one milestone asks of the person looking at it.
 * - `claim`: they owe it and have not said it is done.
 * - `confirm`: it has been claimed and they are the one named to sign it off.
 * - `waiting`: someone else acts next (the confirmer, or the party doing the work).
 * - `done`: confirmed.
 */
type Step = 'claim' | 'confirm' | 'waiting' | 'done';

function stepFor(milestone: Milestone, partyId: string): Step {
	if (isConfirmed(milestone)) return 'done';
	const owes = milestone.ownerPartyId === partyId;
	if (milestone.state === 'open') return owes ? 'claim' : 'waiting';
	return owes ? 'waiting' : 'confirm';
}

export const load: PageServerLoad = async ({ locals }) => {
	const { session } = locals;
	if (!session) return { viewer: 'signed_out' as const };

	const { db } = locals.ctx;
	const party = session.partyId ? await getParty(db, session.partyId) : undefined;
	const campaign = party ? await getCampaign(db, party.campaignId) : undefined;
	if (!party || !campaign) return { viewer: 'no_party' as const, email: session.email };

	const [milestones, incomplete, entries] = await Promise.all([
		listMilestones(db, campaign.id),
		listIncompleteEntries(db, party.id),
		listEntries(db, campaign.id)
	]);
	// Only whether anything has been filed on a milestone leaves here, never the entries.
	const reportedOn = new Set(entries.map((entry) => entry.milestoneId));
	const today = new Date().toISOString().slice(0, 10);

	// Shown so the person can tell who they are signed in as, on which campaign, and what is
	// theirs to do. Never the wallet hostnames, the reporter code, the tokens, or anything
	// about the other parties.
	return {
		viewer: 'party' as const,
		email: session.email,
		party: {
			id: party.id,
			name: party.name,
			title: party.title,
			role: party.role,
			walletsLinked: party.agentWalletHostname !== null && party.primaryWalletHostname !== null
		},
		campaign: { title: campaign.title, cadence: campaign.cadence },
		incompleteReports: incomplete.length,
		milestones: milestones
			.filter(
				(milestone) =>
					milestone.ownerPartyId === party.id || milestone.confirmerPartyId === party.id
			)
			.map((milestone) => {
				const step = stepFor(milestone, party.id);
				return {
					id: milestone.id,
					position: milestone.position,
					title: milestone.title,
					dueDate: milestone.dueDate,
					part: milestone.ownerPartyId === party.id ? ('owes' as const) : ('confirms' as const),
					step,
					/** The milestone's own state, in the words donors are shown. */
					status: milestoneState(milestone, reportedOn.has(milestone.id)),
					/** Whole days past its date without being confirmed. 0 when it is not late. */
					overdueDays: daysOverdue(milestone, today),
					/** Past its date and still theirs to claim. */
					overdue: step === 'claim' && milestone.dueDate < today
				};
			})
			.sort((a, b) => a.dueDate.localeCompare(b.dueDate))
	};
};
