/**
 * Decides which of an entry's files a donor may be shown.
 *
 * The check-in endpoint saves an entry even when its evidence is wrong, and marks it
 * `incomplete`. So a URL stored on an entry may point anywhere, may carry a hash that is not
 * the file's, or may be a picture on a milestone that takes documents only. Every Campaign
 * Site page that renders evidence passes it through `sortEvidence` first, on the server, and
 * renders only what comes back as `photos` and `documents`.
 */
import type { Config } from '@tejido/config';
import type { MilestoneKind, Photo } from '@tejido/contracts';
import { checkEvidence, evidenceStoreOrigin } from '#lib/server/backend/evidence.ts';

/**
 * The kinds of milestone that take documents only: the rule that keeps pictures of a child
 * off a campaign. This repeats `documentsOnly` in Track C's `checkin-rules.ts`, which does
 * not export it. If the two ever disagree, that file is right.
 */
const DOCUMENTS_ONLY: Record<MilestoneKind, boolean> = {
	construction: false,
	goods_delivery: false,
	funds_handover: true,
	service: true
};

/** A file that passed the check. `url` is in our own evidence store and `sha256` is its hash. */
export interface ShownFile {
	url: string;
	sha256: string;
	caption: string | null;
}

export interface SortedEvidence {
	/** Pictures, safe to show as pictures. */
	photos: ShownFile[];
	/** PDFs, safe to link to. */
	documents: ShownFile[];
	/** How many files were attached but are not shown. */
	leftOut: number;
}

/**
 * @param milestoneKind the kind of the entry's milestone, or undefined if the milestone could
 *   not be found. Without it we cannot tell whether pictures are allowed, so none are shown.
 */
export function sortEvidence(
	files: readonly Photo[] | undefined,
	milestoneKind: MilestoneKind | undefined,
	config: Pick<Config, 'OIDC_REDIRECT_URI'>
): SortedEvidence {
	const origin = evidenceStoreOrigin(config);
	const picturesAllowed = milestoneKind !== undefined && !DOCUMENTS_ONLY[milestoneKind];
	const sorted: SortedEvidence = { photos: [], documents: [], leftOut: 0 };

	for (const file of files ?? []) {
		const verdict = checkEvidence(file, origin);
		const shown = { url: file.url, sha256: file.sha256, caption: file.caption ?? null };
		if (verdict === 'document') sorted.documents.push(shown);
		else if (verdict === 'photo' && picturesAllowed) sorted.photos.push(shown);
		else sorted.leftOut += 1;
	}
	return sorted;
}
