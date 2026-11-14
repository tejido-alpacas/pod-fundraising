import { checkEvidence, evidenceStoreOrigin } from '#lib/server/backend/evidence.ts';
import { error } from '@sveltejs/kit';
import {
	confirmationStrength,
	isConfirmed,
	shownRelationship,
	type Entry,
	type MilestoneKind,
	type Photo
} from '@tejido/contracts';
import {
	getCampaign,
	getEntry,
	getMilestone,
	getParty,
	listDeposits,
	listEntries,
	listUnrefundedDeposits
} from '@tejido/db';
import { sameTwin } from '@tejido/qatom';
import type { PageServerLoad } from './$types';

// The proof page (A2): the receipt behind one entry, for a donor who wants to check a report
// for themselves. Everything returned here is shown to the public, so it is built field by
// field: no reporter code, no email address and no primary wallet ever leaves this file.

/**
 * Milestone kinds whose evidence is documents only: no picture may be shown on them. This is
 * the rule that keeps photos of a child off a campaign.
 *
 * It repeats `documentsOnly` in KIND_RULES (lib/server/backend/checkin-rules.ts, Track C),
 * which is not exported. If that table changes, this must change with it.
 */
const DOCUMENTS_ONLY: Record<MilestoneKind, boolean> = {
	construction: false,
	goods_delivery: false,
	funds_handover: true,
	service: true
};

/** Why a file attached to the entry is not shown. */
type LeftOutReason =
	/** Its address is not a file in Tejido's evidence store. */
	| 'not_in_our_store'
	/** The hash filed with it is not the hash of the stored file. */
	| 'hash_mismatch'
	/** It is a picture, and this milestone takes documents only. */
	| 'picture_on_documents_only';

type EvidenceFile =
	| { shown: true; kind: 'photo' | 'document'; url: string; sha256: string; caption: string | null }
	| { shown: false; why: LeftOutReason; sha256: string; caption: string | null };

/**
 * Checks one attached file before it may be shown. The check-in endpoint saves an entry even
 * when its evidence is wrong (as `incomplete`), so an entry's own URL is never trusted here.
 */
function checkFile(photo: Photo, storeOrigin: string, documentsOnly: boolean): EvidenceFile {
	const caption = photo.caption ?? null;
	const leftOut = (why: LeftOutReason): EvidenceFile => ({
		shown: false,
		why,
		sha256: photo.sha256,
		caption
	});

	const verdict = checkEvidence(photo, storeOrigin);
	if (verdict === 'foreign') return leftOut('not_in_our_store');
	if (verdict === 'hash_mismatch') return leftOut('hash_mismatch');
	if (verdict === 'photo' && documentsOnly) return leftOut('picture_on_documents_only');
	return { shown: true, kind: verdict, url: photo.url, sha256: photo.sha256, caption };
}

/** Every input the contracts define for the item, except the private reporter code. */
function filedInputs(entry: Entry) {
	if (entry.item === 'log_work') {
		const { summary, status, period, percent_complete, location } = entry.inputs;
		return {
			item: entry.item,
			summary,
			status: status ?? null,
			period: period ?? null,
			percentComplete: percent_complete ?? null,
			location: location ?? null
		};
	}
	const { claim, summary, quantity, unit, amount_spent, location } = entry.inputs;
	return {
		item: entry.item,
		claim,
		summary,
		quantity: quantity ?? null,
		unit: unit ?? null,
		amountSpent: amount_spent ?? null,
		location: location ?? null
	};
}

