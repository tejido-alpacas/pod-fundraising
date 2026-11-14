/**
 * What the chat page and POST /api/chat say to each other. Track B owns this file.
 *
 * The page sends the conversation so far. The server answers with a stream of lines, one JSON
 * event per line, as the agent's reply is produced. Nothing here ever carries a token.
 */

/** One thing somebody said. The page keeps the conversation; the server keeps none of it. */
export interface ChatTurn {
	role: 'user' | 'assistant';
	text: string;
}

export interface ChatRequest {
	messages: ChatTurn[];
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
