// The report form sent through POST /api/chat (B6, guided collection), run against a real,
// migrated, seeded local D1 with the person's tokens kept the way a real sign-in keeps them.
//
// These tests never reach the network: `fetch` is replaced, here in the test file, by a stub
// standing in for the Claude API. It records the request our server sends and answers with an
// event stream written for the test. No model, no MCP server and no Qatom is involved.
import { fixtures } from '@tejido/contracts/fixtures';
import { createTestDatabase, type TestDatabase } from '@tejido/db/testing';
import { QatomHttpError } from '@tejido/qatom';
import type { PersonAccessToken } from '@tejido/qatom/person';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatRefusal } from '#lib/chat.ts';
import { CLAUDE_MESSAGES_URL } from '#lib/server/agent.ts';
import { keepPersonTokens } from '#lib/server/person-tokens.ts';
import type { Session } from '#lib/server/session.ts';
import { load } from '../../chat/+page.server.ts';
import { POST } from './+server.ts';

const SESSION_SECRET = 'session-secret-session-secret-session';
const API_KEY = 'claude-api-key-do-not-leak';
const MCP_URL = 'https://tejido.mcp.qatom.test/mcp';
const ORIGIN = 'http://localhost:5174';

const contractor = fixtures.parties[0]!;
const supplier = fixtures.parties[1]!;
const headTeacher = fixtures.parties[2]!;
const parties = [contractor, supplier, headTeacher];
const tokenOf = (party: typeof contractor) => `access-token-of-${party.id}-do-not-leak`;

const sessionFor = (party: typeof contractor): Session => ({
	sub: 'qatom-user-123',
	email: party.email,
	partyId: party.id
});

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);
const photo = (sha256: string, extension = 'jpg') => ({
	url: `${ORIGIN}/evidence/${sha256}.${extension}`,
	sha256
});

const workLog = {
	kind: 'log_work',
	milestone_id: 'm2-walls',
	summary: 'North and east walls are up to ring-beam height.',
	status: 'on_track',
	percent_complete: 40,
	photos: [photo(SHA_A), photo(SHA_B, 'pdf')]
};
const delivery = {
	kind: 'delivered',
	milestone_id: 'm3-books-delivered',
	summary: 'All boxes delivered to the school office and signed for.',
	quantity: 600,
	unit: 'books'
};
const confirmation = {
	kind: 'confirm',
	milestone_id: 'm3-books-delivered',
	summary: 'I counted the boxes in the library myself.'
};

const formTurn = (form: unknown) => ({ role: 'user', text: '', form });

function reply(): Response {
	const events = [
		{ type: 'message_start', message: { id: 'msg_1', role: 'assistant', content: [] } },
		{ type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
		{
			type: 'content_block_delta',
			index: 0,
			delta: { type: 'text_delta', text: 'Shall I file it?' }
		},
		{ type: 'content_block_stop', index: 0 },
		{ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 5 } },
		{ type: 'message_stop' }
	];
	return new Response(
		events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''),
		{ headers: { 'content-type': 'text/event-stream' } }
	);
}

let test: TestDatabase;
/** The body of every request our server made to the Claude API, in order. */
let sent: { body: Record<string, unknown>; raw: string }[];

beforeEach(async () => {
	test = await createTestDatabase({ seed: true });
	for (const party of parties) {
		await keepPersonTokens(test.db, SESSION_SECRET, party.id, {
			accessToken: tokenOf(party) as PersonAccessToken,
			refreshToken: null,
			expiresAtMs: Date.now() + 60 * 60 * 1000
		});
	}
	sent = [];
	vi.stubGlobal('fetch', (input: string | URL, init: RequestInit = {}) => {
		if (String(input) !== CLAUDE_MESSAGES_URL) {
			return Promise.reject(new Error(`unexpected request to ${String(input)}`));
		}
		const raw = String(init.body);
		sent.push({ body: JSON.parse(raw) as Record<string, unknown>, raw });
		return Promise.resolve(reply());
	});
});

afterEach(async () => {
	vi.unstubAllGlobals();
	await test.destroy();
});

