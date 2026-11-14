/**
 * What the header on every page needs: who is signed in, and which pages exist for them.
 * Track B owns this file.
 */
import { getCampaign, getParty, listIncompleteEntries } from '@tejido/db';
import { partyLine } from '#lib/roles.ts';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	const { session } = locals;
	if (!session) return { nav: null };

	const { db } = locals.ctx;
	const party = session.partyId ? await getParty(db, session.partyId) : undefined;
	if (!party) return { nav: { email: session.email, party: null } };

	const [incomplete, campaign] = await Promise.all([
		listIncompleteEntries(db, party.id),
		getCampaign(db, party.campaignId)
	]);
	return {
		// The header's default on every page: the project, and who is signed in on it.
		header: campaign ? { title: campaign.title, subtitle: partyLine(party) } : undefined,
		nav: {
			email: session.email,
			// Only the name and a count. Never the reporter code, the wallets or the tokens.
			party: { name: party.name, incompleteReports: incomplete.length }
		}
	};
};
