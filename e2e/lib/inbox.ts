/**
 * The inbox: waits for the sign-in code Qatom emails to a test person, by reading the queue
 * that mail to the inbox domain lands on.
 *
 * It reads; it never asks for a code. A code is asked for once, by the sign-in page, and if it
 * does not arrive the sign-in fails. Qatom allows five codes per address in fifteen minutes and
 * does not lift that in production.
 *
 * Nothing here prints a message, a code or a receipt handle.
 */
import {
	ChangeMessageVisibilityCommand,
	DeleteMessageCommand,
	ReceiveMessageCommand,
	SQSClient
} from '@aws-sdk/client-sqs';
import type { E2eConfig } from './config.ts';
import { parseInboxMessage, signInCodeIn, whose, type Wanted } from './inbox-message.ts';

export interface QueueMessage {
	id: string;
	receiptHandle: string;
	body: string;
}

/** The three things the inbox does with the queue. */
export interface InboxQueue {
	/** Waits a few seconds for messages. Each one received is hidden from other readers for a while. */
	receive(): Promise<QueueMessage[]>;
	/** Removes a message for good. */
	remove(message: QueueMessage): Promise<void>;
	/** Puts a message back at once, for the reader it is meant for. */
	release(message: QueueMessage): Promise<void>;
}

/** The real queue. Credentials come from the environment; none is read or held here. */
export function sqsInboxQueue(inbox: E2eConfig['inbox']): InboxQueue {
	const client = new SQSClient({ region: inbox.region });
	const QueueUrl = inbox.queueUrl;
	return {
		async receive() {
			const answer = await client.send(
				new ReceiveMessageCommand({
					QueueUrl,
					MaxNumberOfMessages: 10,
					WaitTimeSeconds: 10,
					VisibilityTimeout: 30
				})
			);
			return (answer.Messages ?? []).flatMap((message) =>
				message.MessageId && message.ReceiptHandle && message.Body !== undefined
					? [{ id: message.MessageId, receiptHandle: message.ReceiptHandle, body: message.Body }]
					: []
			);
		},
		async remove(message) {
			await client.send(
				new DeleteMessageCommand({ QueueUrl, ReceiptHandle: message.receiptHandle })
			);
		},
		async release(message) {
			await client.send(
				new ChangeMessageVisibilityCommand({
					QueueUrl,
					ReceiptHandle: message.receiptHandle,
					VisibilityTimeout: 0
				})
			);
		}
	};
}

export class InboxError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InboxError';
	}
}

export interface WaitOptions extends Wanted {
	timeoutMs: number;
	/** For tests. */
	now?: () => number;
	pause?: (ms: number) => Promise<void>;
}

/**
 * Waits for this person's code and returns it.
 *
 * Messages for anyone else are put straight back. This person's older messages are removed:
 * their codes are spent. A fresh message for this person is removed once read.
 */
export async function waitForSignInCode(queue: InboxQueue, options: WaitOptions): Promise<string> {
	const now = options.now ?? Date.now;
	const pause = options.pause ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
	const deadline = now() + options.timeoutMs;
	let unreadable = 0;

	while (now() < deadline) {
		const messages = await queue.receive();
		let putBack = false;

		for (const message of messages) {
			const mail = parseInboxMessage(message.body);
			const owner = mail ? whose(mail, options) : 'not_ours';
			if (!mail || owner === 'not_ours') {
				// Not understood, or someone else's. Never deleted by us.
				await queue.release(message);
				putBack = true;
				continue;
			}
			if (owner === 'stale') {
				await queue.remove(message);
				continue;
			}
			if (mail.raw === null) {
				throw new InboxError(
					'The inbox received the email, but the queue message does not carry its text. ' +
						'The SES rule must publish the whole message to SNS, not only store it.'
				);
			}
			const read = signInCodeIn(mail.raw);
			await queue.remove(message);
			if (read.found) return read.code;
			if (read.why === 'several') {
				throw new InboxError(
					'The email for this sign-in has more than one six-digit number in its text, so the ' +
						'code cannot be told apart. No code was typed. See "What needs a look after the ' +
						'first run" in e2e/README.md.'
				);
			}
			// An email to this person with no code in it, such as a welcome message. Keep waiting.
			unreadable += 1;
		}

		// A message put back is offered again immediately. Do not spin on it.
		if (putBack) await pause(1000);
	}

	throw new InboxError(
		`No sign-in code arrived at ${options.recipient} within ${Math.round(options.timeoutMs / 1000)} seconds` +
			(unreadable > 0
				? ` (${unreadable} other email(s) to that address had no code in them)`
				: '') +
			'. No second code was asked for: Qatom limits codes to five per address in fifteen minutes.'
	);
}