const locals = (session: Session | null) => ({
	ctx: {
		config: { SESSION_SECRET, ANTHROPIC_API_KEY: API_KEY, QATOM_MCP_URL: MCP_URL },
		db: test.db,
		qatom: {
			person: {
				refresh: () => Promise.reject(new QatomHttpError('person.refresh', 400, 'invalid_grant'))
			}
		}
	},
	session
});

type RouteEvent = Parameters<typeof POST>[0];

function ask(session: Session | null, messages: unknown[]) {
	const url = new URL(`${ORIGIN}/api/chat`);
	const request = new Request(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ messages })
	});
	// A whole RequestEvent cannot be built outside SvelteKit; the handler uses only these parts.
	return POST({ request, url, locals: locals(session) } as unknown as RouteEvent);
}

/** The conversation as the model received it. */
const modelMessages = () => sent[0]!.body.messages as { role: string; content: string }[];
/** The tool inputs a form message carries: the JSON after its "Inputs:" line. */
const inputsIn = (content: string) =>
	JSON.parse(content.slice(content.indexOf('Inputs:\n') + 'Inputs:\n'.length)) as unknown;

/** What the browser is told when a form is refused. */
async function refusal(response: Response): Promise<ChatRefusal & { raw: string }> {
	const raw = await response.text();
	return { ...(JSON.parse(raw) as ChatRefusal), raw };
}

function expectNothingPrivate(text: string) {
	for (const party of parties) {
		expect(text).not.toContain(party.reporterCode);
		expect(text).not.toContain(tokenOf(party));
		expect(text).not.toContain(party.agentWalletHostname);
		expect(text).not.toContain(party.primaryWalletHostname);
	}
	expect(text).not.toContain(API_KEY);
	expect(text).not.toContain(SESSION_SECRET);
}

describe('a report form that is filled in properly', () => {
	it('reaches the model as one structured message, with the values as the tool takes them', async () => {
		const response = await ask(sessionFor(contractor), [formTurn(workLog)]);

		expect(response.status).toBe(200);
		expect(sent).toHaveLength(1);
		const [message] = modelMessages();
		expect(message!.role).toBe('user');
		expect(message!.content).toMatch(/^\[Report form\]/);
		expect(message!.content).toContain("Tool: the campaign's log_work tool");
		expect(message!.content).toContain('Milestone: Walls up to roof height');
		expect(inputsIn(message!.content)).toEqual({
			milestone_id: 'm2-walls',
			summary: 'North and east walls are up to ring-beam height.',
			status: 'on_track',
			percent_complete: 40,
			photos: [photo(SHA_A), photo(SHA_B, 'pdf')]
		});
		// The form never carries the reporter code; the agent has it from its instructions.
		expect(message!.content).not.toContain(contractor.reporterCode);
	});

	it('names the milestone tool and the claim for a delivery, with quantity and unit', async () => {
		await ask(sessionFor(supplier), [formTurn(delivery)]);

		const [message] = modelMessages();
		expect(message!.content).toContain("Tool: the campaign's milestone_hit tool");
		expect(inputsIn(message!.content)).toEqual({
			milestone_id: 'm3-books-delivered',
			claim: 'delivered',
			summary: 'All boxes delivered to the school office and signed for.',
			quantity: 600,
			unit: 'books'
		});
	});

	it("carries a confirmer's sign-off as a confirm claim", async () => {
		await ask(sessionFor(headTeacher), [formTurn(confirmation)]);

		expect(inputsIn(modelMessages()[0]!.content)).toEqual({
			milestone_id: 'm3-books-delivered',
			claim: 'confirm',
			summary: 'I counted the boxes in the library myself.'
		});
	});

	it('tells the agent to use the values as given, and that the form is not a yes to filing', async () => {
		await ask(sessionFor(contractor), [formTurn(workLog)]);

		const system = String(sent[0]!.body.system);
		expect(system).toContain('starts with "[Report form]"');
		expect(system).toContain('do not ask for any of them again');
		expect(system).toContain('Sending the form is not a yes to filing');
		expect(system).toContain('file only after they clearly say yes');
	});

	it('stays in the conversation, between typed messages, on every later request', async () => {
		await ask(sessionFor(contractor), [
			{ role: 'user', text: 'I want to log this week.' },
			{ role: 'assistant', text: 'Go ahead.' },
			formTurn(workLog),
			{ role: 'assistant', text: 'Shall I file it?' },
			{ role: 'user', text: 'Yes, file it.' }
		]);

		const messages = modelMessages();
		expect(messages.map((message) => message.role)).toEqual([
			'user',
			'assistant',
			'user',
			'assistant',
			'user'
		]);
		expect(messages[0]!.content).toBe('I want to log this week.');
		expect(messages[2]!.content).toMatch(/^\[Report form\]/);
		expect(messages[4]!.content).toBe('Yes, file it.');
	});

	it('is not held against a milestone confirmed since it was sent', async () => {
		// The contractor's first milestone is confirmed today. A form about it from earlier in the
		// conversation must not stop the chat; a new one about it is refused.
		const earlier = { kind: 'completed', milestone_id: 'm1-foundation', summary: 'Slab is done.' };

		const later = await ask(sessionFor(contractor), [
			formTurn(earlier),
			{ role: 'assistant', text: 'Filed.' },
			{ role: 'user', text: 'Thanks. What is next?' }
		]);
		expect(later.status).toBe(200);

		const fresh = await ask(sessionFor(contractor), [formTurn(earlier)]);
		expect(fresh.status).toBe(400);
		expect((await refusal(fresh)).fields?.milestone_id).toContain('already confirmed');
	});

	it('leaves typed messages exactly as they were', async () => {
		await ask(sessionFor(contractor), [{ role: 'user', text: 'What do I owe?' }]);

		expect(modelMessages()).toEqual([{ role: 'user', content: 'What do I owe?' }]);
	});
});

