/**
 * What the two campaign-builder endpoints share: reading a JSON body safely, and answering.
 * Track C owns this file. The endpoints are documented in docs/campaign-api.md.
 *
 * Nobody signs in to use them, so the body is treated as hostile: it must say it is JSON, it
 * is read with a hard size limit, and it is never logged. No CORS header is ever sent, and a
 * JSON content type makes a browser ask permission before another site's page may post here,
 * which is refused. So only this site's own pages can call them from a browser.
 */
import { json } from '@sveltejs/kit';

/**
 * The most bytes of body that are read. The builder page allows a draft of 200,000
 * characters; a character is at least one byte, so this is never looser than the page.
 */
export const MAX_BODY_BYTES = 200_000;

const NO_STORE = { 'cache-control': 'no-store' };

/** Every answer of these endpoints: JSON that is never cached. */
export function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
	return json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** A refusal in the repository's shape. Clients branch on `error`. */
export function refuse(status: number, error: string, message: string, more: object = {}) {
	return answer(status, { error, message, ...more });
}

export type ReadBody =
	{ ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

const tooLarge = (): ReadBody => ({
	ok: false,
	response: refuse(
		400,
		'invalid_body',
		`The body is larger than ${String(MAX_BODY_BYTES)} bytes. A campaign is far smaller than that.`
	)
});

/** Reads at most MAX_BODY_BYTES of the body. Null when there is more than that. */
async function readLimited(request: Request): Promise<Uint8Array | null> {
	if (request.body === null) return new Uint8Array();
	const reader = request.body.getReader();
	const bytes = new Uint8Array(MAX_BODY_BYTES);
	let length = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) return bytes.subarray(0, length);
		if (length + value.byteLength > MAX_BODY_BYTES) {
			await reader.cancel();
			return null;
		}
		bytes.set(value, length);
		length += value.byteLength;
	}
}

/**
 * Reads the request's body as a JSON object, or says why it cannot be: 415 when the content
 * type is not `application/json`, 400 when the body is too large, is not JSON, or is JSON
 * that is not an object.
 */
export async function readJsonObject(request: Request): Promise<ReadBody> {
	const type = (request.headers.get('content-type') ?? '').split(';')[0]?.trim().toLowerCase();
	if (type !== 'application/json') {
		return {
			ok: false,
			response: refuse(
				415,
				'unsupported_media_type',
				'Send the body as JSON, with the header "Content-Type: application/json".'
			)
		};
	}

	// Refuse on the declared length before reading anything, then hold the read to the limit
	// anyway: the header can be missing or wrong.
	const declared = Number(request.headers.get('content-length') ?? '0');
	if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return tooLarge();
	const bytes = await readLimited(request);
	if (bytes === null) return tooLarge();

	let parsed: unknown;
	try {
		parsed = JSON.parse(new TextDecoder().decode(bytes));
	} catch {
		return { ok: false, response: refuse(400, 'invalid_body', 'The body is not JSON.') };
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
		return {
			ok: false,
			response: refuse(
				400,
				'invalid_body',
				'The body must be one JSON object: the campaign, as docs/campaign-api.md describes it.'
			)
		};
	}
	return { ok: true, body: parsed as Record<string, unknown> };
}
