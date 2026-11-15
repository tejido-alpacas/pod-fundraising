/**
 * The home page: who you are here, what is due next, and where to go. Track B owns this file.
 */
import {
	getCampaign,
	getParty,
	listEntries,
	listIncompleteEntries,
	listMilestones
} from '@tejido/db';
import { partyMilestones } from '#lib/due.ts';
import type { PageServerLoad } from './$types';

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
		// What is theirs to do is worked out in one place: `#lib/due.ts`.
		milestones: partyMilestones(milestones, party.id, reportedOn, today)
	};
};
