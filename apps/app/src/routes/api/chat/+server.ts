/**
 * POST /api/chat: the agent's next reply, streamed. Track B owns this file.
 *
 * Send JSON, `{ "messages": [{ "role": "user" | "assistant", "text": "..." }, ...] }`: the
 * conversation so far, ending with what the person just said. The answer is a stream of lines,
 * one JSON event per line (see `#lib/chat.ts`).
 *
 * A turn of the person's may carry `form` instead of text: the report form from the chat page
 * (see `#lib/report-form.ts`). It is checked here and reaches the agent as a message. Sending a
 * form files nothing: only the agent calls a campaign tool, and only after the person says yes.
 *
 * Only a signed-in party may call it. The reply is produced by the model on our server, which
 * reaches Tejido's Qatom MCP server with that party's own Qatom sign-in. The server keeps no
 * conversation: the page sends it each time.
 */
import { json } from '@sveltejs/kit';
import { getCampaign, getParty, listMilestones } from '@tejido/db';
import {
	AgentUnavailableError,
	agentReply,
	systemPrompt,
	unavailableMessage
} from '#lib/server/agent.ts';
import { mcpResource, usablePersonToken } from '#lib/server/person-tokens.ts';
import { checkReportForm, reportFormMessage } from '#lib/server/report-form.ts';
import type { ReportFormProblems } from '#lib/report-form.ts';
import {
	CHAT_MAX_TURN_CHARACTERS,
	CHAT_MAX_TURNS,
	type ChatEvent,
	type ChatRefusal,
	type ChatTurn
} from '#lib/chat.ts';
import type { RequestHandler } from './$types';

function refuse(status: number, error: string, message: string): Response {
	return json({ error, message } satisfies ChatRefusal, { status });
}

/** A turn as it arrived. A report form on it has not been checked yet. */
interface ArrivedTurn {
	role: ChatTurn['role'];
	text: string;
	form?: unknown;
}

/** The conversation, if the body is one we accept. */
function conversation(body: unknown): ArrivedTurn[] | null {
	if (typeof body !== 'object' || body === null) return null;
	const { messages } = body as { messages?: unknown };
	if (!Array.isArray(messages) || messages.length === 0 || messages.length > CHAT_MAX_TURNS) {
		return null;
	}
	const turns: ArrivedTurn[] = [];
	for (const message of messages as unknown[]) {
		if (typeof message !== 'object' || message === null) return null;
		const { role, text, form } = message as { role?: unknown; text?: unknown; form?: unknown };
		if (role !== 'user' && role !== 'assistant') return null;
		if (form !== undefined) {
			// A report form stands in for the person's words: theirs only, and no text beside it.
			if (role !== 'user' || text !== '') return null;
			turns.push({ role, text: '', form });
			continue;
		}
		if (typeof text !== 'string' || text.trim() === '' || text.length > CHAT_MAX_TURN_CHARACTERS) {
			return null;
		}
		turns.push({ role, text });
	}
	// A conversation starts with the person and ends with what they just said.
	if (turns[0]?.role !== 'user' || turns.at(-1)?.role !== 'user') return null;
	return turns;
}

const UNREADABLE = `The conversation could not be read. A message can be at most ${CHAT_MAX_TURN_CHARACTERS} characters; if this chat has grown very long, reload the page to start a new one.`;

function refuseForm(fields: ReportFormProblems): Response {
	return json(
		{
			error: 'invalid_form',
			message:
				'Some of the form needs fixing before it can go to the agent. Nothing was sent and nothing was filed.',
			fields
		} satisfies ChatRefusal,
		{ status: 400 }
	);
}

const SIGN_IN_AGAIN =
	'Your Qatom sign-in has run out. Open your invite link and sign in again, then come back to the chat.';

export const POST: RequestHandler = async ({ request, locals, url }) => {
	// Before anything is read.
	const { session } = locals;
	if (!session) {
		return refuse(401, 'not_signed_in', 'Sign in from your invite link to talk to the agent.');
	}
	if (!session.partyId) {
		return refuse(
			403,
			'not_a_party',
			'Only someone invited to a campaign can use the agent. Sign in from your invite link.'
		);
	}

	const { config, db, qatom } = locals.ctx;

	const party = await getParty(db, session.partyId);
	const campaign = party ? await getCampaign(db, party.campaignId) : undefined;
	if (!party || !campaign) {
		return refuse(403, 'not_a_party', 'Your invite is no longer on a campaign.');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return refuse(400, 'invalid_request', 'The message could not be read. Send it again.');
	}
	const arrived = conversation(body);
	if (!arrived) return refuse(400, 'invalid_request', UNREADABLE);

	// Each report form becomes the message the agent reads, or the request stops here: before
	// the person's token is fetched and before anything is sent to the model.
	const milestones = await listMilestones(db, campaign.id);
	const turns: ChatTurn[] = [];
	for (const [index, { role, text, form }] of arrived.entries()) {
		if (form === undefined) {
			turns.push({ role, text });
			continue;
		}
		const latest = index === arrived.length - 1;
		const checked = checkReportForm(form, {
			party,
			milestones,
			evidenceOrigin: url.origin,
			latest
		});
		if (!checked.ok) {
			return latest ? refuseForm(checked.problems) : refuse(400, 'invalid_request', UNREADABLE);
		}
		turns.push({ role, text: reportFormMessage(checked.report, checked.milestone) });
	}

	const token = await usablePersonToken(db, config.SESSION_SECRET, party.id, {
		person: qatom.person,
		resource: mcpResource(config.QATOM_MCP_URL)
	});
	if (!token.ok) return refuse(409, 'sign_in_again', SIGN_IN_AGAIN);

	const system = systemPrompt({
		party,
		campaign,
		milestones,
		uploadPageUrl: `${url.origin}/upload`,
		today: new Date().toISOString().slice(0, 10)
	});

	// The reply starts before we answer, so a failure to start is a plain refusal the page can
	// show, not a broken stream.
	const encoder = new TextEncoder();
	const stop = new AbortController();
	request.signal.addEventListener('abort', () => stop.abort());

	const early: ChatEvent[] = [];
	let send = (event: ChatEvent): void => void early.push(event);
	let started!: () => void;
	const firstEvent = new Promise<void>((resolve) => (started = resolve));

	const reply = agentReply({
		apiKey: config.ANTHROPIC_API_KEY,
		mcpUrl: config.QATOM_MCP_URL,
		accessToken: token.accessToken,
		system,
		turns,
		signal: stop.signal,
		emit: (event) => {
			send(event);
			started();
		}
	});

	try {
		await Promise.race([firstEvent, reply]);
	} catch (cause) {
		if (!(cause instanceof AgentUnavailableError)) throw cause;
		return refuse(502, 'agent_unavailable', unavailableMessage(cause));
	}

	const stream = new ReadableStream<Uint8Array>({
		start(controller) {
			const line = (event: ChatEvent) =>
				controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
			for (const event of early) line(event);
			send = line;
			reply
				.catch((cause: unknown) => {
					if (stop.signal.aborted) return;
					console.error(
						'The chat reply failed:',
						cause instanceof Error ? cause.name : 'unknown error'
					);
					line({
						type: 'error',
						message:
							'The agent stopped before finishing its reply. If it was filing a report, ask it whether the report went through before you try again.'
					});
				})
				.finally(() => {
					if (!stop.signal.aborted) controller.close();
				});
		},
		cancel() {
			stop.abort();
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'application/x-ndjson; charset=utf-8',
			'cache-control': 'no-store'
		}
	});
};
