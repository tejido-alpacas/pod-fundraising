/**
 * The reminder page (B4): where a reminder's link lands. Track B owns this file.
 *
 *   /reminder?milestone={milestone id}   a milestone is due
 *   /reminder                            a work log is due
 *
 * Signed in, it says what is due from this person and opens the chat for exactly that.
 * Signed out, it says only that a report is due and offers sign-in, which comes back here.
 * Nothing on it is ever about another party's work.
 */
import { getCampaign, getParty, listEntries, listMilestones } from '@tejido/db';
import { partyMilestones } from '#lib/due.ts';
import { signInPath } from '#lib/return-to.ts';
import { chatPath, reminderFor, reminderPath } from '#lib/server/reminder.ts';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const { session } = locals;
	const { db } = locals.ctx;

	// An empty `milestone` is the same as none.
	const milestoneId = url.searchParams.get('milestone') || null;
	const here = reminderPath(milestoneId);

	const party = session?.partyId ? await getParty(db, session.partyId) : undefined;
	const campaign = party ? await getCampaign(db, party.campaignId) : undefined;

	if (!session || !party || !campaign) {
		// A sign-in is tied to a project only when it names the invited party, as an invite link
		// does. A reminder link may carry the same `party`; it is used only if we know it, and
		// only to start the sign-in. Nothing about that party is shown.
		const hint = url.searchParams.get('party');
		const invited = hint ? await getParty(db, hint) : undefined;

		// Signed out: not the project, the person or the milestone. Only where sign-in starts.
		if (!session) {
			return { viewer: 'signed_out' as const, signInHref: signInPath(here, invited?.id ?? null) };
		}
		return {
			viewer: 'no_party' as const,
			email: session.email,
			signInHref: invited ? signInPath(here, invited.id) : null
		};
	}

	const [milestones, entries] = await Promise.all([
		listMilestones(db, campaign.id),
		listEntries(db, campaign.id)
	]);
	// Only whether anything has been filed on a milestone leaves here, never the entries.
	const reportedOn = new Set(entries.map((entry) => entry.milestoneId));
	const today = new Date().toISOString().slice(0, 10);
	// This party's own milestones and no others, so the link cannot reach anyone else's.
	const theirs = partyMilestones(milestones, party.id, reportedOn, today);
	const due = reminderFor(theirs, party.role, milestoneId);

	// Never the wallet hostnames, the reporter code, the tokens, or the other parties.
	return {
		viewer: 'party' as const,
		party: { name: party.name, title: party.title, role: party.role },
		campaign: { title: campaign.title, cadence: campaign.cadence },
		due,
		/** Where the main button goes. Null when there is nothing to do. */
		chatHref:
			due.kind === 'milestone'
				? chatPath(due.milestone.id)
				: due.kind === 'work_log'
					? chatPath(null)
					: null,
		/** The reminder for the milestone listed under a work log, if there is one. */
		alsoDueHref: due.kind === 'work_log' && due.alsoDue ? reminderPath(due.alsoDue.id) : null
	};
};
