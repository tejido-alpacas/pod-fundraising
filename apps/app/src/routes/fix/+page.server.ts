/**
 * Fix an incomplete entry (B5). Track B owns this file.
 *
 * A report that reached us with something missing was saved as `incomplete`: its deposit had
 * already been paid, so it was not refused. Here the party who filed it adds the missing
 * photos or documents. Nothing is bought and nothing is paid: this file never touches Qatom.
 *
 * WHAT CAN CHANGE. Only the entry's list of files, and only by adding to it. The files
 * already there stay. The note, the times, the milestone, the payer and the transaction are
 * never touched (`addEvidenceToIncompleteEntry` in @tejido/db cannot change them).
 *
 * WHO. Only the party who filed the entry, and only while it is `incomplete`.
 *
 * NOT-PUBLIC FILES. A file marked not public on the upload page can be pasted in here like
 * any other, but it never counts as the photo or document a claim owes to donors
 * (`decideCheckin`). A file chosen here is stored without that choice.
 *
 * THE RULES are the check-in endpoint's own (`decideCheckin` in @tejido/db), applied again to
 * the entry with the new files added. If they find nothing missing, the entry stops being
 * `incomplete`. If something is still missing, the good files are kept and the reason is
 * brought up to date.
 *
 * THE MILESTONE AND REFUNDS are left alone. A claim moved its milestone to `claimed` when it
 * was filed, complete or not, so completing it has nothing to move. Refunds are decided by
 * Track C's refund job from the reconciler's work, and nothing here sends or schedules one.
 * The one case where completing an entry would move a milestone (a confirmation filed before
 * anything was claimed) is turned away: the check-in endpoint says such a confirmation "has
 * to be filed again", and a milestone should not become confirmed from this page.
 */
import { fail } from '@sveltejs/kit';
import {
	EVIDENCE_CONTENT_TYPES,
	EVIDENCE_FILE_FIELD,
	evidenceReferenceSchema,
	MAX_PHOTOS_PER_ENTRY,
	type CheckinInputs,
	type Entry,
	type EvidenceReference,
	type Milestone
} from '@tejido/contracts';
import {
	addEvidenceToIncompleteEntry,
	checkEvidence,
	decideCheckin,
	evidenceStoreOrigin,
	getEntry,
	getMilestone,
	getParty,
	listIncompleteEntries,
	listNotPublicEvidence,
	listMilestones,
	takesDocumentsOnly
} from '@tejido/db';
import { checkEvidenceFile, PROBLEM_SENTENCES } from '#lib/evidence.ts';
import { storeEvidence } from '#lib/server/evidence.ts';
import type { Actions, PageServerLoad } from './$types';

/** The name of the form field that says which entry, and of the one for pasted files. */
const ENTRY_FIELD = 'entry';
const PASTED_FIELD = 'uploaded';

const NOT_YOURS =
	'That report is not one of yours, so nothing was changed. You can only add to a report you filed yourself.';
const NOT_INCOMPLETE =
	'That report is not missing anything, so it cannot be changed. Nothing was changed.';
const CHANGED_MEANWHILE =
	'That report changed while you were adding to it, so nothing was added. Open this page again and try once more.';

function kindOfReport(entry: Entry): 'work_log' | 'claim' | 'confirmation' {
	if (entry.item === 'log_work') return 'work_log';
	return entry.inputs.claim === 'confirm' ? 'confirmation' : 'claim';
}

/** What the page shows of one entry. Never the reporter code, and never the whole inputs. */
function shown(
	entry: Entry,
	milestone: Milestone | undefined,
	notPublic: ReadonlyMap<string, { kind: string; reason: string }>
) {
	const photos = entry.inputs.photos ?? [];
	const attached = photos.length;
	return {
		id: entry.id,
		milestoneTitle: milestone?.title ?? entry.milestoneId,
		milestonePosition: milestone?.position ?? null,
		report: kindOfReport(entry),
		summary: entry.inputs.summary,
		filedAt: entry.filedAt,
		/** Why it is incomplete, in the words donors are shown. */
		missing: entry.statusReason,
		attached,
		/**
		 * The attached files kept from donors, in the two lines donors are shown for each. They
		 * are saved, but do not count as the photo or document a report owes to donors.
		 */
		notPublic: photos.flatMap((photo) => {
			const words = notPublic.get(photo.sha256);
			return words ? [{ kind: words.kind, reason: words.reason }] : [];
		}),
		room: MAX_PHOTOS_PER_ENTRY - attached,
		documentsOnly: milestone ? takesDocumentsOnly(milestone.kind) : false
	};
}

/** What the layout draws above the page: the design's field header, with a way back. */
const HEADER: { title: string; subtitle?: string; backHref: string } = {
	title: 'Fix an entry',
	backHref: '/'
};

