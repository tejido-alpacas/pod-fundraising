import { depositView, type DepositView } from '#lib/campaign-site/server/deposits.ts';
import { checkEvidence, evidenceStoreOrigin } from '#lib/server/backend/evidence.ts';
import { error } from '@sveltejs/kit';
import {
	isConfirmed,
	shownRelationship,
	type Entry,
	type MilestoneKind,
	type Photo
} from '@tejido/contracts';
import { getCampaign, getEntry, getMilestone, getParty, listDepositStatuses } from '@tejido/db';
import { sameTwin } from '@tejido/qatom';
import type { PageServerLoad } from './$types';

// The proof page (A3): the receipt behind one entry, for a donor who wants to check a report
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
		listDepositStatuses(db, campaign.id, { entryId: entry.id })
	]);
	// The database requires both, so their absence is a fault of ours, not a missing page.
	if (!milestone || !filer) error(500, 'This entry is missing its milestone or its filer');

	// The deposit, and which of the three states it is in. `refund` is the older, finer wording
	// the page was written against; `state` and `label` are the ones to show.
	const [paid] = deposits.deposits;
	let deposit:
		(DepositView & { refund: 'returned' | 'held' | 'being_returned' | 'outcome_unknown' }) | null =
		null;
	if (paid) {
		deposit = {
			...depositView(paid),
			refund:
				paid.state === 'refunded'
					? 'returned'
					: paid.outstandingReason === 'outcome_unknown'
						? 'outcome_unknown'
						: // A refund left `started` has not recorded an answer.
							paid.outstandingReason === 'in_progress'
							? 'being_returned'
							: 'held'
		};
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

	return {
		campaign: { id: campaign.id, title: campaign.title },
		entry: {
			id: entry.id,
			status: entry.status,
			statusReason: entry.statusReason,
			filedAt: entry.filedAt
		},
		filed: filedInputs(entry),
		milestone: {
			id: milestone.id,
			title: milestone.title,
			kind: milestone.kind,
			confirmed: isConfirmed(milestone)
		},
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