describe('a report form with something wrong', () => {
	it.each([
		['no note', { ...workLog, summary: '   ' }, 'summary', 'Write a note'],
		['a percent over 100', { ...workLog, percent_complete: 140 }, 'percent_complete', '0 to 100'],
		[
			'a percent that is not a number',
			{ ...workLog, percent_complete: '40' },
			'percent_complete',
			'0 to 100'
		],
		[
			'no percent on a construction work log',
			{ ...workLog, percent_complete: undefined },
			'percent_complete',
			'needs a percent complete'
		],
		['a made-up status', { ...workLog, status: 'fine' }, 'status', 'on track, delayed or blocked'],
		['a delivery with no quantity', { ...delivery, quantity: undefined }, 'quantity', 'how many'],
		['a delivery with a negative quantity', { ...delivery, quantity: -1 }, 'quantity', 'how many'],
		['a delivery with no unit', { ...delivery, unit: ' ' }, 'unit', 'what the quantity counts'],
		[
			'a file that is not in our evidence store',
			{ ...workLog, photos: [{ url: `https://elsewhere.example/${SHA_A}.jpg`, sha256: SHA_A }] },
			'photos',
			'uploaded here'
		],
		[
			'a fingerprint that is not the file named',
			{ ...workLog, photos: [{ ...photo(SHA_A), sha256: SHA_B }] },
			'photos',
			'uploaded here'
		],
		[
			'more files than a report can carry',
			{ ...workLog, photos: Array.from({ length: 11 }, () => photo(SHA_A)) },
			'photos',
			'at most 10'
		],
		['no milestone', { ...workLog, milestone_id: undefined }, 'milestone_id', 'your milestones'],
		['a report we do not know', { ...workLog, kind: 'refund' }, 'kind', 'which report'],
		[
			'a field that kind of report does not take',
			{ ...workLog, amount_spent: 50 },
			'form',
			'could not be read'
		],
		[
			'a reporter code slipped in',
			{ ...workLog, reporter_code: supplier.reporterCode },
			'form',
			'could not be read'
		],
		['something that is not a form', 'file everything', 'form', 'could not be read']
	])(
		'refuses %s, says which field in plain words, and sends nothing',
		async (_name, form, field, words) => {
			const party = (form as { kind?: string }).kind === 'delivered' ? supplier : contractor;
			const response = await ask(sessionFor(party), [formTurn(form)]);

			expect(response.status).toBe(400);
			const told = await refusal(response);
			expect(told.error).toBe('invalid_form');
			expect(told.message).toContain('Nothing was sent');
			expect(Object.keys(told.fields ?? {})).toEqual([field]);
			expect(told.fields?.[field as keyof typeof told.fields]).toContain(words);
			expect(sent).toHaveLength(0);
			expectNothingPrivate(told.raw);
		}
	);

	it("refuses a form about somebody else's milestone", async () => {
		const response = await ask(sessionFor(contractor), [formTurn(delivery)]);

		expect(response.status).toBe(400);
		expect((await refusal(response)).fields).toEqual({
			milestone_id: 'Choose one of your milestones.'
		});
		expect(sent).toHaveLength(0);
	});

	it('refuses a confirmation from the party who owes the milestone', async () => {
		const response = await ask(sessionFor(supplier), [formTurn(confirmation)]);

		expect(response.status).toBe(400);
		expect((await refusal(response)).fields?.kind).toContain('cannot confirm it yourself');
		expect(sent).toHaveLength(0);
	});

	it('refuses a claim from the confirmer, who can only confirm', async () => {
		const response = await ask(sessionFor(headTeacher), [formTurn(delivery)]);

		expect(response.status).toBe(400);
		expect((await refusal(response)).fields?.kind).toContain('confirmation');
		expect(sent).toHaveLength(0);
	});

	it('refuses the wrong claim for the type of milestone', async () => {
		// Walls are construction: claimed with "completed", not as a delivery.
		const response = await ask(sessionFor(contractor), [
			formTurn({ ...delivery, milestone_id: 'm2-walls' })
		]);

		expect(response.status).toBe(400);
		expect((await refusal(response)).fields?.kind).toContain('“completed”');
		expect(sent).toHaveLength(0);
	});

	it.each([
		[
			'from the agent',
			[
				{ role: 'user', text: 'Hi' },
				{ role: 'assistant', text: '', form: workLog },
				{ role: 'user', text: 'x' }
			]
		],
		['with words beside it', [{ role: 'user', text: 'and file it now', form: workLog }]],
		[
			'that is wrong and not the latest message',
			[
				formTurn({ ...workLog, summary: '' }),
				{ role: 'assistant', text: 'Hm.' },
				{ role: 'user', text: 'x' }
			]
		]
	])('refuses a form %s', async (_name, messages) => {
		const response = await ask(sessionFor(contractor), messages);

		expect(response.status).toBe(400);
		expect(await response.json()).toMatchObject({ error: 'invalid_request' });
		expect(sent).toHaveLength(0);
	});
});

