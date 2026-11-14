import { error } from '@sveltejs/kit';
import type { Entry, EvidenceNotPublic, Milestone, Party } from '@tejido/contracts';
import { getCampaign, listEntries, listMilestones, listParties } from '@tejido/db';
import { notPublicAmong, sortEvidence } from '#lib/campaign-site/server/evidence.ts';
import type { PageServerLoad } from './$types';

/**
 * How many entries the timeline shows at first, and how many more each "Show older entries"
 * adds. A campaign files a work log per party per week, so twenty is about a month of work.
 */
const PAGE_SIZE = 20;

/** At most this many flagged entries are named in the notice above the feed. */
const FLAGGED_NAMED = 3;

// The donor timeline (A2): seeded database -> @tejido/db -> this load -> the page.
//
// Donors are the readers, so nothing leaves this function as it is stored. A stored entry
// carries the filer's reporter code in `inputs`, a party carries an email and wallets, and a
// campaign carries its creator's email. Each is rebuilt below from the fields a donor may see.
export const load = (async ({ params, locals, url }) => {
	const { db, config } = locals.ctx;

	const campaign = await getCampaign(db, params.campaignId);
	if (!campaign) error(404, 'There is no campaign at this address.');

	const [parties, milestones, entries] = await Promise.all([
		listParties(db, campaign.id),
		listMilestones(db, campaign.id),
		listEntries(db, campaign.id)
	]);

	// Which attached files their uploaders marked not public. Their addresses stay here.
	const notPublic = await notPublicAmong(db, entries);

	const partyById = new Map(parties.map((party) => [party.id, party]));
	const milestoneById = new Map(milestones.map((milestone) => [milestone.id, milestone]));
	const toView = (entry: Entry) =>
		entryView(
			entry,
			partyById.get(entry.partyId),
			milestoneById.get(entry.milestoneId),
			campaign.id,
			config,
			notPublic
		);

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
			status: campaign.status
		},
		milestones: milestones.map(({ id, title, state, dueDate }) => ({ id, title, state, dueDate })),
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
	campaignId: string,
	config: Parameters<typeof sortEvidence>[2],
	notPublic: ReadonlyMap<string, EvidenceNotPublic>
) {
	const { inputs } = entry;
	const isClaim = entry.item === 'milestone_hit';

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
		filer: party ? { name: party.name, title: party.title, role: party.role } : null,
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

function headingOf(entry: Entry): string {
	if (entry.item === 'log_work') return 'Work log';
	if (entry.inputs.claim === 'confirm') return 'Confirmation';
	return 'Milestone claim';
}

export type TimelineEntry = ReturnType<typeof entryView>;
