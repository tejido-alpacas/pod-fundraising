/**
 * The inbox, without the network: messages of the shape SES and SNS put on the queue, and a
 * stand-in queue that records what was removed and what was put back.
 */
import { describe, expect, it } from 'vitest';
import { parseInboxMessage, signInCodeIn, whose } from './inbox-message.ts';
import { InboxError, waitForSignInCode, type InboxQueue, type QueueMessage } from './inbox.ts';
import { testEvidencePng } from './image.ts';

const CONTRACTOR = 'e2e-contractor@e2e.m.todaq.net';
const CONFIRMER = 'e2e-confirmer@e2e.m.todaq.net';
const T0 = Date.parse('2026-11-14T12:00:00.000Z');

/** A sign-in email as a mail server writes it: digits in its headers, the code in its body. */
function email(to: string, text: string, html?: string): string {
	const headers = [
		'Return-Path: <0100019a3f123456-482913@mail.todaq.net>',
		'Received: from a8-31.smtp-out.amazonses.com (54.240.8.31) by inbound-smtp; Sat, 14 Nov 2026 120001 +0000',
		'Message-ID: <777777.888888.999999@mail.todaq.net>',
		'Date: Sat, 14 Nov 2026 12:00:01 +0000',
		'From: Qatom <no-reply@todaq.net>',
		`To: ${to}`,
		'Subject: Your Qatom sign-in code',
		'MIME-Version: 1.0'
	];
	if (html === undefined) {
		return [...headers, 'Content-Type: text/plain; charset=UTF-8', '', text].join('\r\n');
	}
	return [
		...headers,
		'Content-Type: multipart/alternative;',
		'\tboundary="b_123456"',
		'',
		'--b_123456',
		'Content-Type: text/plain; charset=UTF-8',
		'Content-Transfer-Encoding: quoted-printable',
		'',
		text,
		'--b_123456',
		'Content-Type: text/html; charset=UTF-8',
		'Content-Transfer-Encoding: base64',
		'',
		Buffer.from(html).toString('base64'),
		'--b_123456--'
	].join('\r\n');
}

/** The queue message for one email: SES's notification inside SNS's envelope. */
function queued(
	to: string,
	raw: string | null,
	options: { at?: number; base64?: boolean; rawDelivery?: boolean } = {}
): string {
	const timestamp = new Date(options.at ?? T0 + 1000).toISOString();
	const notification = {
		notificationType: 'Received',
		mail: { timestamp, source: 'no-reply@todaq.net', messageId: 'abc', destination: [to] },
		receipt: { timestamp, recipients: [to], action: { type: 'SNS', encoding: 'UTF8' } },
		...(raw === null ? {} : { content: options.base64 ? Buffer.from(raw).toString('base64') : raw })
	};
	if (options.rawDelivery) return JSON.stringify(notification);
	return JSON.stringify({
		Type: 'Notification',
		MessageId: '5b0a5d3e',
		TopicArn: 'arn:aws:sns:ca-central-1:123456789012:e2e-inbox',
		Subject: 'Amazon SES Email Receipt Notification',
		Message: JSON.stringify(notification),
		Timestamp: timestamp
	});
}

describe('parseInboxMessage', () => {
	const raw = email(CONTRACTOR, 'Your code is 482913.');

	it('reads an SES notification inside an SNS envelope', () => {
		const mail = parseInboxMessage(queued('E2E-Contractor@e2e.m.todaq.net', raw));
		expect(mail).toEqual({ recipients: [CONTRACTOR], receivedAtMs: T0 + 1000, raw });
	});

	it('reads raw delivery and Base64 content the same way', () => {
		expect(parseInboxMessage(queued(CONTRACTOR, raw, { rawDelivery: true }))?.raw).toBe(raw);
		expect(parseInboxMessage(queued(CONTRACTOR, raw, { base64: true }))?.raw).toBe(raw);
	});

	it('answers null content when the notification carries no email', () => {
		expect(parseInboxMessage(queued(CONTRACTOR, null))?.raw).toBeNull();
	});

	it('answers null for anything that is not an SES receipt', () => {
		expect(parseInboxMessage('not json')).toBeNull();
		expect(parseInboxMessage('{"hello":"world"}')).toBeNull();
		expect(
			parseInboxMessage(
				JSON.stringify({ Type: 'Notification', Message: '{"notificationType":"Bounce"}' })
			)
		).toBeNull();
	});
});