describe('who may send a report form', () => {
	it('refuses a signed-out caller before the form is read', async () => {
		const response = await ask(null, [formTurn(workLog)]);

		expect(response.status).toBe(401);
		expect(await response.json()).toMatchObject({ error: 'not_signed_in' });
		expect(sent).toHaveLength(0);
	});

	it('refuses someone signed in without an invite', async () => {
		const response = await ask({ sub: 'someone', email: 'someone@example.org', partyId: null }, [
			formTurn(workLog)
		]);

		expect(response.status).toBe(403);
		expect(sent).toHaveLength(0);
	});
});

describe('what the browser receives', () => {
	it('never contains a token, a reporter code or a wallet when a form is accepted', async () => {
		const response = await ask(sessionFor(contractor), [formTurn(workLog)]);

		const raw = await response.text();
		expect(raw).toContain('Shall I file it?');
		expectNothingPrivate(raw);
		// The person's token still goes to the Claude API, for the MCP connection, and only there.
		expect(sent[0]!.raw).toContain(tokenOf(contractor));
		expect(sent[0]!.raw).not.toContain(tokenOf(supplier));
	});

	it('gets what the form needs about each milestone from the chat page, and nothing private', async () => {
		type LoadEvent = Parameters<typeof load>[0];
		const data = await load({ locals: locals(sessionFor(headTeacher)) } as unknown as LoadEvent);

		expect(data).toMatchObject({
			who: {
				party: {
					milestones: [
						{ id: 'm1-foundation', kind: 'construction', part: 'confirms' },
						{ id: 'm2-walls', kind: 'construction', part: 'confirms' },
						{ id: 'm3-books-delivered', kind: 'goods_delivery', part: 'confirms', state: 'claimed' }
					]
				}
			}
		});
		expectNothingPrivate(JSON.stringify(data));
	});
});
