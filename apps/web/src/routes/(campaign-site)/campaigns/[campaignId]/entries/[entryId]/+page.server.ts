import { error } from '@sveltejs/kit';
import { evidenceFileStates, isConfirmed, shownRelationship, type Entry } from '@tejido/contracts';
import {
	evidenceStoreOrigin,
	getCampaign,
	getEntry,
	getMilestone,
	getParty,
	listDeposits,
	listNotPublicEvidence,
	listUnrefundedDeposits,
	takesDocumentsOnly
} from '@tejido/db';
import { sameTwin } from '@tejido/qatom';
import type { PageServerLoad } from './$types';

// The proof page (A3): the receipt behind one entry, for a donor who wants to check a report
// for themselves. Everything returned here is shown to the public, so it is built field by
// field: no reporter code, no email address and no primary wallet ever leaves this file.
//
// Each attached file is passed through `evidenceFileStates` (@tejido/contracts) before it may
// be shown. The check-in endpoint saves an entry even when its evidence is wrong (as
// `incomplete`), so an entry's own URL is never trusted here; and a file its uploader marked
// not public leaves this file as their words about it and its SHA-256, never its address.

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

	const documentsOnly = takesDocumentsOnly(milestone.kind);
	const photos = entry.inputs.photos ?? [];
	const evidence = evidenceFileStates(photos, {
		storeOrigin: evidenceStoreOrigin(config),
		documentsOnly,
		notPublic: await listNotPublicEvidence(
			db,
			photos.map((photo) => photo.sha256)
		)
	});

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
		evidence,
		documentsOnly
	};
};
