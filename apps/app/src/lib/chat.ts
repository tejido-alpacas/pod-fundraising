/**
 * What the chat page and POST /api/chat say to each other. Track B owns this file.
 *
 * The page sends the conversation so far. The server answers with a stream of lines, one JSON
 * event per line, as the agent's reply is produced. Nothing here ever carries a token.
 */

import type { ReportFormProblems, ReportFormValues } from './report-form.ts';

/** One thing somebody said. The page keeps the conversation; the server keeps none of it. */
export interface ChatTurn {
	role: 'user' | 'assistant';
	text: string;
	/**
	 * Set when the person sent the report form instead of typing (see `report-form.ts`). Then
	 * `text` is empty, and the server writes the message the agent reads from these values.
	 */
	form?: ReportFormValues;
}

export interface ChatRequest {
	messages: ChatTurn[];
	/**
	 * The id of the milestone the chat was opened for (`/chat?milestone=...`), if any. The server
	 * uses it only when that milestone is the signed-in party's own, and ignores it otherwise.
	 */
	milestone?: string;
}

export const CHAT_MAX_TURNS = 100;
export const CHAT_MAX_TURN_CHARACTERS = 8000;

export type ChatEvent =
	/** The next piece of the agent's reply. */
	| { type: 'text'; text: string }
	/** The agent started using a tool on the Qatom MCP server, or that tool answered. */
	| { type: 'tool'; id: string; name: string; state: 'running' | 'done' | 'failed' }
	/** The reply stopped early. `message` is written for the person, in plain words. */
	| { type: 'error'; message: string }
	/** The reply is complete. */
	| { type: 'done' };

/** What the server answers instead of a stream when it cannot start a reply. */
export interface ChatRefusal {
	error: string;
	message: string;
	/** With `invalid_form`: one plain sentence for each part of the report form to fix. */
	fields?: ReportFormProblems;
}

/**
 * Reads the server's answer line by line and hands each event to `onEvent`.
 * A line that is not an event we know is skipped rather than shown.
 */
export async function readChatEvents(
	body: ReadableStream<Uint8Array>,
	onEvent: (event: ChatEvent) => void
): Promise<void> {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffered = '';

	const handle = (line: string) => {
		if (line.trim() === '') return;
		let parsed: unknown;
		try {
			parsed = JSON.parse(line);
		} catch {
			return;
		}
		if (isChatEvent(parsed)) onEvent(parsed);
	};

	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		buffered += decoder.decode(value, { stream: true });
		let newline = buffered.indexOf('\n');
		while (newline !== -1) {
			handle(buffered.slice(0, newline));
			buffered = buffered.slice(newline + 1);
			newline = buffered.indexOf('\n');
		}
	}
	handle(buffered + decoder.decode());
}

function isChatEvent(value: unknown): value is ChatEvent {
	if (typeof value !== 'object' || value === null) return false;
	const event = value as Record<string, unknown>;
	switch (event.type) {
		case 'text':
			return typeof event.text === 'string';
		case 'tool':
			return (
				typeof event.id === 'string' &&
				typeof event.name === 'string' &&
				(event.state === 'running' || event.state === 'done' || event.state === 'failed')
			);
		case 'error':
			return typeof event.message === 'string';
		case 'done':
			return true;
		default:
			return false;
	}
}

/**
 * Which of the campaign's two filing tools a tool name is, or null for any other Qatom tool.
 * The names end in `log_work` and `milestone_hit` (see the agent's instructions).
 */
export function filingTool(name: string): 'log_work' | 'milestone_hit' | null {
	if (name.endsWith('log_work')) return 'log_work';
	if (name.endsWith('milestone_hit')) return 'milestone_hit';
	return null;
}

/**
 * The first line of the message in which the assistant shows a report before filing it. The
 * agent's instructions give it this layout; the page reads it back to draw the review card.
 */
export const REVIEW_MARKER = 'Review before you file';

/** The assistant's review message, taken apart. Every word in it is the assistant's own. */
export interface ChatReview {
	/** One row per line of the report, in the order the assistant wrote them. */
	rows: { label: string; value: string }[];
	/** What the assistant said about the filing deposit. */
	deposit: string;
	/** Whatever the assistant wrote after the deposit: its limit, and its question. */
	closing: string[];
}

const REVIEW_LINE = /^([A-Z][A-Za-z ]{0,30}):\s+(\S.*)$/;

/**
 * Reads a finished reply as a review, or answers null when it is not one. It is a review only
 * when it starts with the marker line, lists at least one "Label: value" line and has a
 * "Deposit:" line. Anything else stays an ordinary message, so nothing is ever hidden.
 */
export function chatReview(text: string): ChatReview | null {
	const lines = text
		.trim()
		.split(/\r?\n/)
		.map((line) => line.trim());
	if (lines[0] !== REVIEW_MARKER) return null;

	const rows: ChatReview['rows'] = [];
	const closing: string[] = [];
	let deposit: string | null = null;
	for (const line of lines.slice(1)) {
		if (line === '') continue;
		if (deposit !== null) {
			closing.push(line);
			continue;
		}
		const match = REVIEW_LINE.exec(line);
		const label = match?.[1];
		const value = match?.[2];
		if (label === undefined || value === undefined) {
			// A second line of the note, or of another value.
			const last = rows.at(-1);
			if (!last) return null;
			last.value += `\n${line}`;
		} else if (label === 'Deposit') deposit = value;
		else rows.push({ label, value });
	}
	if (deposit === null || rows.length === 0) return null;
	return { rows, deposit, closing };
}
