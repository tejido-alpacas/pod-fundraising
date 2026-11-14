/**
 * What the upload page (B3) and its form action agree on: which files are evidence, the plain
 * sentence shown for each way an upload can fail, and the block a person pastes to their agent.
 *
 * Safe in the browser: no server-only import. The types and limits come from the contracts.
 */
import {
	EVIDENCE_CONTENT_TYPES,
	EVIDENCE_MAX_BYTES,
	isEvidenceContentType,
	type EvidenceContentType,
	type EvidenceUploadResponse
} from '@tejido/contracts';

const CONTENT_TYPES = Object.keys(EVIDENCE_CONTENT_TYPES).filter(isEvidenceContentType);

export function isPicture(type: string): boolean {
	return type.startsWith('image/');
}

/** For the `accept` of a photo input and of a document input. */
export const PICTURE_TYPES = CONTENT_TYPES.filter(isPicture);
export const DOCUMENT_TYPES = CONTENT_TYPES.filter((type) => !isPicture(type));

const names = (types: EvidenceContentType[]) =>
	types.map((type) => EVIDENCE_CONTENT_TYPES[type].toUpperCase()).join(', ');

/** "JPG, PNG, WEBP" and "PDF": how the accepted types are named to a person. */
export const PICTURE_TYPE_NAMES = names(PICTURE_TYPES);
export const DOCUMENT_TYPE_NAMES = names(DOCUMENT_TYPES);

export const EVIDENCE_MAX_MEGABYTES = EVIDENCE_MAX_BYTES / 1024 / 1024;

export type EvidenceProblem =
	'not_signed_in' | 'not_a_party' | 'wrong_type' | 'empty' | 'too_large' | 'network' | 'unexpected';

/** One sentence per problem, for someone who does not program. */
export const PROBLEM_SENTENCES: Record<EvidenceProblem, string> = {
	not_signed_in:
		'You are not signed in, so this was not uploaded. Open the invite link you were sent, sign in, then try again.',
	not_a_party:
		'You are signed in, but not as someone invited to a campaign, so this was not uploaded. Open the invite link you were sent and sign in from there.',
	wrong_type: `This kind of file cannot be used as evidence. Choose a photo (${PICTURE_TYPE_NAMES}) or a document (${DOCUMENT_TYPE_NAMES}).`,
	empty:
		'This file is empty, or it did not arrive whole, so it was not uploaded. Choose it again, or pick another file.',
	too_large: `This file is larger than ${EVIDENCE_MAX_MEGABYTES} MB, the most we can take. Choose a smaller file, or take the photo at a lower quality.`,
	network:
		'We could not reach Tejido, so this was not uploaded. Check your connection and try again.',
	unexpected: 'Something went wrong on our side and this was not uploaded. Try again in a moment.'
};

export type EvidenceFileCheck =
	{ ok: true; type: EvidenceContentType } | { ok: false; problem: EvidenceProblem };

/** The same checks `POST /api/evidence` makes on a file, in the same order. */
export function checkEvidenceFile(file: { type: string; size: number }): EvidenceFileCheck {
	if (!isEvidenceContentType(file.type)) return { ok: false, problem: 'wrong_type' };
	if (file.size === 0) return { ok: false, problem: 'empty' };
	if (file.size > EVIDENCE_MAX_BYTES) return { ok: false, problem: 'too_large' };
	return { ok: true, type: file.type };
}

/** Which problem a refusal from `POST /api/evidence` is, by its HTTP status. */
export function problemFromStatus(status: number): EvidenceProblem {
	switch (status) {
		case 401:
			return 'not_signed_in';
		case 403:
			return 'not_a_party';
		case 415:
			return 'wrong_type';
		case 413:
			return 'too_large';
		case 400:
			return 'empty';
		default:
			return 'unexpected';
	}
}

/** How one chosen file ended, as the upload page shows it. */
export type UploadResult =
	| { name: string; ok: true; url: string; sha256: string; picture: boolean }
	| { name: string; ok: false; problem: string };

/** One file, in the shape a check-in's `photos` list takes. */
export function agentEntry({ url, sha256 }: EvidenceUploadResponse): string {
	return JSON.stringify({ url, sha256 }, null, 2);
}

/** Several files as a `photos` list. The same file uploaded twice appears once. */
export function agentList(uploads: EvidenceUploadResponse[]): string {
	const bySha256 = new Map(uploads.map(({ url, sha256 }) => [sha256, { url, sha256 }]));
	return JSON.stringify([...bySha256.values()], null, 2);
}