describe('signInCodeIn', () => {
	it('finds the code in a plain email, ignoring the digits in its headers', () => {
		expect(
			signInCodeIn(
				email(CONTRACTOR, 'Your Qatom sign-in code is 482913.\r\nIt expires in 10 minutes.')
			)
		).toEqual({
			found: true,
			code: '482913'
		});
	});

	it('undoes quoted-printable, and prefers the plain part to the HTML one', () => {
		const html =
			'<html><head><style>p{color:#333333}</style></head><body><p style="color:#555555">Code: <b>482913</b></p></body></html>';
		expect(
			signInCodeIn(email(CONTRACTOR, 'Your code is=20482913 =E2=80=94 it expires soon.', html))
		).toEqual({
			found: true,
			code: '482913'
		});
	});

	it('reads the HTML part when the plain one has no code, without mistaking a colour for it', () => {
		const html =
			'<html><head><style>p{color:#333333}</style></head><body><p style="color:#555555">Code: <b>482913</b> &#128274;</p></body></html>';
		expect(
			signInCodeIn(email(CONTRACTOR, 'Open this email in HTML to see your code.', html))
		).toEqual({
			found: true,
			code: '482913'
		});
	});

	it('does not take part of a longer number, or a shorter one', () => {
		expect(signInCodeIn(email(CONTRACTOR, 'Reference 12345678, 2026, call 55512.'))).toEqual({
			found: false,
			why: 'none'
		});
	});

	it('refuses to guess between two different numbers', () => {
		expect(signInCodeIn(email(CONTRACTOR, 'Code 482913. Ticket 771204.'))).toEqual({
			found: false,
			why: 'several'
		});
		expect(signInCodeIn(email(CONTRACTOR, 'Code 482913. Again: 482913.'))).toEqual({
			found: true,
			code: '482913'
		});
	});
});

describe('whose', () => {
	const mail = { recipients: [CONTRACTOR], receivedAtMs: T0, raw: '' };

	it('tells ours from stale from someone else’s', () => {
		expect(whose(mail, { recipient: CONTRACTOR, notBeforeMs: T0 })).toBe('ours');
		expect(whose(mail, { recipient: CONTRACTOR, notBeforeMs: T0 + 1 })).toBe('stale');
		expect(whose(mail, { recipient: CONFIRMER, notBeforeMs: 0 })).toBe('not_ours');
	});
});

describe('waitForSignInCode', () => {
	function fakeQueue(batches: string[][]) {
		const removed: string[] = [];
		const released: string[] = [];
		let next = 0;
		const queue: InboxQueue = {
			receive: () => {
				const bodies = batches[next++] ?? [];
				return Promise.resolve(
					bodies.map((body, index): QueueMessage => {
						const id = `m${next}-${index}`;
						return { id, receiptHandle: id, body };
					})
				);
			},
			remove: (message) => {
				removed.push(message.id);
				return Promise.resolve();
			},
			release: (message) => {
				released.push(message.id);
				return Promise.resolve();
			}
		};
		return { queue, removed, released };
	}

	/** A clock that moves ten seconds each time it is read, so a wait ends without waiting. */
	function clock() {
		let now = T0;
		return { now: () => (now += 10_000), pause: () => Promise.resolve() };
	}

	const wanted = { recipient: CONTRACTOR, notBeforeMs: T0, timeoutMs: 120_000 };

	it('returns this person’s fresh code, removes their old one, and puts everyone else’s back', async () => {
		const { queue, removed, released } = fakeQueue([
			[
				queued(CONFIRMER, email(CONFIRMER, 'Your code is 111111.')),
				queued(CONTRACTOR, email(CONTRACTOR, 'Your code is 222222.'), { at: T0 - 60_000 }),
				'something else entirely'
			],
			[queued(CONTRACTOR, email(CONTRACTOR, 'Your code is 482913.'))]
		]);
		await expect(waitForSignInCode(queue, { ...wanted, ...clock() })).resolves.toBe('482913');
		expect(released).toEqual(['m1-0', 'm1-2']);
		expect(removed).toEqual(['m1-1', 'm2-0']);
	});

	it('keeps waiting past an email to this person that has no code', async () => {
		const { queue, removed } = fakeQueue([
			[queued(CONTRACTOR, email(CONTRACTOR, 'Welcome to Qatom.'))],
			[queued(CONTRACTOR, email(CONTRACTOR, 'Your code is 482913.'))]
		]);
		await expect(waitForSignInCode(queue, { ...wanted, ...clock() })).resolves.toBe('482913');
		expect(removed).toEqual(['m1-0', 'm2-0']);
	});

	it('gives up after the time allowed, saying no second code was asked for', async () => {
		const { queue } = fakeQueue([]);
		const waiting = waitForSignInCode(queue, { ...wanted, ...clock() });
		await expect(waiting).rejects.toThrow(InboxError);
		await expect(waiting).rejects.toThrow(
			/No sign-in code arrived at e2e-contractor@.* within 120 seconds/
		);
	});

	it('stops rather than guess when the email has two numbers, and never repeats them', async () => {
		const { queue } = fakeQueue([
			[queued(CONTRACTOR, email(CONTRACTOR, 'Code 482913. Ticket 771204.'))]
		]);
		const waiting = waitForSignInCode(queue, { ...wanted, ...clock() });
		await expect(waiting).rejects.toThrow(/more than one six-digit number/);
		await expect(waiting).rejects.not.toThrow(/482913|771204/);
	});

	it('says so when the queue message does not carry the email', async () => {
		const { queue } = fakeQueue([[queued(CONTRACTOR, null)]]);
		await expect(waitForSignInCode(queue, { ...wanted, ...clock() })).rejects.toThrow(
			/does not carry its text/
		);
	});
});

describe('testEvidencePng', () => {
	it('is a small PNG, the same bytes every time', () => {
		const png = testEvidencePng();
		expect(png.subarray(0, 8)).toEqual(
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
		);
		expect(png.length).toBeLessThan(2000);
		expect(testEvidencePng().equals(png)).toBe(true);
	});
});
