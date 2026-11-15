// The agent's own retry: when the Claude API turns a request away before any reply starts.
//
// These tests never reach the network: `fetch` is replaced, here in the test file, by a stub
// standing in for the Claude API. The wait between tries is passed in, so nothing sleeps.
import type { PersonAccessToken } from '@tejido/qatom/person';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatEvent } from '#lib/chat.ts';
import {
	AgentUnavailableError,
	agentReply,
	retryFloorMs,
	TRYING_AGAIN,
	unavailableMessage
} from './agent.ts';

/** A Claude API event stream, as the API writes one. */
function eventStream(events: Record<string, unknown>[]): Response {
	const text = events
		.map((event) => `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`)
		.join('');
	return new Response(text, { headers: { 'content-type': 'text/event-stream' } });
}

const START = { type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } };
const text = (index: number, said: string) => [
	{ type: 'content_block_start', index, content_block: { type: 'text', text: '' } },
	{ type: 'content_block_delta', index, delta: { type: 'text_delta', text: said } },
	{ type: 'content_block_stop', index }
];
const stopped = (stop_reason: string) => [
	{ type: 'message_delta', delta: { stop_reason }, usage: { output_tokens: 12 } },
	{ type: 'message_stop' }
];
const reply = () => eventStream([START, ...text(0, 'You owe a work log.'), ...stopped('end_turn')]);
const turnedAway =
	(status: number, headers: Record<string, string> = {}) =>
	() =>
		new Response('{}', { status, headers });

/** What the stub Claude API answers, one per request. */
let answers: (() => Response | Promise<Response>)[];
/** The body of every request our server made, in order. */
let sent: Record<string, unknown>[];
/** Every wait the agent asked for, in milliseconds. */
let waits: number[];
let events: ChatEvent[];

