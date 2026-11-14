/**
 * The one function that sends a request to Qatom. Internal to this package.
 *
 * It sets a timeout on every call, turns every failure into a typed error, and never logs.
 * Nothing it throws contains a request header, a request body or a raw response body.
 */
import {
	QatomHttpError,
	QatomNetworkError,
	QatomResponseError,
	QatomTimeoutError
} from './errors.ts';

export const DEFAULT_TIMEOUT_MS = 15_000;

/** Reading a ledger rebuilds it from the twin's binder, and a transfer waits on the twins. */
export const SLOW_TIMEOUT_MS = 30_000;

export interface QatomRequest {
	/** Names the call in errors, e.g. `account.ledger`. */
	operation: string;
	method: 'GET' | 'POST' | 'PUT';
	url: string | URL;
	headers?: Record<string, string>;
	/** Sent as JSON. */
	json?: unknown;
	/** Sent as `application/x-www-form-urlencoded`, which the OAuth token endpoint requires. */
	form?: Record<string, string>;
	timeoutMs: number;
}

/**
 * Sends the request and returns the parsed JSON body of a 2xx answer, or `undefined` when the
 * body is empty. Throws QatomHttpError for any other status.
 */
export async function send(request: QatomRequest): Promise<unknown> {
	const { operation, timeoutMs } = request;
	const headers: Record<string, string> = { accept: 'application/json', ...request.headers };
	let body: string | undefined;

	if (request.json !== undefined) {
		headers['content-type'] = 'application/json';
		body = JSON.stringify(request.json);
	} else if (request.form !== undefined) {
		headers['content-type'] = 'application/x-www-form-urlencoded';
		body = new URLSearchParams(request.form).toString();
	}

	let status: number;
	let text: string;
	try {
		// `fetch` is looked up at call time so a test can stub it.
		const response = await fetch(request.url, {
			method: request.method,
			headers,
			body,
			// A redirect would carry credentials somewhere we did not choose. Treat it as an error.
			redirect: 'manual',
			// The limit covers the whole exchange, including reading the body.
			signal: AbortSignal.timeout(timeoutMs)
		});
		status = response.status;
		text = await response.text();
	} catch (error) {
		if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
			throw new QatomTimeoutError(operation, timeoutMs);
		}
		throw new QatomNetworkError(operation, error);
	}

	const parsed = parseJson(text);

	if (status < 200 || status > 299) {
		const fields = typeof parsed.value === 'object' && parsed.value !== null ? parsed.value : {};
		throw new QatomHttpError(
			operation,
			status,
			readString(fields, 'error'),
			readString(fields, 'error_description') ?? readString(fields, 'message')
		);
	}

	if (!parsed.ok) throw new QatomResponseError(operation, 'the body is not JSON');
	return parsed.value;
}

function parseJson(text: string): { ok: boolean; value: unknown } {
	if (text.trim() === '') return { ok: true, value: undefined };
	try {
		return { ok: true, value: JSON.parse(text) as unknown };
	} catch {
		return { ok: false, value: undefined };
	}
}

/** Reads one short string field. Anything else in the body is dropped, never kept or shown. */
function readString(fields: object, name: string): string | null {
	const value = (fields as Record<string, unknown>)[name];
	return typeof value === 'string' && value !== '' ? value.slice(0, 300) : null;
}

/** Joins the payment API's origin and a path beginning with `/v4/`. */
export function apiUrl(paymentApiUrl: string, path: string): URL {
	return new URL(path, `${paymentApiUrl.replace(/\/+$/, '')}/`);
}