export const load: PageServerLoad = async ({ locals }) => {
	const { session } = locals;
	const none: ReturnType<typeof shown>[] = [];
	if (!session) {
		return { header: HEADER, viewer: 'signed_out' as const, email: null, entries: none };
	}

	const { db } = locals.ctx;
	const party = session.partyId ? await getParty(db, session.partyId) : undefined;
	if (!party) {
		return { header: HEADER, viewer: 'no_party' as const, email: session.email, entries: none };
	}

	const [entries, milestones] = await Promise.all([
		listIncompleteEntries(db, party.id),
		listMilestones(db, party.campaignId)
	]);
	const notPublic = await listNotPublicEvidence(
		db,
		entries.flatMap((entry) => (entry.inputs.photos ?? []).map((photo) => photo.sha256))
	);
	// With one incomplete report the header names its milestone. With several, the person
	// chooses on the page, so the header names none.
	const only = entries.length === 1 ? entries[0] : undefined;
	const onlyMilestone = only
		? milestones.find((milestone) => milestone.id === only.milestoneId)
		: undefined;
	return {
		header: onlyMilestone
			? { ...HEADER, subtitle: `${onlyMilestone.title} · Milestone ${onlyMilestone.position}` }
			: HEADER,
		viewer: 'party' as const,
		email: session.email,
		entries: entries.map((entry) =>
			shown(
				entry,
				milestones.find((milestone) => milestone.id === entry.milestoneId),
				notPublic
			)
		)
	};
};

/** The entry with more files, in the shape the check-in rules take. */
function withFiles(entry: Entry, added: EvidenceReference[]): CheckinInputs {
	const photos = [...(entry.inputs.photos ?? []), ...added];
	return entry.item === 'log_work'
		? { item: entry.item, inputs: { ...entry.inputs, photos } }
		: { item: entry.item, inputs: { ...entry.inputs, photos } };
}

/**
 * Reads what was pasted from the upload page: one `{ url, sha256 }` or a list of them.
 * Null when it is not that.
 */
function readPasted(text: string): EvidenceReference[] | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	const found: EvidenceReference[] = [];
	for (const item of Array.isArray(value) ? value : [value]) {
		const parsed = evidenceReferenceSchema.safeParse(item);
		if (!parsed.success) return null;
		found.push(parsed.data);
	}
	return found;
}

/** A file to add, with the name the person knows it by. */
interface Candidate extends EvidenceReference {
	name: string;
	/** True when it was stored by this request, so it is known to be in the store. */
	storedNow: boolean;
}