beforeEach(() => {
	answers = [];
	sent = [];
	waits = [];
	events = [];
	vi.spyOn(console, 'error').mockImplementation(() => undefined);
	vi.stubGlobal('fetch', (_input: string | URL, init: RequestInit = {}) => {
		sent.push(JSON.parse(String(init.body)) as Record<string, unknown>);
		const answer = answers.shift();
		if (!answer) return Promise.reject(new Error('the test expected no further request'));
		return Promise.resolve(answer());
	});
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

const asking = (signal: AbortSignal) => ({
	apiKey: 'claude-api-key',
	mcpUrl: 'https://tejido.mcp.qatom.test/mcp',
	accessToken: 'person-access-token' as PersonAccessToken,
	system: 'You are the assistant.',
	turns: [{ role: 'user' as const, text: 'What do I owe?' }],
	signal,
	emit: (event: ChatEvent) => void events.push(event)
});

/** Asks for a reply with a wait that only notes how long it was asked to wait. */
function ask() {
	return agentReply({
		...asking(new AbortController().signal),
		wait: (ms) => {
			waits.push(ms);
			return Promise.resolve();
		}
	});
}

/** Asks for a reply with the agent's own wait. Only for tests that use fake timers. */
const realWaitAsk = (signal: AbortSignal) => agentReply(asking(signal));

const retrying = { type: 'retrying', message: TRYING_AGAIN };

describe('a request the Claude API turns away before any reply starts', () => {
	it('is sent again after a 502, and the person is told it tried again', async () => {
		answers = [turnedAway(502), reply];

		await ask();

		expect(events).toEqual([
			retrying,
			{ type: 'text', text: 'You owe a work log.' },
			{ type: 'done' }
		]);
		expect(sent).toHaveLength(2);
		expect(sent[1]).toEqual(sent[0]);
		expect(waits).toEqual([1000]);
	});

	it.each([503, 504, 529])('is sent again after a %i too', async (status) => {
		answers = [turnedAway(status), reply];

		await ask();

		expect(events.at(-1)).toEqual({ type: 'done' });
		expect(sent).toHaveLength(2);
	});

	it('waits a little longer before the third try, and never makes a fourth', async () => {
		answers = [turnedAway(502), turnedAway(503), turnedAway(502), reply];

		await ask();

		expect(sent).toHaveLength(3);
		expect(waits).toEqual([1000, 3000]);
		expect(events).toEqual([
			retrying,
			retrying,
			{ type: 'error', message: expect.stringContaining('could not be reached') }
		]);
		expect(JSON.stringify(events.at(-1))).toContain('Nothing was filed by this message');
		expect(events).not.toContainEqual({ type: 'done' });
	});

	it('says the agent is busy when it stays overloaded for all three tries', async () => {
		answers = [turnedAway(529), turnedAway(529), turnedAway(529)];

		await ask();

		expect(sent).toHaveLength(3);
		expect(events.at(-1)).toEqual({ type: 'error', message: expect.stringContaining('busy') });
	});

	it.each([400, 401, 403, 404, 413, 500])('is not sent again after a %i', async (status) => {
		answers = [turnedAway(status), reply];

		const failure = await ask().catch((cause: unknown) => cause);

		expect(failure).toBeInstanceOf(AgentUnavailableError);
		expect((failure as AgentUnavailableError).status).toBe(status);
		expect(unavailableMessage(failure as AgentUnavailableError)).toContain('could not be reached');
		expect(sent).toHaveLength(1);
		expect(waits).toEqual([]);
		expect(events).toEqual([]);
	});

	it('is not sent again when the connection fails, because the request may have arrived', async () => {
		answers = [() => Promise.reject(new TypeError('fetch failed')), reply];

		const failure = await ask().catch((cause: unknown) => cause);

		expect(failure).toBeInstanceOf(AgentUnavailableError);
		expect((failure as AgentUnavailableError).status).toBeNull();
		expect(sent).toHaveLength(1);
		expect(events).toEqual([]);
	});

	it('stops trying when the connection fails on a later try', async () => {
		answers = [turnedAway(502), () => Promise.reject(new TypeError('fetch failed')), reply];

		await ask();

		expect(sent).toHaveLength(2);
		expect(events).toEqual([
			retrying,
			{ type: 'error', message: expect.stringContaining('could not be reached') }
		]);
	});
});

describe('how long it waits', () => {
	it('waits as long as a short retry-after asks', async () => {
		answers = [turnedAway(429, { 'retry-after': '2' }), reply];

		await ask();

		expect(waits).toEqual([2000]);
		expect(events.at(-1)).toEqual({ type: 'done' });
	});

	it('gives up at once when retry-after is long', async () => {
		answers = [turnedAway(429, { 'retry-after': '30' }), reply];

		const failure = await ask().catch((cause: unknown) => cause);

		expect(unavailableMessage(failure as AgentUnavailableError)).toContain('busy');
		expect(sent).toHaveLength(1);
		expect(events).toEqual([]);
	});

	it('does not send again after a 429 that names no wait: a spend cap does not pass', async () => {
		answers = [turnedAway(429), reply];

		await expect(ask()).rejects.toBeInstanceOf(AgentUnavailableError);
		expect(sent).toHaveLength(1);
	});

	it('reads the rules off the response', () => {
		const floor = (status: number, headers: Record<string, string> = {}) =>
			retryFloorMs(new Response('{}', { status, headers }));

		expect(floor(502)).toBe(0);
		expect(floor(529, { 'retry-after': '1.5' })).toBe(1500);
		expect(floor(503, { 'retry-after': '60' })).toBeNull();
		expect(floor(503, { 'retry-after': 'soon' })).toBeNull();
		// The API's own word wins.
		expect(floor(502, { 'x-should-retry': 'false' })).toBeNull();
		expect(floor(400, { 'x-should-retry': 'true' })).toBeNull();
		expect(floor(200)).toBeNull();
	});

	it('stops waiting, and sends nothing more, when the person’s request is aborted', async () => {
		answers = [turnedAway(502), reply];
		vi.useFakeTimers();
		try {
			const stop = new AbortController();
			const asked = realWaitAsk(stop.signal).catch((cause: unknown) => cause);
			await vi.advanceTimersByTimeAsync(500);
			expect(events).toEqual([retrying]);

			stop.abort();
			const failure = await asked;

			expect(failure).toBeInstanceOf(DOMException);
			expect((failure as DOMException).name).toBe('AbortError');
			await vi.advanceTimersByTimeAsync(10_000);
			expect(sent).toHaveLength(1);
			expect(events).toEqual([retrying]);
		} finally {
			vi.useRealTimers();
		}
	});

	it('with the real wait, tries again one second later and not before', async () => {
		answers = [turnedAway(502), reply];
		vi.useFakeTimers();
		try {
			const asked = realWaitAsk(new AbortController().signal);
			await vi.advanceTimersByTimeAsync(999);
			expect(sent).toHaveLength(1);

			await vi.advanceTimersByTimeAsync(1);
			await asked;

			expect(sent).toHaveLength(2);
			expect(events.at(-1)).toEqual({ type: 'done' });
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('a reply that has started', () => {
	it('is never asked for again when its stream breaks part-way', async () => {
		answers = [
			() =>
				eventStream([
					START,
					...text(0, 'Filing'),
					{ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }
				]),
			reply
		];

		await ask();

		expect(sent).toHaveLength(1);
		expect(waits).toEqual([]);
		expect(events).toEqual([
			{ type: 'text', text: 'Filing' },
			{ type: 'error', message: expect.stringContaining('whether the report went through') }
		]);
	});

	it('is never asked for again when its stream ends without a stop reason', async () => {
		answers = [() => eventStream([START, ...text(0, 'Half a rep')]), reply];

		await ask();

		expect(sent).toHaveLength(1);
		expect(events.at(-1)).toEqual({
			type: 'error',
			message: expect.stringContaining('stopped before finishing')
		});
		expect(events).not.toContainEqual(retrying);
	});
});

describe('resuming a turn the API paused', () => {
	const paused = () => eventStream([START, ...text(0, 'Checking. '), ...stopped('pause_turn')]);
	const rest = () => eventStream([START, ...text(0, 'Done.'), ...stopped('end_turn')]);

	it('sends the same resume again after a 502, and carries on as one reply', async () => {
		answers = [paused, turnedAway(502), rest];

		await ask();

		expect(sent).toHaveLength(3);
		expect(sent[2]).toEqual(sent[1]);
		expect(events).toEqual([
			{ type: 'text', text: 'Checking. ' },
			retrying,
			{ type: 'text', text: 'Done.' },
			{ type: 'done' }
		]);
	});

	it('says the reply stopped early when the resume is turned away three times', async () => {
		answers = [paused, turnedAway(502), turnedAway(502), turnedAway(502)];

		await ask();

		expect(sent).toHaveLength(4);
		expect(events.at(-1)).toEqual({
			type: 'error',
			message: expect.stringContaining('whether the report went through')
		});
	});
});
