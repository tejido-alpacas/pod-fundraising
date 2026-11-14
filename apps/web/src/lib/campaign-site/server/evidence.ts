/**
 * Decides what a donor is told about each of an entry's files.
 *
 * The check-in endpoint saves an entry even when its evidence is wrong, and marks it
 * `incomplete`. So a URL stored on an entry may point anywhere, may carry a hash that is not
 * the file's, or may be a picture on a milestone that takes documents only. And a file may
 * have been marked not public by the party who uploaded it. Every Campaign Site page that
 * renders evidence passes it through `sortEvidence` first, on the server, and sends the
 * browser only what comes back.
 *
 * The decision itself is `evidenceFileStates` in @tejido/contracts, shared with the App.
 * NOTHING RETURNED HERE CARRIES THE ADDRESS OF A FILE THAT IS NOT SHOWN: a not-public file
 * leaves the server as what its uploader says it is, why it is hidden, and its SHA-256.
 */
import type { Config } from '@tejido/config';
import {
	evidenceFileStates,
	type EvidenceFileState,
	type EvidenceNotPublic,
	type MilestoneKind,
	type Photo
} from '@tejido/contracts';
import {
	evidenceStoreOrigin,
	listNotPublicEvidence,
	takesDocumentsOnly,
	type Executor
} from '@tejido/db';

/** A file that passed the check. `url` is in our own evidence store and `sha256` is its hash. */
export interface ShownFile {
	url: string;
	sha256: string;
	caption: string | null;
}

/** A file its uploader marked not public: their words about it, and its SHA-256. No address. */
export interface NotPublicFile {
	kind: string;
	reason: string;
	sha256: string;
}

export interface SortedEvidence {
	/** Pictures, safe to show as pictures. */
	photos: ShownFile[];
	/** PDFs, safe to link to. */
	documents: ShownFile[];
	/** Files the uploader marked not public. Donors are told what and why, and nothing else. */
	notPublic: NotPublicFile[];
	/** How many files were filed but are left out, because a check failed. */
	leftOut: number;
	/** Every file in the order it was filed, with its state: shown, not public or left out. */
	files: EvidenceFileState[];
}

/** The files marked not public among those attached to these entries, by SHA-256. */
export function notPublicAmong(
	db: Executor,
	entries: readonly { inputs: { photos?: readonly Photo[] } }[]
): Promise<Map<string, EvidenceNotPublic>> {
	return listNotPublicEvidence(
		db,
		entries.flatMap((entry) => (entry.inputs.photos ?? []).map((photo) => photo.sha256))
	);
}

/**
 * @param milestoneKind the kind of the entry's milestone, or undefined if the milestone could
 *   not be found. Without it we cannot tell whether pictures are allowed, so none are shown.
 * @param notPublic the answer of `notPublicAmong` for (at least) this entry.
 */
export function sortEvidence(
	files: readonly Photo[] | undefined,
	milestoneKind: MilestoneKind | undefined,
	config: Pick<Config, 'OIDC_REDIRECT_URI'>,
	notPublic: ReadonlyMap<string, EvidenceNotPublic>
): SortedEvidence {
	const states = evidenceFileStates(files, {
		storeOrigin: evidenceStoreOrigin(config),
		documentsOnly: milestoneKind === undefined || takesDocumentsOnly(milestoneKind),
		notPublic
	});
	const sorted: SortedEvidence = {
		photos: [],
		documents: [],
		notPublic: [],
		leftOut: 0,
		files: states
	};

	for (const file of states) {
		if (file.state === 'left_out') {
			sorted.leftOut += 1;
		} else if (file.state === 'not_public') {
			sorted.notPublic.push({ kind: file.kind, reason: file.reason, sha256: file.sha256 });
		} else {
			const shown = { url: file.url, sha256: file.sha256, caption: file.caption };
			if (file.kind === 'photo') sorted.photos.push(shown);
			else sorted.documents.push(shown);
		}
	}
	return sorted;
}
