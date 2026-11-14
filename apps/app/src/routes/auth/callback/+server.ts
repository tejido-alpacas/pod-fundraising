/**
 * GET /auth/callback: where Qatom sends the browser back. Track B owns this file.
 *
 * It finishes the sign-in, and when the sign-in began from a party's invite it stores BOTH
 * wallet hostnames on that party:
 *   - agentWalletHostname   (claim agent_twin_hostname): deposits are paid from it
 *   - primaryWalletHostname (claim twin_hostname): refunds are sent to it
 * and keeps the person's tokens, sealed, for the agent chat.
 *
 * Whatever goes wrong, nothing is linked and no session is started, and the person is sent to
 * /auth/problem, which explains it in plain words.
 */
import { redirect } from '@sveltejs/kit';
import { getParty, linkPartyWallets } from '@tejido/db';
import { QatomError, QatomSignInError } from '@tejido/qatom';
import { keepPersonTokens } from '#lib/server/person-tokens.ts';
import { takeSignInState, writeSession } from '#lib/server/session.ts';
import { problemForSignInError, problemPath } from '#lib/server/sign-in-problem.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ url, cookies, locals }) => {
	const { config, db, qatom } = locals.ctx;

	// The party being onboarded comes from the sealed cookie this browser was given when the
	// sign-in started. Nothing in the callback URL can name or change it.
	const state = takeSignInState(cookies, config.SESSION_SECRET);
	if (!state) redirect(303, problemPath('expired', null));

	let person;
	try {
		person = await qatom.person.complete(url, state.pending);
	} catch (cause) {
		if (!(cause instanceof QatomError)) throw cause;
		// A QatomError never carries a token, a header or a response body.
		console.error('Sign-in did not complete:', cause.name, cause.message);
		redirect(
			303,
			problemPath(
				cause instanceof QatomSignInError ? problemForSignInError(cause) : 'qatom_unavailable',
				state.partyId
			)
		);
	}

	if (state.partyId) {
		const party = await getParty(db, state.partyId);
		if (!party) redirect(303, problemPath('unknown_invite', null));
		// The invite was sent to one address. Only that person may claim the party.
		if (party.email !== person.email) redirect(303, problemPath('wrong_email', party.id));

		await linkPartyWallets(db, party.id, {
			agentWalletHostname: person.agentWalletHostname,
			primaryWalletHostname: person.primaryWalletHostname
		});

		// The agent chat reaches the Qatom MCP server as this person, so it needs their tokens.
		// They are kept sealed, one row per party, in our database: never in a cookie, never in
		// a log, never sent to the browser. A sign-in without an invite keeps none.
		await keepPersonTokens(db, config.SESSION_SECRET, party.id, person.tokens);
	}

	writeSession(cookies, config.SESSION_SECRET, {
		sub: person.sub,
		email: person.email,
		partyId: state.partyId
	});

	redirect(303, state.returnTo);
};
