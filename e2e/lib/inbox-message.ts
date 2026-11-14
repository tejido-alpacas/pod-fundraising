/**
 * Reading one message from the inbox queue: pure functions, no network.
 *
 * Mail to the inbox domain is received by Amazon SES, which hands each message to SNS, which
 * puts it on an SQS queue. So a queue message's body is an SNS envelope (or, with raw delivery,
 * just its `Message`) whose payload is SES's "Received" notification, carrying the whole email
 * as `content`.
 *
 * Nothing here logs or returns a message's text. Callers get recipients, a time and a code.
 */
import { z } from 'zod';

const snsEnvelopeSchema = z.object({ Type: z.literal('Notification'), Message: z.string() });

const sesReceivedSchema = z.object({
	notificationType: z.literal('Received'),
	mail: z.object({
		timestamp: z.iso.datetime({ offset: true }),
		destination: z.array(z.string()).default([])
	}),
	receipt: z.object({ recipients: z.array(z.string()).default([]) }).optional(),
	/** The raw email. Present when the SES rule publishes to SNS; absent for an S3-only rule. */
	content: z.string().optional()
});

export interface ReceivedMail {
	/** Every address SES accepted this message for, lower-cased. */
	recipients: string[];
	/** When SES received it, in milliseconds since the epoch. */
	receivedAtMs: number;
	/** The raw email (headers and body), or null when the notification did not carry it. */
	raw: string | null;
}

function json(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

/** A whole MIME message always has a "Name: value" header line. Base64 never has a colon. */
function looksBase64(text: string): boolean {
	return /^[A-Za-z0-9+/=\s]+$/.test(text);
}

/** Reads a queue message's body. Null when it is not an SES "Received" notification. */
export function parseInboxMessage(body: string): ReceivedMail | null {
	let payload = json(body);
	const envelope = snsEnvelopeSchema.safeParse(payload);
	if (envelope.success) payload = json(envelope.data.Message);

	const received = sesReceivedSchema.safeParse(payload);
	if (!received.success) return null;

	const { mail, receipt, content } = received.data;
	const recipients = [...new Set([...(receipt?.recipients ?? []), ...mail.destination])].map(
		(address) => address.trim().toLowerCase()
	);
	// SES publishes the email as UTF-8 text or as Base64, as its rule is set. Accept both.
	const raw =
		content === undefined
			? null
			: looksBase64(content)
				? Buffer.from(content, 'base64').toString('utf8')
				: content;
	return { recipients, receivedAtMs: Date.parse(mail.timestamp), raw };
}

// ---------------------------------------------------------------------------
// The email itself
// ---------------------------------------------------------------------------

interface Part {
	type: string;
	text: string;
}

function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
	const text = raw.replace(/\r\n/g, '\n');
	const end = text.indexOf('\n\n');
	const head = end === -1 ? text : text.slice(0, end);
	const body = end === -1 ? '' : text.slice(end + 2);
	const headers = new Map<string, string>();
	// A header continued on the next line starts that line with a space or a tab.
	for (const line of head.replace(/\n[ \t]+/g, ' ').split('\n')) {
		const colon = line.indexOf(':');
		if (colon > 0)
			headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
	}
	return { headers, body };
}

function decodeQuotedPrintable(text: string): string {
	const joined = text.replace(/=\n/g, '');
	const bytes: number[] = [];
	for (let at = 0; at < joined.length; at++) {
		const hex = joined[at] === '=' ? joined.slice(at + 1, at + 3) : '';
		if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
			bytes.push(Number.parseInt(hex, 16));
			at += 2;
		} else {
			bytes.push(...Buffer.from(joined[at] ?? '', 'utf8'));
		}
	}
	return Buffer.from(bytes).toString('utf8');
}

/** The text parts of an email, with their transfer encoding undone. Attachments are skipped. */
function textParts(raw: string, depth = 0): Part[] {
	const { headers, body } = splitHeaders(raw);
	const contentType = headers.get('content-type') ?? 'text/plain';
	const type = (contentType.split(';')[0] ?? '').trim().toLowerCase();

	if (type.startsWith('multipart/')) {
		const boundary = /boundary="?([^";]+)"?/i.exec(contentType)?.[1];
		if (!boundary || depth > 5) return [];
		return body
			.split(`--${boundary}`)
			.slice(1)
			.filter((piece) => !piece.startsWith('--'))
			.flatMap((piece) => textParts(piece.replace(/^\n/, ''), depth + 1));
	}
	if (type !== 'text/plain' && type !== 'text/html') return [];

	const encoding = (headers.get('content-transfer-encoding') ?? '').toLowerCase();
	const text =
		encoding === 'base64'
			? Buffer.from(body, 'base64').toString('utf8')
			: encoding === 'quoted-printable'
				? decodeQuotedPrintable(body)
				: body;
	return [{ type, text }];
}

/** What a person would read in an HTML email: no styles, no scripts, no tags. */
function visibleText(html: string): string {
	return html
		.replace(/<(style|script|head|title)\b[\s\S]*?<\/\1>/gi, ' ')
		.replace(/<[^>]+>/g, ' ')
		.replace(/&nbsp;/gi, ' ');
}

/** Six digits standing alone: not part of a longer number, a colour (#333333) or an entity. */
const CODE = /(?<![\w#&])\d{6}(?!\w)/g;

export type CodeRead =
	| { found: true; code: string }
	/** `none`: no six-digit number. `several`: more than one, and guessing would waste an attempt. */
	| { found: false; why: 'none' | 'several' };

/**
 * The sign-in code in an email, read from its BODY only.
 *
 * The headers are never searched: dates, message ids and the address itself are full of digits,
 * and a six-digit run in one of them would be typed as the code. The plain-text part is read
 * first, and the HTML part only when there is no plain one.
 */
export function signInCodeIn(raw: string): CodeRead {
	const parts = textParts(raw);
	const plain = parts.filter((part) => part.type === 'text/plain').map((part) => part.text);
	const html = parts
		.filter((part) => part.type === 'text/html')
		.map((part) => visibleText(part.text));

	for (const texts of [plain, html]) {
		const codes = new Set(texts.flatMap((text) => text.match(CODE) ?? []));
		const [code] = codes;
		if (codes.size === 1 && code !== undefined) return { found: true, code };
		if (codes.size > 1) return { found: false, why: 'several' };
	}
	return { found: false, why: 'none' };
}

// ---------------------------------------------------------------------------
// Whose message is it
// ---------------------------------------------------------------------------

export interface Wanted {
	/** The test person's address, lower-case. */
	recipient: string;
	/** Just before the code was asked for. Anything received earlier belongs to an earlier run. */
	notBeforeMs: number;
}

/**
 * - `ours`: sent to this person after this sign-in asked for a code.
 * - `stale`: sent to this person earlier. Its code is used or expired, so it can be removed.
 * - `not_ours`: for someone else (the other test person, or another suite sharing the inbox).
 *   It must go back on the queue untouched, at once, so its reader is not kept waiting.
 */
export function whose(mail: ReceivedMail, wanted: Wanted): 'ours' | 'stale' | 'not_ours' {
	if (!mail.recipients.includes(wanted.recipient.toLowerCase())) return 'not_ours';
	return mail.receivedAtMs >= wanted.notBeforeMs ? 'ours' : 'stale';
}
