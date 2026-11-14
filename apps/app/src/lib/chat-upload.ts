/**
 * Uploads one file from the chat's message box through POST /api/evidence, exactly as the
 * report form and the upload page do. Track B owns this file. Safe in the browser.
 *
 * The file is stored as the API stores any new file: public. Nothing here files a report.
 */
import { EVIDENCE_FILE_FIELD, evidenceUploadResponseSchema } from '@tejido/contracts';
import { checkEvidenceFile, PROBLEM_SENTENCES, problemFromStatus } from './evidence.ts';

export type ChatUpload =
	| { ok: true; url: string; sha256: string }
	/** `again` is false when sending the same file again could not help (wrong type, too large). */
	| { ok: false; problem: string; again: boolean };

export async function uploadFromChat(file: File): Promise<ChatUpload> {
	const check = checkEvidenceFile(file);
	if (!check.ok) return { ok: false, problem: PROBLEM_SENTENCES[check.problem], again: false };

	const body = new FormData();
	body.set(EVIDENCE_FILE_FIELD, file);
	let response: Response;
	try {
		response = await fetch('/api/evidence', { method: 'POST', body });
	} catch {
		return { ok: false, problem: PROBLEM_SENTENCES.network, again: true };
	}
	if (!response.ok) {
		const problem = problemFromStatus(response.status);
		return { ok: false, problem: PROBLEM_SENTENCES[problem], again: problem === 'unexpected' };
	}
	let answer: unknown;
	try {
		answer = await response.json();
	} catch {
		return { ok: false, problem: PROBLEM_SENTENCES.unexpected, again: true };
	}
	const parsed = evidenceUploadResponseSchema.safeParse(answer);
	if (!parsed.success) return { ok: false, problem: PROBLEM_SENTENCES.unexpected, again: true };
	return { ok: true, url: parsed.data.url, sha256: parsed.data.sha256 };
}

/**
 * What the assistant reads once a file from the message box is uploaded: the URL and the
 * SHA-256 exactly as the API answered them, which is what its instructions ask people to paste.
 */
export function uploadedFileMessage(file: {
	url: string;
	sha256: string;
	picture: boolean;
}): string {
	return [
		`I uploaded a ${file.picture ? 'photo' : 'document'} for my report.`,
		`URL: ${file.url}`,
		`SHA-256: ${file.sha256}`
	].join('\n');
}