export const load: PageServerLoad = async ({ params, locals }) => {
	const { db, config } = locals.ctx;

	const campaign = await getCampaign(db, params.campaignId);
	if (!campaign) error(404, 'No such campaign');

	// An entry id is unique across campaigns, so the address could name an entry under the
	// wrong campaign. That is not found, not shown under a campaign it does not belong to.
	const entry = await getEntry(db, params.entryId);
	if (!entry || entry.campaignId !== campaign.id) error(404, 'No such entry');

	const [milestone, filer, deposits] = await Promise.all([
		getMilestone(db, campaign.id, entry.milestoneId),
		getParty(db, entry.partyId),
		listDeposits(db, campaign.id)
	]);
	// The database requires both, so their absence is a fault of ours, not a missing page.
	if (!milestone || !filer) error(500, 'This entry is missing its milestone or its filer');

	// The deposit, and where its refund stands.
	const paid = deposits.find((deposit) => deposit.entryId === entry.id);
	let deposit: {
		amount: number;
		refund: 'returned' | 'held' | 'being_returned' | 'outcome_unknown';
		refundedAt: string | null;
	} | null = null;
	if (paid) {
		if (paid.refundedAt !== null) {
			deposit = { amount: paid.amount, refund: 'returned', refundedAt: paid.refundedAt };
		} else {
			const unrefunded = await listUnrefundedDeposits(db, campaign.id, milestone.id);
			const claim = unrefunded.find((row) => row.deposit.id === paid.id)?.claim ?? null;
			deposit = {
				amount: paid.amount,
				// A refund left `started` has not recorded an answer: `unknown` in all but name.
				refund:
					claim === null
						? 'held'
						: claim.status === 'unknown'
							? 'outcome_unknown'
							: 'being_returned',
				refundedAt: null
			};
		}
	}

	// The receipt. The agent wallet is the one deposits are paid from, so it is the one the
	// paying wallet is compared with. `sameTwin` is the comparison the reconciler uses.
	const registeredWallet: string | null = filer.agentWalletHostname;
	const walletsMatch =
		entry.payingWallet !== null && registeredWallet !== null
			? sameTwin(entry.payingWallet, registeredWallet)
			: null;

	const storeOrigin = evidenceStoreOrigin(config);
	const documentsOnly = DOCUMENTS_ONLY[milestone.kind];

	// The milestone card: where the milestone stands, its latest reported progress, and who
	// confirms it. Due dates are calendar dates with no time zone; late from the day after.
	const [confirmer, entries] = await Promise.all([
		getParty(db, milestone.confirmerPartyId),
		// Newest first.
		listEntries(db, campaign.id)
	]);
	const today = new Date().toISOString().slice(0, 10);
	const confirmed = isConfirmed(milestone);
	const latestLog = entries.find(
		(other): other is Extract<Entry, { item: 'log_work' }> =>
			other.milestoneId === milestone.id && other.item === 'log_work'
	);

	return {
		/** The server's date, so the page writes dates the same on the server and in the browser. */
		today,
		campaign: { id: campaign.id, title: campaign.title, creatorName: campaign.creatorName },
		entry: {
			id: entry.id,
			status: entry.status,
			statusReason: entry.statusReason,
			filedAt: entry.filedAt,
			updatedAt: entry.updatedAt
		},
		filed: filedInputs(entry),
		milestone: {
			id: milestone.id,
			position: milestone.position,
			title: milestone.title,
			kind: milestone.kind,
			state: milestone.state,
			dueDate: milestone.dueDate,
			confirmed,
			confirmedAt: milestone.confirmedAt,
			/** The confirmation strength to show. Null until the milestone is confirmed. */
			strength: confirmationStrength(milestone, confirmer),
			// Overdue: the due date has passed and nobody has confirmed it. Nothing else is assumed.
			daysLate:
				!confirmed && milestone.dueDate < today
					? Math.round((Date.parse(today) - Date.parse(milestone.dueDate)) / 86_400_000)
					: 0,
			/** The reporter's own figure from the latest work log. Tejido never computes one. */
			percentReported: latestLog?.inputs.percent_complete ?? null
		},
		/** The person named to confirm the milestone: who they are, never how to reach them. */
		confirmer: confirmer
			? {
					name: confirmer.name,
					title: confirmer.title,
					// Never `independent` unless recorded: unrecorded is shown as `stakeholder`.
					relationship: shownRelationship(confirmer),
					relationshipReason: confirmer.relationshipReason
				}
			: null,
		filer: {
			name: filer.name,
			title: filer.title,
			role: filer.role,
			// Never `independent` unless recorded: unrecorded is shown as `stakeholder`.
			relationship: shownRelationship(filer),
			relationshipReason: filer.relationshipReason
		},
		receipt: {
			twistId: entry.twistId,
			stampedAt: entry.stampedAt,
			payingWallet: entry.payingWallet,
			registeredWallet,
			walletsMatch
		},
		deposit,
		evidence: (entry.inputs.photos ?? []).map((photo) =>
			checkFile(photo, storeOrigin, documentsOnly)
		),
		documentsOnly
	};
};