export const actions = {
	attach: async ({ request, locals }) => {
		// Before anything is read or stored.
		const { session } = locals;
		if (!session) return fail(401, { entryId: null, refused: PROBLEM_SENTENCES.not_signed_in });
		if (!session.partyId) {
			return fail(403, { entryId: null, refused: PROBLEM_SENTENCES.not_a_party });
		}
		const partyId = session.partyId;
		const { config, db, evidence } = locals.ctx;

		const form = await request.formData();
		const entryId = form.get(ENTRY_FIELD);
		const entry = typeof entryId === 'string' ? await getEntry(db, entryId) : undefined;
		// The same answer whether there is no such report or it is someone else's.
		if (!entry || entry.partyId !== session.partyId) {
			return fail(404, { entryId: null, refused: NOT_YOURS });
		}
		const refuse = (status: number, refused: string, problems: string[] = []) =>
			fail(status, { entryId: entry.id, refused, problems });
		if (entry.status !== 'incomplete') return refuse(409, NOT_INCOMPLETE);

		const [party, milestone] = await Promise.all([
			getParty(db, entry.partyId),
			getMilestone(db, entry.campaignId, entry.milestoneId)
		]);
		if (!party || !milestone) return refuse(409, CHANGED_MEANWHILE);

		// What was sent: files chosen here, and files uploaded earlier and pasted in.
		// A file input left untouched still sends one nameless, empty file. That is not a choice.
		const files = form
			.getAll(EVIDENCE_FILE_FIELD)
			.filter((value): value is File => value instanceof File)
			.filter((file) => !(file.name === '' && file.size === 0));
		const pastedText = form.get(PASTED_FIELD);
		const pasted =
			typeof pastedText === 'string' && pastedText.trim() !== '' ? readPasted(pastedText) : [];
		if (pasted === null) {
			return refuse(
				400,
				'The pasted text could not be read, so nothing was added. Paste the whole block from the upload page, exactly as it was copied.'
			);
		}
		if (files.length === 0 && pasted.length === 0) {
			return refuse(400, 'No file was chosen. Choose a photo or a document first.');
		}

		// Every chosen file must be an allowed type and size before any of them is stored.
		const unusable = files.flatMap((file) => {
			const check = checkEvidenceFile(file);
			return check.ok ? [] : [`${file.name}: ${PROBLEM_SENTENCES[check.problem]}`];
		});
		if (unusable.length > 0) {
			return refuse(400, 'Nothing was added, because a file could not be used.', unusable);
		}

		// Store the chosen files exactly as the upload page does: under their own SHA-256.
		const origin = evidenceStoreOrigin(config);
		const candidates: Candidate[] = pasted.map((file) => ({
			...file,
			name: file.url,
			storedNow: false
		}));
		for (const file of files) {
			const check = checkEvidenceFile(file);
			if (!check.ok) continue;
			try {
				// A file added here is stored without a choice of who may see it: a new file is
				// public, and one this party uploaded before stays as they left it.
				const stored = await storeEvidence({
					evidence,
					db,
					file,
					type: check.type,
					origin,
					partyId,
					choice: null
				});
				if (!stored.stored) {
					return refuse(409, `Nothing was added. ${file.name}: ${PROBLEM_SENTENCES.unexpected}`);
				}
				candidates.push({
					url: stored.url,
					sha256: stored.sha256,
					name: file.name,
					storedNow: true
				});
			} catch {
				return refuse(500, `Nothing was added. ${file.name}: ${PROBLEM_SENTENCES.unexpected}`);
			}
		}

		// A file the report already has, or one sent twice, is not added again.
		const have = new Set((entry.inputs.photos ?? []).map((photo) => photo.url));
		const added: Candidate[] = [];
		for (const candidate of candidates) {
			if (have.has(candidate.url)) continue;
			have.add(candidate.url);
			added.push(candidate);
		}
		if (added.length === 0) {
			return refuse(400, 'Those files are already attached to this report. Nothing was added.');
		}
		if (have.size > MAX_PHOTOS_PER_ENTRY) {
			return refuse(
				400,
				`A report can carry at most ${MAX_PHOTOS_PER_ENTRY} files, and this one would have ${have.size}. Nothing was added. Choose fewer files.`
			);
		}

		// Each new file must be one the check-in endpoint would accept on this milestone.
		const documentsOnly = takesDocumentsOnly(milestone.kind);
		const problems: string[] = [];
		for (const file of added) {
			const verdict = checkEvidence(file, origin);
			if (verdict === 'foreign') {
				problems.push(
					`${file.name} is not a file from the Tejido evidence upload. Upload the file here, or on the upload page, and use what you are given.`
				);
			} else if (verdict === 'hash_mismatch') {
				problems.push(
					`The fingerprint (SHA-256) given for ${file.name} is not the fingerprint of that file.`
				);
			} else if (verdict === 'photo' && documentsOnly) {
				problems.push(
					`${file.name} is a picture. This milestone takes documents only (${EVIDENCE_CONTENT_TYPES['application/pdf'].toUpperCase()}), no photos.`
				);
			} else if (
				!file.storedNow &&
				(await evidence.head(new URL(file.url).pathname.split('/').at(-1) ?? '')) === null
			) {
				problems.push(`${file.name} is not in the Tejido evidence store. Upload the file again.`);
			}
		}
		if (problems.length > 0) {
			return refuse(
				422,
				'Nothing was added, and the report is still incomplete, because a file cannot be used as evidence here.',
				problems
			);
		}

		// The same rules the check-in endpoint applied when the report was filed.
		const now = new Date().toISOString();
		const evidenceToAdd = added.map(({ url, sha256 }) => ({ url, sha256 }));
		const decision = decideCheckin({
			checkin: withFiles(entry, evidenceToAdd),
			party,
			milestone,
			evidenceOrigin: origin,
			notPublicEvidence: await listNotPublicEvidence(
				db,
				[...(entry.inputs.photos ?? []), ...evidenceToAdd].map((photo) => photo.sha256)
			),
			now
		});
		if (!decision.allowed) {
			return refuse(
				409,
				'This report can no longer be changed here, because you are no longer the party who may report on its milestone. Nothing was added.'
			);
		}
		if (decision.advance !== null) {
			// Completing it would move the milestone. That is the check-in endpoint's to do.
			return refuse(
				409,
				kindOfReport(entry) === 'confirmation'
					? `This confirmation was filed before "${milestone.title}" had been claimed, so it cannot be completed here. Nothing was added. Now that the milestone has been claimed, confirm it again through your agent.`
					: 'This report cannot be completed here. Nothing was added. File it again through your agent.'
			);
		}

		const status = await addEvidenceToIncompleteEntry(db, session.partyId, {
			entry,
			added: evidenceToAdd,
			complete: decision.status === 'filed',
			stillMissing: decision.statusReason,
			updatedAt: now
		});
		if (status === null) return refuse(409, CHANGED_MEANWHILE);

		return {
			done: {
				entryId: entry.id,
				milestoneTitle: milestone.title,
				added: added.length,
				complete: status !== 'incomplete',
				stillMissing: status === 'incomplete' ? decision.statusReason : null
			}
		};
	}
} satisfies Actions;
